import { Types } from 'mongoose';
import { ACCOUNTS } from '@autoparts/shared';
import { InventoryBalance, StockAdjustment, StockCount, ADJUSTMENT_REASONS } from './inventory.models.js';
import { getDefaultWarehouse, issueStock, receiveStock } from './inventory.service.js';
import { Product } from '../catalog/catalog.models.js';
import { postJournal } from '../ledger/ledger.service.js';
import { audit } from '../system/audit.service.js';
import { nextNumber } from '../system/system.models.js';
import { withTx } from '../../utils/tx.js';
import { badRequest, conflict, notFound, unprocessable } from '../../utils/errors.js';
import type { Ctx } from '../../utils/http.js';
import { checkStockAlerts } from '../sales/sales.service.js';

type Reason = (typeof ADJUSTMENT_REASONS)[number];

export interface AdjustmentInput {
  productId: string;
  qtyChange: number;
  reason: Reason;
  notes: string;
  unitCost?: number;
  /** Approve and post immediately (requires inventory:adjust; the default for the owner). */
  approve?: boolean;
}

export async function requestAdjustment(input: AdjustmentInput, ctx: Ctx, stockCountId?: Types.ObjectId) {
  if (!Number.isInteger(input.qtyChange) || input.qtyChange === 0) throw unprocessable('Quantity change must be a non-zero whole number');
  if (!input.notes || input.notes.trim().length < 3) throw unprocessable('Every adjustment needs an explanation');
  if (input.reason === 'OPENING_BALANCE' && input.qtyChange < 0) throw unprocessable('Opening balances must be positive');
  const product = await Product.findById(input.productId).lean();
  if (!product) throw notFound('Product');
  if (input.qtyChange > 0 && input.unitCost == null) throw unprocessable('A unit cost is required when adding stock, so inventory value stays accurate');
  const wh = await getDefaultWarehouse();
  const adj = await withTx(async (session) => {
    const adjustmentNo = await nextNumber('adjustment', 'ADJ-', session);
    const [doc] = await StockAdjustment.create(
      [
        {
          adjustmentNo,
          productId: product._id,
          warehouseId: wh._id,
          qtyChange: input.qtyChange,
          reason: input.reason,
          notes: input.notes.trim(),
          unitCost: input.unitCost,
          status: 'PENDING',
          stockCountId,
          requestedBy: ctx.userId,
        },
      ],
      { session },
    );
    await audit(ctx, 'inventory.adjustment.request', 'StockAdjustment', doc._id, { summary: `${adjustmentNo} ${product.sku} ${input.qtyChange} (${input.reason})`, session });
    return doc;
  });
  if (input.approve) return approveAdjustment(String(adj._id), ctx);
  return adj.toObject();
}

/**
 * Post an approved adjustment. Increases create a FIFO layer at the given unit cost;
 * decreases consume FIFO layers. The inventory value change is booked to
 * Inventory Shrinkage & Damage (or Opening Balance Equity for opening stock).
 */
