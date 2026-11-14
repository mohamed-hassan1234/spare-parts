import { Types, type ClientSession } from 'mongoose';
import { DEFAULT_WAREHOUSE_CODE, type MovementType } from '@autoparts/shared';
import { CostLayer, InventoryBalance, Movement, Warehouse, type WarehouseDoc } from './inventory.models.js';
import { conflict, unprocessable } from '../../utils/errors.js';
import { mulDiv } from '../../utils/money.js';

let defaultWarehouse: WarehouseDoc | null = null;

export async function ensureDefaultWarehouse() {
  await Warehouse.updateOne({ code: DEFAULT_WAREHOUSE_CODE }, { $setOnInsert: { code: DEFAULT_WAREHOUSE_CODE, name: 'Main Shop', isDefault: true, isActive: true } }, { upsert: true });
  defaultWarehouse = null;
}

export async function getDefaultWarehouse(): Promise<WarehouseDoc> {
  if (defaultWarehouse) return defaultWarehouse;
  let wh = await Warehouse.findOne({ isDefault: true }).lean();
  if (!wh) {
    await ensureDefaultWarehouse();
    wh = await Warehouse.findOne({ isDefault: true }).lean();
  }
  defaultWarehouse = wh as WarehouseDoc;
  return defaultWarehouse;
}
export function resetWarehouseCache() {
  defaultWarehouse = null;
}

interface MoveBase {
  productId: Types.ObjectId;
  warehouseId: Types.ObjectId;
  qty: number;
  movementType: MovementType;
  sourceType: string;
  sourceId?: Types.ObjectId;
  sourceRef?: string;
  lineKey: string;
  reason?: string;
  userId?: Types.ObjectId;
  at?: Date;
}

/**
 * Add stock with a known total acquisition cost. Creates a FIFO layer,
 * increments the balance and writes an immutable movement — all in `session`.
 */
export async function receiveStock(input: MoveBase & { totalCost: number }, session: ClientSession) {
  const { productId, warehouseId, qty, totalCost } = input;
  if (!Number.isInteger(qty) || qty <= 0) throw unprocessable('Received quantity must be a positive integer');
  if (!Number.isInteger(totalCost) || totalCost < 0) throw unprocessable('Total cost must be non-negative cents');
  const at = input.at ?? new Date();
  const [layer] = await CostLayer.create(
    [
      {
        productId,
        warehouseId,
        receivedAt: at,
        sourceType: input.movementType,
        sourceId: input.sourceId,
        sourceRef: input.sourceRef,
        originalQty: qty,
        remainingQty: qty,
        originalCost: totalCost,
        remainingCost: totalCost,
      },
    ],
    { session },
  );
  const bal = await InventoryBalance.findOneAndUpdate({ productId, warehouseId }, { $inc: { qtyOnHand: qty, qtyAvailable: qty }, $set: { lastMovementAt: at } }, { upsert: true, new: true, session });
  await createMovement({ ...input, qty, costAmount: totalCost, balanceAfter: bal!.qtyOnHand, at, layerAllocations: [{ layerId: layer._id, qty, cost: totalCost }] }, session);
  return { layerId: layer._id, balanceAfter: bal!.qtyOnHand };
}

export interface Allocation {
  layerId: Types.ObjectId;
  qty: number;
  cost: number;
  receivedAt: Date;
}

/**
 * Remove stock and compute its FIFO cost. The balance decrement is a single
 * conditional atomic update (`qtyAvailable >= qty`), so two concurrent sales of the
 * last unit cannot both succeed: the loser either fails the condition or hits a
 * write conflict and is retried by the transaction, then fails the condition.
 */
