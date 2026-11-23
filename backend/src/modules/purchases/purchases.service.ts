import { onceByKey } from '../../utils/idempotency.js';
import { Types } from 'mongoose';
import { ACCOUNTS, PAYMENT_METHOD_ACCOUNT, type LandedCostMethod, type PaymentMethod } from '@autoparts/shared';
import { Purchase, PurchaseReceipt, SupplierPayment, SupplierReturn, type PurchaseDoc } from './purchases.models.js';
import { Product } from '../catalog/catalog.models.js';
import { Supplier } from '../partners/partners.models.js';
import { getDefaultWarehouse, issueStock, receiveStock } from '../inventory/inventory.service.js';
import { postJournal } from '../ledger/ledger.service.js';
import { audit } from '../system/audit.service.js';
import { nextNumber } from '../system/system.models.js';
import { getSettings } from '../settings/settings.model.js';
import { withTx } from '../../utils/tx.js';
import { allocate, mulDiv, sum } from '../../utils/money.js';
import { badRequest, conflict, notFound, unprocessable } from '../../utils/errors.js';
import type { Ctx } from '../../utils/http.js';

export interface PurchaseLineInput {
  productId: string;
  qtyOrdered: number;
  unitPrice: number;
  discount?: number;
  manualExtraCost?: number;
}

/**
 * Allocate extra acquisition costs (freight, customs, other) to purchase lines.
 * Result always sums exactly to `extraTotal`.
 */
export function allocateLandedCost(lines: { lineNet: number; qty: number; weightGrams?: number; manualExtraCost?: number }[], extraTotal: number, method: LandedCostMethod): number[] {
  if (extraTotal === 0) return lines.map(() => 0);
  switch (method) {
    case 'VALUE':
      return allocate(
        extraTotal,
        lines.map((l) => l.lineNet),
      );
    case 'QUANTITY':
      return allocate(
        extraTotal,
        lines.map((l) => l.qty),
      );
    case 'WEIGHT': {
      if (lines.some((l) => !l.weightGrams || l.weightGrams <= 0)) {
        throw unprocessable('Weight-based allocation requires a weight for every product line');
      }
      return allocate(
        extraTotal,
        lines.map((l) => l.weightGrams! * l.qty),
      );
    }
    case 'MANUAL': {
      const manual = lines.map((l) => l.manualExtraCost ?? 0);
      if (sum(manual) !== extraTotal) throw unprocessable(`Manual allocations (${sum(manual)}) must equal total extra costs (${extraTotal})`);
      return manual;
    }
  }
}

export interface PurchaseInput {
  supplierId: string;
  supplierInvoiceNo?: string;
  reference?: string;
  purchaseDate: Date;
  expectedDate?: Date;
  freightCost: number;
  customsCost: number;
  otherCost: number;
  allocationMethod: LandedCostMethod;
  notes?: string;
  items: PurchaseLineInput[];
}

async function buildPurchase(input: PurchaseInput) {
  const supplier = await Supplier.findById(input.supplierId).lean();
  if (!supplier) throw notFound('Supplier');
  if (supplier.status !== 'ACTIVE') throw unprocessable('Supplier is inactive');
  const productIds = input.items.map((i) => new Types.ObjectId(i.productId));
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const seen = new Set<string>();
  const base = input.items.map((i) => {
    const p = byId.get(i.productId);
    if (!p) throw badRequest(`Unknown product ${i.productId}`);
    if (seen.has(i.productId)) throw badRequest(`Product ${p.sku} appears more than once; combine the lines`);
    seen.add(i.productId);
    const gross = i.qtyOrdered * i.unitPrice;
    const discount = i.discount ?? 0;
    if (discount > gross) throw unprocessable(`Discount on ${p.sku} exceeds line value`);
    return { p, i, lineNet: gross - discount, discount };
  });
  const extraTotal = input.freightCost + input.customsCost + input.otherCost;
  const extras = allocateLandedCost(
    base.map((b) => ({ lineNet: b.lineNet, qty: b.i.qtyOrdered, weightGrams: b.p.weightGrams, manualExtraCost: b.i.manualExtraCost })),
    extraTotal,
    input.allocationMethod,
  );
  const items = base.map((b, k) => ({
    productId: b.p._id,
    sku: b.p.sku,
    name: b.p.name,
    qtyOrdered: b.i.qtyOrdered,
    unitPrice: b.i.unitPrice,
    discount: b.discount,
    lineNet: b.lineNet,
    weightGrams: b.p.weightGrams,
    manualExtraCost: b.i.manualExtraCost,
    extraCost: extras[k],
    landedCost: b.lineNet + extras[k],
    qtyReceived: 0,
    costReceived: 0,
  }));
  const subtotal = sum(items.map((x) => x.lineNet));
  const dueDate = new Date(input.purchaseDate.getTime() + supplier.paymentTermsDays * 86_400_000);
  return { supplier, items, subtotal, extraTotal, total: subtotal + extraTotal, dueDate };
}