export async function approveAdjustment(id: string, ctx: Ctx) {
  const result = await withTx(async (session) => {
    const adj = await StockAdjustment.findById(id).session(session);
    if (!adj) throw notFound('Adjustment');
    if (adj.status !== 'PENDING') throw conflict(`Adjustment is already ${adj.status.toLowerCase()}`);
    const product = await Product.findById(adj.productId).session(session).lean();
    const movementType = adj.reason === 'OPENING_BALANCE' ? 'OPENING_BALANCE' : adj.reason === 'DAMAGE' ? 'DAMAGE' : 'STOCK_ADJUSTMENT';
    const offset = adj.reason === 'OPENING_BALANCE' ? ACCOUNTS.OPENING_BALANCE_EQUITY : ACCOUNTS.INVENTORY_LOSS;
    let cost: number;
    const base = {
      productId: adj.productId,
      warehouseId: adj.warehouseId,
      movementType: movementType as 'OPENING_BALANCE' | 'DAMAGE' | 'STOCK_ADJUSTMENT',
      sourceType: 'STOCK_ADJUSTMENT',
      sourceId: adj._id,
      sourceRef: adj.adjustmentNo,
      lineKey: String(adj._id),
      reason: `${adj.reason}: ${adj.notes}`,
      userId: ctx.userId,
    };
    if (adj.qtyChange > 0) {
      cost = adj.qtyChange * (adj.unitCost ?? 0);
      await receiveStock({ ...base, qty: adj.qtyChange, totalCost: cost }, session);
    } else {
      const r = await issueStock({ ...base, qty: -adj.qtyChange }, session).catch((e) => {
        if (e.status === 409) throw unprocessable('Adjustment would make stock negative', e.details);
        throw e;
      });
      cost = r.totalCost;
    }
    if (cost > 0) {
      await postJournal(
        {
          memo: `Stock adjustment ${adj.adjustmentNo} ${product?.sku ?? ''} (${adj.reason})`,
          sourceType: adj.reason === 'OPENING_BALANCE' ? 'OPENING_BALANCE' : 'STOCK_ADJUSTMENT',
          sourceId: adj._id,
          sourceRef: adj.adjustmentNo,
          postedBy: ctx.userId,
          lines:
            adj.qtyChange > 0
              ? [
                  { account: ACCOUNTS.INVENTORY, debit: cost, productId: adj.productId },
                  { account: offset, credit: cost, productId: adj.productId },
                ]
              : [
                  { account: offset, debit: cost, productId: adj.productId },
                  { account: ACCOUNTS.INVENTORY, credit: cost, productId: adj.productId },
                ],
        },
        session,
      );
    }
    adj.status = 'APPROVED';
    adj.costImpact = adj.qtyChange > 0 ? cost : -cost;
    adj.approvedBy = ctx.userId;
    adj.approvedAt = new Date();
    await adj.save({ session });
    await audit(ctx, 'inventory.adjustment.approve', 'StockAdjustment', adj._id, { summary: `${adj.adjustmentNo} cost impact ${adj.costImpact}`, session });
    return adj.toObject();
  });
  void checkStockAlerts([result.productId]);
  return result;
}

export async function rejectAdjustment(id: string, reason: string, ctx: Ctx) {
  const adj = await StockAdjustment.findOneAndUpdate({ _id: id, status: 'PENDING' }, { $set: { status: 'REJECTED', approvedBy: ctx.userId, approvedAt: new Date() } }, { new: true }).lean();
  if (!adj) throw unprocessable('Only pending adjustments can be rejected');
  await audit(ctx, 'inventory.adjustment.reject', 'StockAdjustment', id, { summary: reason });
  return adj;
}

/** Record a physical count; differences become adjustments (auto-approved if requested). */
export async function recordStockCount(input: { notes?: string; lines: { productId: string; countedQty: number }[]; approve?: boolean }, ctx: Ctx) {
  if (input.lines.length === 0) throw badRequest('Count at least one product');
  const wh = await getDefaultWarehouse();
  const countNo = await withTx((s) => nextNumber('stockCount', 'CNT-', s));
  const countId = new Types.ObjectId();
  const lines = [];
  for (const l of input.lines) {
    if (!Number.isInteger(l.countedQty) || l.countedQty < 0) throw unprocessable('Counted quantities must be whole numbers ≥ 0');
    const product = await Product.findById(l.productId).lean();
    if (!product) throw notFound('Product');
    const bal = await InventoryBalance.findOne({ productId: product._id, warehouseId: wh._id }).lean();
    const systemQty = bal?.qtyOnHand ?? 0;
    const difference = l.countedQty - systemQty;
    let adjustmentId: Types.ObjectId | undefined;
    if (difference !== 0) {
      const adj = await requestAdjustment(
        {
          productId: l.productId,
          qtyChange: difference,
          reason: 'COUNT_CORRECTION',
          notes: `Physical count ${countNo}: system ${systemQty}, counted ${l.countedQty}`,
          unitCost: difference > 0 ? product.lastPurchaseCost : undefined,
          approve: input.approve,
        },
        ctx,
        countId,
      );
      adjustmentId = adj._id as Types.ObjectId;
    }
    lines.push({ productId: product._id, systemQty, countedQty: l.countedQty, difference, adjustmentId });
  }
  const [doc] = await StockCount.create([{ _id: countId, countNo, warehouseId: wh._id, notes: input.notes, lines, createdBy: ctx.userId }]);
  await audit(ctx, 'inventory.count', 'StockCount', countId, { summary: `${countNo}: ${lines.filter((l) => l.difference !== 0).length} difference(s)` });
  return doc.toObject();
}