export async function issueStock(input: MoveBase & { allowNegative?: boolean }, session: ClientSession) {
  const { productId, warehouseId, qty } = input;
  if (!Number.isInteger(qty) || qty <= 0) throw unprocessable('Issued quantity must be a positive integer');
  const at = input.at ?? new Date();
  const bal = await InventoryBalance.findOneAndUpdate(
    { productId, warehouseId, qtyAvailable: { $gte: qty } },
    { $inc: { qtyOnHand: -qty, qtyAvailable: -qty }, $set: { lastMovementAt: at } },
    { new: true, session },
  );
  if (!bal) {
    const current = await InventoryBalance.findOne({ productId, warehouseId }).session(session).lean();
    throw conflict('Insufficient stock', { productId: String(productId), requested: qty, available: current?.qtyAvailable ?? 0 });
  }

  // Consume FIFO layers oldest-first.
  const layers = await CostLayer.find({ productId, warehouseId, remainingQty: { $gt: 0 } })
    .sort({ receivedAt: 1, _id: 1 })
    .session(session);
  let need = qty;
  const allocations: Allocation[] = [];
  for (const layer of layers) {
    if (need === 0) break;
    const take = Math.min(need, layer.remainingQty);
    // Exact cost: when a layer is exhausted, take all its remaining cost so rounding never leaks.
    const cost = take === layer.remainingQty ? layer.remainingCost : mulDiv(layer.remainingCost, take, layer.remainingQty);
    const res = await CostLayer.updateOne(
      { _id: layer._id, remainingQty: layer.remainingQty, remainingCost: layer.remainingCost },
      { $inc: { remainingQty: -take, remainingCost: -cost } },
      { session },
    );
    if (res.modifiedCount !== 1) throw conflict('Concurrent inventory update detected; please retry');
    allocations.push({ layerId: layer._id, qty: take, cost, receivedAt: layer.receivedAt });
    need -= take;
  }
  if (need > 0) {
    // Balance said stock exists but layers disagree — integrity problem. Abort the transaction.
    throw unprocessable('Inventory cost layers are inconsistent with stock balance; run reconciliation', { productId: String(productId) });
  }
  const totalCost = allocations.reduce((s, a) => s + a.cost, 0);
  await createMovement(
    {
      ...input,
      qty: -qty,
      costAmount: -totalCost,
      balanceAfter: bal.qtyOnHand,
      at,
      layerAllocations: allocations.map(({ layerId, qty: q, cost }) => ({ layerId, qty: q, cost })),
    },
    session,
  );
  return { totalCost, allocations, balanceAfter: bal.qtyOnHand };
}

async function createMovement(
  m: MoveBase & { costAmount: number; balanceAfter: number; at: Date; layerAllocations?: { layerId: Types.ObjectId; qty: number; cost: number }[] },
  session: ClientSession,
) {
  try {
    await Movement.create(
      [
        {
          productId: m.productId,
          warehouseId: m.warehouseId,
          type: m.movementType,
          qty: m.qty,
          costAmount: m.costAmount,
          balanceAfter: m.balanceAfter,
          sourceType: m.sourceType,
          sourceId: m.sourceId,
          sourceRef: m.sourceRef,
          lineKey: m.lineKey,
          layerAllocations: m.layerAllocations,
          reason: m.reason,
          createdBy: m.userId,
          at: m.at,
        },
      ],
      { session },
    );
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('This inventory transaction line has already been processed');
    throw e;
  }
}

/** Reserve stock (e.g. for a quotation); reduces available but not on-hand. */
export async function reserveStock(input: Omit<MoveBase, 'movementType'>, session: ClientSession) {
  const bal = await InventoryBalance.findOneAndUpdate(
    { productId: input.productId, warehouseId: input.warehouseId, qtyAvailable: { $gte: input.qty } },
    { $inc: { qtyReserved: input.qty, qtyAvailable: -input.qty }, $set: { lastMovementAt: new Date() } },
    { new: true, session },
  );
  if (!bal) throw conflict('Insufficient available stock to reserve');
  await createMovement({ ...input, movementType: 'RESERVATION', qty: 0, costAmount: 0, balanceAfter: bal.qtyOnHand, at: new Date(), reason: `Reserved ${input.qty}` }, session);
  return bal;
}

export async function releaseReservation(input: Omit<MoveBase, 'movementType'>, session: ClientSession) {
  const bal = await InventoryBalance.findOneAndUpdate(
    { productId: input.productId, warehouseId: input.warehouseId, qtyReserved: { $gte: input.qty } },
    { $inc: { qtyReserved: -input.qty, qtyAvailable: input.qty }, $set: { lastMovementAt: new Date() } },
    { new: true, session },
  );
  if (!bal) throw unprocessable('Cannot release more than is reserved');
  await createMovement({ ...input, movementType: 'RESERVATION_RELEASE', qty: 0, costAmount: 0, balanceAfter: bal.qtyOnHand, at: new Date(), reason: `Released ${input.qty}` }, session);
  return bal;
}

/** Inventory value = Σ remaining FIFO layer cost. */
export async function inventoryValuation(opts: { productIds?: Types.ObjectId[] } = {}) {
  const match: Record<string, unknown> = { remainingQty: { $gt: 0 } };
  if (opts.productIds) match.productId = { $in: opts.productIds };
  return CostLayer.aggregate<{ _id: Types.ObjectId; qty: number; value: number; oldestLayerAt: Date }>([
    { $match: match },
    { $group: { _id: '$productId', qty: { $sum: '$remainingQty' }, value: { $sum: '$remainingCost' }, oldestLayerAt: { $min: '$receivedAt' } } },
  ]);
}