export async function createPurchase(input: PurchaseInput & { submit?: boolean }, ctx: Ctx) {
  const built = await buildPurchase(input);
  const settings = await getSettings();
  const wh = await getDefaultWarehouse();
  return withTx(async (session) => {
    const purchaseNo = await nextNumber('purchase', settings.purchasePrefix, session);
    const [doc] = await Purchase.create(
      [
        {
          purchaseNo,
          supplierId: built.supplier._id,
          supplierInvoiceNo: input.supplierInvoiceNo || undefined,
          reference: input.reference,
          purchaseDate: input.purchaseDate,
          expectedDate: input.expectedDate,
          dueDate: built.dueDate,
          status: input.submit ? 'ORDERED' : 'DRAFT',
          orderedAt: input.submit ? new Date() : undefined,
          warehouseId: wh._id,
          items: built.items,
          freightCost: input.freightCost,
          customsCost: input.customsCost,
          otherCost: input.otherCost,
          allocationMethod: input.allocationMethod,
          subtotal: built.subtotal,
          extraTotal: built.extraTotal,
          total: built.total,
          notes: input.notes,
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    await audit(ctx, 'purchase.create', 'Purchase', doc._id, { summary: `${purchaseNo} (${doc.status})`, after: doc.toObject(), session });
    return doc.toObject();
  });
}

export async function updateDraftPurchase(id: string, input: PurchaseInput, ctx: Ctx) {
  const existing = await Purchase.findById(id);
  if (!existing) throw notFound('Purchase');
  if (existing.status !== 'DRAFT') throw unprocessable('Only draft purchases can be edited');
  const built = await buildPurchase(input);
  return withTx(async (session) => {
    const before = existing.toObject();
    existing.set({
      supplierId: built.supplier._id,
      supplierInvoiceNo: input.supplierInvoiceNo || undefined,
      reference: input.reference,
      purchaseDate: input.purchaseDate,
      expectedDate: input.expectedDate,
      dueDate: built.dueDate,
      items: built.items,
      freightCost: input.freightCost,
      customsCost: input.customsCost,
      otherCost: input.otherCost,
      allocationMethod: input.allocationMethod,
      subtotal: built.subtotal,
      extraTotal: built.extraTotal,
      total: built.total,
      notes: input.notes,
    });
    await existing.save({ session });
    await audit(ctx, 'purchase.update', 'Purchase', existing._id, { before, after: existing.toObject(), session });
    return existing.toObject();
  });
}

export async function markOrdered(id: string, ctx: Ctx) {
  return withTx(async (session) => {
    const p = await Purchase.findOneAndUpdate({ _id: id, status: 'DRAFT' }, { $set: { status: 'ORDERED', orderedAt: new Date() } }, { new: true, session });
    if (!p) throw unprocessable('Only draft purchases can be ordered');
    await audit(ctx, 'purchase.order', 'Purchase', p._id, { summary: p.purchaseNo, session });
    return p.toObject();
  });
}

export async function cancelPurchase(id: string, reason: string, ctx: Ctx) {
  return withTx(async (session) => {
    const p = await Purchase.findById(id).session(session);
    if (!p) throw notFound('Purchase');
    if (!['DRAFT', 'ORDERED'].includes(p.status)) throw unprocessable('Only draft or ordered purchases with no receipts can be cancelled');
    if (p.amountPaid > 0) throw unprocessable('This purchase has payments recorded. Settle or reassign them before cancelling.');
    p.status = 'CANCELLED';
    p.cancelledAt = new Date();
    p.cancelReason = reason;
    await p.save({ session });
    await audit(ctx, 'purchase.cancel', 'Purchase', p._id, { summary: `${p.purchaseNo}: ${reason}`, session });
    return p.toObject();
  });
}

/**
 * Receive goods against an ordered purchase (supports partial receipts).
 * Atomically: creates FIFO layers + movements, updates line received totals,
 * and posts Dr Inventory / Cr Accounts Payable for the landed cost received.
 */
export async function receivePurchase(id: string, input: { lines: { itemId: string; qty: number }[]; date?: Date; notes?: string }, idempotencyKey: string | undefined, ctx: Ctx) {
  if (idempotencyKey) {
    const prior = await PurchaseReceipt.findOne({ idempotencyKey }).lean();
    if (prior) {
      if (String(prior.purchaseId) !== id) throw conflict('Idempotency key was already used for a different purchase');
      return { receipt: prior, replayed: true };
    }
  }
  return onceByKey(
    idempotencyKey,
    async () => {
      const r = await PurchaseReceipt.findOne({ idempotencyKey }).lean();
      return r ? { receipt: r, replayed: true } : null;
    },
    () =>
      withTx(async (session) => {
        const p = await Purchase.findById(id).session(session);
        if (!p) throw notFound('Purchase');
        if (!['ORDERED', 'PARTIALLY_RECEIVED'].includes(p.status)) throw unprocessable(`Cannot receive goods for a purchase in status ${p.status}`);
        const lines = input.lines.filter((l) => l.qty > 0);
        if (lines.length === 0) throw badRequest('Enter a received quantity for at least one line');
        const date = input.date ?? new Date();
        const receiptNo = await nextNumber('receipt', 'GRN-', session);
        const receiptId = new Types.ObjectId();
        const out: { itemId: Types.ObjectId; productId: Types.ObjectId; qty: number; cost: number }[] = [];
        for (const l of lines) {
          const item = p.items.find((x) => String(x._id) === l.itemId);
          if (!item) throw badRequest(`Unknown purchase line ${l.itemId}`);
          const outstanding = item.qtyOrdered - item.qtyReceived;
          if (l.qty > outstanding) throw unprocessable(`Cannot receive ${l.qty} of ${item.sku}; only ${outstanding} outstanding`);
          // Final receipt of a line takes the exact remaining landed cost so totals reconcile to the cent.
          const cost = l.qty === outstanding ? item.landedCost - item.costReceived : mulDiv(item.landedCost, l.qty, item.qtyOrdered);
          await receiveStock(
            {
              productId: item.productId,
              warehouseId: p.warehouseId,
              qty: l.qty,
              totalCost: cost,
              movementType: 'PURCHASE_RECEIPT',
              sourceType: 'PURCHASE_RECEIPT',
              sourceId: receiptId,
              sourceRef: `${p.purchaseNo} / ${receiptNo}`,
              lineKey: String(item._id),
              userId: ctx.userId,
              at: date,
            },
            session,
          );
          item.qtyReceived += l.qty;
          item.costReceived += cost;
          out.push({ itemId: item._id, productId: item.productId, qty: l.qty, cost });
          const unit = Math.round(cost / l.qty);
          const prod = await Product.findById(item.productId).session(session);
          if (prod && prod.lastPurchaseCost !== unit) {
            await Product.updateOne({ _id: prod._id }, { $set: { lastPurchaseCost: unit } }, { session });
          }
        }
        const totalCost = sum(out.map((o) => o.cost));
        const allDone = p.items.every((x) => x.qtyReceived === x.qtyOrdered);
        p.status = allDone ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
        p.receivedValue += totalCost;
        await p.save({ session });

        const je = await postJournal(
          {
            date,
            memo: `Goods received ${receiptNo} for ${p.purchaseNo}`,
            sourceType: 'PURCHASE_RECEIPT',
            sourceId: receiptId,
            sourceRef: receiptNo,
            postedBy: ctx.userId,
            lines: [
              ...out.map((o) => ({ account: ACCOUNTS.INVENTORY, debit: o.cost, productId: o.productId })),
              { account: ACCOUNTS.ACCOUNTS_PAYABLE, credit: totalCost, partyType: 'SUPPLIER' as const, partyId: p.supplierId },
            ],
          },
          session,
        );
        const [receipt] = await PurchaseReceipt.create(
          [{ _id: receiptId, receiptNo, purchaseId: p._id, supplierId: p.supplierId, date, lines: out, totalCost, journalEntryId: je?._id, idempotencyKey, notes: input.notes, createdBy: ctx.userId }],
          { session },
        );
        await audit(ctx, 'purchase.receive', 'Purchase', p._id, { summary: `${receiptNo}: ${out.length} line(s), cost ${totalCost}`, session });
        return { receipt: receipt.toObject(), purchase: p.toObject(), replayed: false };
      }),
  );
}

/** Close the purchase. Any un-received quantity is treated as not coming (short-closed). */
export async function postPurchase(id: string, ctx: Ctx) {
  return withTx(async (session) => {
    const p = await Purchase.findById(id).session(session);
    if (!p) throw notFound('Purchase');
    if (p.status === 'POSTED') throw conflict('Purchase has already been posted');
    if (!['RECEIVED', 'PARTIALLY_RECEIVED'].includes(p.status)) throw unprocessable('Receive goods before posting the purchase');
    p.status = 'POSTED';
    p.postedAt = new Date();
    p.postedBy = ctx.userId;
    await p.save({ session });
    await audit(ctx, 'purchase.post', 'Purchase', p._id, { summary: p.purchaseNo, session });
    return p.toObject();
  });
}

/** Amount still owed on a purchase: value received minus returns credited minus payments. */
export function purchaseOutstanding(p: Pick<PurchaseDoc, 'receivedValue' | 'returnedValue' | 'amountPaid'>) {
  return p.receivedValue - p.returnedValue - p.amountPaid;
}

export async function paySupplier(
  input: { supplierId: string; purchaseId?: string; amount: number; method: Exclude<PaymentMethod, 'STORE_CREDIT'>; reference?: string; date?: Date; notes?: string },
  idempotencyKey: string | undefined,
  ctx: Ctx,
) {
  if (idempotencyKey) {
    const prior = await SupplierPayment.findOne({ idempotencyKey }).lean();
    if (prior) return { payment: prior, replayed: true };
  }
  if (input.amount <= 0) throw unprocessable('Payment amount must be positive');
  return onceByKey(
    idempotencyKey,
    async () => {
      const p = await SupplierPayment.findOne({ idempotencyKey }).lean();
      return p ? { payment: p, replayed: true } : null;
    },
    () =>
      withTx(async (session) => {
        const supplier = await Supplier.findById(input.supplierId).session(session).lean();
        if (!supplier) throw notFound('Supplier');
        let purchase: InstanceType<typeof Purchase> | null = null;
        if (input.purchaseId) {
          purchase = await Purchase.findById(input.purchaseId).session(session);
          if (!purchase) throw notFound('Purchase');
          if (String(purchase.supplierId) !== String(supplier._id)) throw badRequest('Purchase belongs to a different supplier');
          if (purchase.status === 'CANCELLED' || purchase.status === 'DRAFT') throw unprocessable('Cannot pay a draft or cancelled purchase');
          // Advance payments are allowed up to the ordered total; never more.
          const maxPayable = purchase.total - purchase.returnedValue - purchase.amountPaid;
          if (input.amount > maxPayable) throw unprocessable(`Payment exceeds the remaining purchase amount (${maxPayable} cents)`);
          purchase.amountPaid += input.amount;
          await purchase.save({ session });
        }
        const paymentNo = await nextNumber('supplierPayment', 'SPAY-', session);
        const id = new Types.ObjectId();
        const date = input.date ?? new Date();
        const je = await postJournal(
          {
            date,
            memo: `Payment ${paymentNo} to ${supplier.name}${purchase ? ` for ${purchase.purchaseNo}` : ''}`,
            sourceType: 'SUPPLIER_PAYMENT',
            sourceId: id,
            sourceRef: paymentNo,
            postedBy: ctx.userId,
            lines: [
              { account: ACCOUNTS.ACCOUNTS_PAYABLE, debit: input.amount, partyType: 'SUPPLIER', partyId: supplier._id },
              { account: PAYMENT_METHOD_ACCOUNT[input.method], credit: input.amount },
            ],
          },
          session,
        );
        const [payment] = await SupplierPayment.create(
          [
            {
              _id: id,
              paymentNo,
              supplierId: supplier._id,
              purchaseId: purchase?._id,
              amount: input.amount,
              method: input.method,
              reference: input.reference,
              date,
              notes: input.notes,
              journalEntryId: je?._id,
              idempotencyKey,
              createdBy: ctx.userId,
            },
          ],
          { session },
        );
        await audit(ctx, 'supplier.payment', 'SupplierPayment', id, { summary: `${paymentNo} ${input.amount} to ${supplier.name}`, session });
        return { payment: payment.toObject(), replayed: false };
      }),
  );
}

/** Return goods to a supplier: removes stock at FIFO cost and credits AP (or records a replacement claim). */
export async function createSupplierReturn(
  input: {
    supplierId: string;
    purchaseId?: string;
    reason: 'DAMAGED' | 'INCORRECT_ITEM' | 'DEFECTIVE' | 'OTHER';
    settlement: 'CREDIT' | 'REPLACEMENT';
    notes?: string;
    lines: { productId: string; qty: number }[];
  },
  ctx: Ctx,
) {
  const wh = await getDefaultWarehouse();
  return withTx(async (session) => {
    const supplier = await Supplier.findById(input.supplierId).session(session).lean();
    if (!supplier) throw notFound('Supplier');
    let purchase: InstanceType<typeof Purchase> | null = null;
    if (input.purchaseId) {
      purchase = await Purchase.findById(input.purchaseId).session(session);
      if (!purchase || String(purchase.supplierId) !== String(supplier._id)) throw badRequest('Purchase does not belong to this supplier');
    }
    const returnNo = await nextNumber('supplierReturn', 'SRET-', session);
    const id = new Types.ObjectId();
    const lines = [];
    for (const [k, l] of input.lines.entries()) {
      const prod = await Product.findById(l.productId).session(session).lean();
      if (!prod) throw badRequest(`Unknown product ${l.productId}`);
      if (purchase) {
        const item = purchase.items.find((x) => String(x.productId) === l.productId);
        if (!item) throw unprocessable(`${prod.sku} is not on purchase ${purchase.purchaseNo}`);
        const alreadyReturned = await SupplierReturn.aggregate([
          { $match: { purchaseId: purchase._id } },
          { $unwind: '$lines' },
          { $match: { 'lines.productId': prod._id } },
          { $group: { _id: null, q: { $sum: '$lines.qty' } } },
        ]).session(session);
        const prior = alreadyReturned[0]?.q ?? 0;
        if (l.qty + prior > item.qtyReceived) throw unprocessable(`Cannot return more ${prod.sku} than was received (${item.qtyReceived - prior} returnable)`);
      }
      const { totalCost } = await issueStock(
        {
          productId: prod._id,
          warehouseId: wh._id,
          qty: l.qty,
          movementType: 'SUPPLIER_RETURN',
          sourceType: 'SUPPLIER_RETURN',
          sourceId: id,
          sourceRef: returnNo,
          lineKey: `${k}:${prod._id}`,
          reason: input.reason,
          userId: ctx.userId,
        },
        session,
      );
      lines.push({ productId: prod._id, sku: prod.sku, name: prod.name, qty: l.qty, cost: totalCost, qtyReplaced: 0 });
    }
    const totalCost = sum(lines.map((l) => l.cost));
    const debitAccount = input.settlement === 'CREDIT' ? ACCOUNTS.ACCOUNTS_PAYABLE : ACCOUNTS.SUPPLIER_RECEIVABLE;
    const je = await postJournal(
      {
        memo: `Supplier return ${returnNo} to ${supplier.name} (${input.settlement === 'CREDIT' ? 'credit note' : 'awaiting replacement'})`,
        sourceType: 'SUPPLIER_RETURN',
        sourceId: id,
        sourceRef: returnNo,
        postedBy: ctx.userId,
        lines: [
          { account: debitAccount, debit: totalCost, partyType: 'SUPPLIER', partyId: supplier._id },
          ...lines.map((l) => ({ account: ACCOUNTS.INVENTORY, credit: l.cost, productId: l.productId })),
        ],
      },
      session,
    );
    if (purchase && input.settlement === 'CREDIT') {
      purchase.returnedValue += totalCost;
      await purchase.save({ session });
    }
    const [doc] = await SupplierReturn.create(
      [
        {
          _id: id,
          returnNo,
          supplierId: supplier._id,
          purchaseId: purchase?._id,
          reason: input.reason,
          settlement: input.settlement,
          status: input.settlement === 'CREDIT' ? 'CREDITED' : 'AWAITING_REPLACEMENT',
          lines,
          totalCost,
          notes: input.notes,
          journalEntryId: je?._id,
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    await audit(ctx, 'supplier.return', 'SupplierReturn', id, { summary: `${returnNo} cost ${totalCost}`, session });
    return doc.toObject();
  });
}

/** Receive replacement goods for a supplier return: stock comes back at the cost that left. */
export async function receiveReplacement(returnId: string, ctx: Ctx) {
  const wh = await getDefaultWarehouse();
  return withTx(async (session) => {
    const r = await SupplierReturn.findById(returnId).session(session);
    if (!r) throw notFound('Supplier return');
    if (r.status !== 'AWAITING_REPLACEMENT') throw unprocessable('This return is not awaiting a replacement');
    for (const [k, l] of r.lines.entries()) {
      await receiveStock(
        {
          productId: l.productId,
          warehouseId: wh._id,
          qty: l.qty,
          totalCost: l.cost,
          movementType: 'PURCHASE_RECEIPT',
          sourceType: 'SUPPLIER_REPLACEMENT',
          sourceId: r._id,
          sourceRef: `${r.returnNo} replacement`,
          lineKey: `${k}:${l.productId}`,
          userId: ctx.userId,
        },
        session,
      );
      l.qtyReplaced = l.qty;
    }
    await postJournal(
      {
        memo: `Replacement received for ${r.returnNo}`,
        sourceType: 'SUPPLIER_RETURN',
        sourceId: r._id,
        sourceRef: `${r.returnNo}-R`,
        postedBy: ctx.userId,
        lines: [
          ...r.lines.map((l) => ({ account: ACCOUNTS.INVENTORY, debit: l.cost, productId: l.productId })),
          { account: ACCOUNTS.SUPPLIER_RECEIVABLE, credit: r.totalCost, partyType: 'SUPPLIER' as const, partyId: r.supplierId },
        ],
      },
      session,
    );
    r.status = 'REPLACED';
    await r.save({ session });
    await audit(ctx, 'supplier.replacement', 'SupplierReturn', r._id, { summary: r.returnNo, session });
    return r.toObject();
  });
}
