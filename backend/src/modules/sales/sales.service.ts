import { onceByKey } from '../../utils/idempotency.js';
import { Types, type ClientSession } from 'mongoose';
import { ACCOUNTS, PAYMENT_METHOD_ACCOUNT, type PaymentMethod, type ReturnCondition } from '@autoparts/shared';
import { Sale, CustomerPayment, CustomerReturn, WarrantyClaim, type SaleDoc } from './sales.models.js';
import { allocatePayment, paymentStatusOf, priceCart, returnShare } from './pricing.js';
import { Product, Brand } from '../catalog/catalog.models.js';
import { Customer } from '../partners/partners.models.js';
import { getDefaultWarehouse, issueStock, receiveStock } from '../inventory/inventory.service.js';
import { InventoryBalance } from '../inventory/inventory.models.js';
import { customerBalance, postJournal } from '../ledger/ledger.service.js';
import { audit, notify } from '../system/audit.service.js';
import { nextNumber } from '../system/system.models.js';
import { getSettings } from '../settings/settings.model.js';
import { withTx } from '../../utils/tx.js';
import { sum } from '../../utils/money.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../utils/errors.js';
import { can, type Ctx } from '../../utils/http.js';

export interface CheckoutInput {
  customerId?: string;
  items: { productId: string; qty: number; unitPrice?: number; discount?: number }[];
  cartDiscount: number;
  payments: { method: PaymentMethod; amount: number; reference?: string }[];
  notes?: string;
  overrideMinimumPrice?: boolean;
}

function recomputeSaleState(s: SaleDoc) {
  s.balanceDue = s.total - s.returnedAmount - s.amountPaid + s.refundedAmount;
  s.paymentStatus = paymentStatusOf(s.total - s.returnedAmount, s.balanceDue);
  const allReturned = s.items.every((i) => i.qtyReturned === i.qty);
  const anyReturned = s.items.some((i) => i.qtyReturned > 0);
  s.status = allReturned ? 'RETURNED' : anyReturned ? 'PARTIALLY_RETURNED' : 'COMPLETED';
}

/** Post one customer payment (or store-credit use) and apply it to a sale, inside a transaction. */
async function recordSalePayment(sale: InstanceType<typeof Sale>, p: { method: PaymentMethod; amount: number; reference?: string }, ctx: Ctx, session: ClientSession, idempotencyKey?: string) {
  const paymentNo = await nextNumber('customerPayment', 'RCPT-', session);
  const id = new Types.ObjectId();
  const debitAccount = p.method === 'STORE_CREDIT' ? ACCOUNTS.CUSTOMER_CREDITS : PAYMENT_METHOD_ACCOUNT[p.method];
  const je = await postJournal(
    {
      date: new Date(),
      memo: `Payment ${paymentNo} for ${sale.invoiceNo} (${p.method})`,
      sourceType: 'CUSTOMER_PAYMENT',
      sourceId: id,
      sourceRef: paymentNo,
      postedBy: ctx.userId,
      lines: [
        { account: debitAccount, debit: p.amount, ...(p.method === 'STORE_CREDIT' ? { partyType: 'CUSTOMER' as const, partyId: sale.customerId } : {}) },
        { account: ACCOUNTS.ACCOUNTS_RECEIVABLE, credit: p.amount, partyType: 'CUSTOMER', partyId: sale.customerId },
      ],
    },
    session,
  );
  await CustomerPayment.create(
    [
      {
        _id: id,
        paymentNo,
        customerId: sale.customerId,
        amount: p.amount,
        method: p.method,
        reference: p.reference,
        date: new Date(),
        allocations: [{ saleId: sale._id, invoiceNo: sale.invoiceNo, amount: p.amount }],
        toCredit: 0,
        journalEntryId: je?._id,
        idempotencyKey,
        createdBy: ctx.userId,
      },
    ],
    { session },
  );
  sale.amountPaid += p.amount;
  return paymentNo;
}

/**
 * POS checkout. Everything — stock allocation (FIFO), sale document, inventory
 * movements, journal entries and payments — commits in one transaction or not at all.
 * The idempotency key makes client retries safe: a repeated key returns the original sale.
 */
export async function checkout(input: CheckoutInput, idempotencyKey: string, ctx: Ctx) {
  if (!idempotencyKey || idempotencyKey.length < 8) throw badRequest('Idempotency-Key header is required for checkout');
  const prior = await Sale.findOne({ idempotencyKey }).lean();
  if (prior) return { sale: prior, replayed: true };
  if (input.items.length === 0) throw badRequest('Cart is empty');
  const ids = input.items.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) throw badRequest('Each product may appear only once in the cart; adjust the quantity instead');

  const settings = await getSettings();
  const wh = await getDefaultWarehouse();

  try {
    const sale = await withTx(async (session) => {
      const customer = input.customerId ? await Customer.findById(input.customerId).session(session).lean() : null;
      if (input.customerId && !customer) throw notFound('Customer');
      if (customer && customer.status !== 'ACTIVE') throw unprocessable(`Customer is ${customer.status.toLowerCase()}`);

      const products = await Product.find({ _id: { $in: ids.map((x) => new Types.ObjectId(x)) } })
        .session(session)
        .lean();
      const byId = new Map(products.map((p) => [String(p._id), p]));
      const brands = await Brand.find({ _id: { $in: products.map((p) => p.brandId).filter(Boolean) } })
        .session(session)
        .lean();
      const brandName = new Map(brands.map((b) => [String(b._id), b.name]));

      const priceInputs = input.items.map((i) => {
        const p = byId.get(i.productId);
        if (!p) throw badRequest(`Unknown product ${i.productId}`);
        if (!p.isActive) throw unprocessable(`${p.sku} is archived and cannot be sold`);
        const unitPrice = i.unitPrice ?? p.sellingPrice;
        const discount = i.discount ?? 0;
        if (unitPrice !== p.sellingPrice && !can(ctx, 'sales:discount')) throw forbidden(`Changing the price of ${p.sku} requires discount permission`);
        return { p, qty: i.qty, unitPrice, discount };
      });

      let priced;
      try {
        priced = priceCart(priceInputs, input.cartDiscount, settings.taxRateBps, settings.pricesIncludeTax);
      } catch (e) {
        throw unprocessable((e as Error).message);
      }

      // Discount and minimum-price policy.
      const grossTotal = sum(priceInputs.map((x) => x.qty * x.p.sellingPrice));
      const chargedBeforeTax = sum(priceInputs.map((x) => x.qty * x.unitPrice - x.discount)) - input.cartDiscount;
      const totalDiscountGiven = grossTotal - chargedBeforeTax;
      if (grossTotal > 0 && (totalDiscountGiven * 10_000) / grossTotal > settings.maxDiscountBpsWithoutApproval && !can(ctx, 'sales:discount')) {
        throw forbidden('Discount exceeds the limit allowed without approval');
      }
      if (settings.enforceMinimumPrice) {
        priceInputs.forEach((x, k) => {
          const effectiveUnit = Math.floor((x.qty * x.unitPrice - x.discount - priced.lines[k].cartDiscountShare) / x.qty);
          if (x.p.minimumSellingPrice > 0 && effectiveUnit < x.p.minimumSellingPrice) {
            if (!(input.overrideMinimumPrice && can(ctx, 'sales:discount'))) {
              throw unprocessable(`${x.p.sku} would sell below its minimum price`, { productId: String(x.p._id), minimum: x.p.minimumSellingPrice, effective: effectiveUnit });
            }
          }
        });
      }

      // Payments validation.
      const paid = sum(input.payments.map((p) => p.amount));
      if (input.payments.some((p) => p.amount <= 0)) throw badRequest('Payment amounts must be positive');
      if (paid > priced.total) throw unprocessable('Payments exceed the invoice total. Give change for cash instead of recording it.');
      const outstanding = priced.total - paid;
      if (outstanding > 0) {
        if (!customer) throw unprocessable('Credit sales require a registered customer');
        const bal = await customerBalance(customer._id);
        if (customer.creditLimit <= 0) throw unprocessable('This customer is not allowed credit');
        if (bal.receivable + outstanding > customer.creditLimit) {
          throw unprocessable('Credit limit exceeded', { creditLimit: customer.creditLimit, currentBalance: bal.receivable, requested: outstanding });
        }
      }
      const creditUse = sum(input.payments.filter((p) => p.method === 'STORE_CREDIT').map((p) => p.amount));
      if (creditUse > 0) {
        if (!customer) throw unprocessable('Store credit requires a customer');
        const bal = await customerBalance(customer._id);
        if (creditUse > bal.storeCredit) throw unprocessable('Insufficient store credit', { available: bal.storeCredit });
      }

      const saleId = new Types.ObjectId();
      const invoiceNo = await nextNumber('invoice', settings.invoicePrefix, session);
      const now = new Date();

      // Allocate stock FIFO — atomic and oversell-safe.
      const items = [];
      for (const [k, x] of priceInputs.entries()) {
        const itemId = new Types.ObjectId();
        const { totalCost, allocations } = await issueStock(
          {
            productId: x.p._id,
            warehouseId: wh._id,
            qty: x.qty,
            movementType: 'SALE',
            sourceType: 'SALE',
            sourceId: saleId,
            sourceRef: invoiceNo,
            lineKey: String(itemId),
            userId: ctx.userId,
            at: now,
          },
          session,
        );
        const pl = priced.lines[k];
        items.push({
          _id: itemId,
          productId: x.p._id,
          sku: x.p.sku,
          name: x.p.name,
          partNumber: x.p.manufacturerPartNumber,
          brand: x.p.brandId ? brandName.get(String(x.p.brandId)) : undefined,
          categoryId: x.p.categoryId,
          qty: x.qty,
          unitPrice: x.unitPrice,
          discount: x.discount,
          cartDiscountShare: pl.cartDiscountShare,
          revenueEx: pl.revenueEx,
          discountEx: pl.discountEx,
          tax: pl.tax,
          lineTotal: pl.lineTotal,
          cogs: totalCost,
          allocations: allocations.map(({ layerId, qty, cost }) => ({ layerId, qty, cost })),
          warrantyMonths: x.p.warrantyMonths,
          qtyReturned: 0,
          returnedTotal: 0,
          returnedTax: 0,
          returnedCogs: 0,
        });
      }
      const cogsTotal = sum(items.map((i) => i.cogs));
      const party = { partyType: 'CUSTOMER' as const, partyId: customer?._id };
      const je = await postJournal(
        {
          date: now,
          memo: `Sale ${invoiceNo} to ${customer?.name ?? 'Walk-in customer'}`,
          sourceType: 'SALE',
          sourceId: saleId,
          sourceRef: invoiceNo,
          postedBy: ctx.userId,
          lines: [
            { account: ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: priced.total, ...party },
            ...items.map((i) => ({ account: ACCOUNTS.SALES_REVENUE, credit: i.revenueEx, productId: i.productId, categoryId: i.categoryId })),
            ...items.map((i) => ({ account: ACCOUNTS.SALES_DISCOUNTS, debit: i.discountEx, productId: i.productId, categoryId: i.categoryId })),
            { account: ACCOUNTS.TAX_PAYABLE, credit: priced.taxTotal },
            ...items.map((i) => ({ account: ACCOUNTS.COGS, debit: i.cogs, productId: i.productId, categoryId: i.categoryId })),
            ...items.map((i) => ({ account: ACCOUNTS.INVENTORY, credit: i.cogs, productId: i.productId })),
          ],
        },
        session,
      );

      const [sale] = await Sale.create(
        [
          {
            _id: saleId,
            invoiceNo,
            date: now,
            customerId: customer?._id,
            customerName: customer?.name ?? 'Walk-in customer',
            customerPhone: customer?.phone,
            warehouseId: wh._id,
            items,
            subtotal: priced.subtotal,
            discountTotal: priced.discountTotal,
            netSales: priced.netSales,
            taxTotal: priced.taxTotal,
            total: priced.total,
            cogsTotal,
            grossProfit: priced.netSales - cogsTotal,
            amountPaid: 0,
            returnedAmount: 0,
            refundedAmount: 0,
            balanceDue: priced.total,
            dueDate: outstanding > 0 && customer ? new Date(now.getTime() + customer.paymentTermsDays * 86_400_000) : undefined,
            status: 'COMPLETED',
            paymentStatus: 'UNPAID',
            taxRateBps: settings.taxRateBps,
            pricesIncludeTax: settings.pricesIncludeTax,
            notes: input.notes,
            idempotencyKey,
            journalEntryId: je?._id,
            createdBy: ctx.userId,
            createdByName: ctx.userName,
          },
        ],
        { session },
      );
      for (const p of input.payments) await recordSalePayment(sale, p, ctx, session);
      recomputeSaleState(sale);
      await sale.save({ session });
      await audit(ctx, 'sale.create', 'Sale', sale._id, {
        summary: `${invoiceNo} total ${priced.total}, paid ${paid}${input.overrideMinimumPrice ? ' — minimum price override approved' : ''}`,
        session,
      });
      return sale.toObject();
    });
    void checkStockAlerts(sale.items.map((i) => i.productId));
    return { sale, replayed: false };
  } catch (e) {
    if ((e as { code?: number }).code === 11000 && String((e as Error).message).includes('idempotencyKey')) {
      const existing = await Sale.findOne({ idempotencyKey }).lean();
      if (existing) return { sale: existing, replayed: true };
    }
    throw e;
  }
}

/** Raise low/out-of-stock notifications for the given products. */
export async function checkStockAlerts(productIds: Types.ObjectId[]) {
  const products = await Product.find({ _id: { $in: productIds } }).lean();
  const bals = await InventoryBalance.find({ productId: { $in: productIds } }).lean();
  for (const p of products) {
    const qty = bals.filter((b) => String(b.productId) === String(p._id)).reduce((s, b) => s + b.qtyAvailable, 0);
    if (qty <= 0) {
      await notify({
        type: 'OUT_OF_STOCK',
        severity: 'critical',
        title: `${p.sku} is out of stock`,
        message: `${p.name} has no available stock.`,
        link: `/inventory/products/${p._id}`,
        dedupeKey: `oos:${p._id}`,
      });
    } else if (qty <= p.reorderPoint) {
      await notify({
        type: 'LOW_STOCK',
        severity: 'warning',
        title: `${p.sku} is low on stock`,
        message: `${p.name}: ${qty} left (reorder point ${p.reorderPoint}, suggested order ${p.reorderQuantity}).`,
        link: `/inventory/products/${p._id}`,
        dedupeKey: `low:${p._id}`,
      });
    }
  }
}

/**
 * Receive a customer payment. With `saleId` it is applied to that invoice; otherwise
 * it is applied to the customer's open invoices oldest-first. Any excess is rejected
 * unless `allowCredit` is set, in which case it becomes store credit.
 */
export async function receiveCustomerPayment(
  input: { customerId?: string; saleId?: string; amount: number; method: Exclude<PaymentMethod, 'STORE_CREDIT'>; reference?: string; notes?: string; allowCredit?: boolean },
  idempotencyKey: string | undefined,
  ctx: Ctx,
) {
  if (idempotencyKey) {
    const prior = await CustomerPayment.findOne({ idempotencyKey }).lean();
    if (prior) return { payment: prior, replayed: true };
  }
  if (input.amount <= 0) throw unprocessable('Payment amount must be positive');
  return onceByKey(
    idempotencyKey,
    async () => {
      const p = await CustomerPayment.findOne({ idempotencyKey }).lean();
      return p ? { payment: p, replayed: true } : null;
    },
    () =>
      withTx(async (session) => {
        let customerId = input.customerId ? new Types.ObjectId(input.customerId) : undefined;
        let open: InstanceType<typeof Sale>[] = [];
        if (input.saleId) {
          const s = await Sale.findById(input.saleId).session(session);
          if (!s) throw notFound('Sale');
          if (customerId && String(s.customerId) !== String(customerId)) throw badRequest('Invoice belongs to a different customer');
          customerId = s.customerId;
          open = [s];
        } else {
          if (!customerId) throw badRequest('customerId or saleId is required');
          open = await Sale.find({ customerId, balanceDue: { $gt: 0 } })
            .sort({ date: 1, _id: 1 })
            .session(session);
        }
        const customer = customerId ? await Customer.findById(customerId).session(session).lean() : null;
        if (!customer && !input.saleId) throw notFound('Customer');
        const { allocations, remainder } = allocatePayment(
          input.amount,
          open.map((s) => ({ id: String(s._id), balanceDue: s.balanceDue })),
        );
        if (remainder > 0 && !input.allowCredit) {
          throw unprocessable(`Payment exceeds the open balance by ${remainder} cents. Reduce the amount or record the excess as store credit.`, { excess: remainder });
        }
        if (remainder > 0 && !customer) throw unprocessable('Store credit requires a registered customer');
        const paymentNo = await nextNumber('customerPayment', 'RCPT-', session);
        const id = new Types.ObjectId();
        const date = new Date();
        const applied = input.amount - remainder;
        const je = await postJournal(
          {
            date,
            memo: `Customer payment ${paymentNo}${customer ? ` from ${customer.name}` : ''}`,
            sourceType: 'CUSTOMER_PAYMENT',
            sourceId: id,
            sourceRef: paymentNo,
            postedBy: ctx.userId,
            lines: [
              { account: PAYMENT_METHOD_ACCOUNT[input.method], debit: input.amount },
              { account: ACCOUNTS.ACCOUNTS_RECEIVABLE, credit: applied, partyType: 'CUSTOMER', partyId: customerId },
              { account: ACCOUNTS.CUSTOMER_CREDITS, credit: remainder, partyType: 'CUSTOMER', partyId: customerId },
            ],
          },
          session,
        );
        const allocDocs = [];
        for (const a of allocations) {
          const s = open.find((x) => String(x._id) === a.id)!;
          s.amountPaid += a.amount;
          recomputeSaleState(s);
          await s.save({ session });
          allocDocs.push({ saleId: s._id, invoiceNo: s.invoiceNo, amount: a.amount });
        }
        const [payment] = await CustomerPayment.create(
          [
            {
              _id: id,
              paymentNo,
              customerId,
              amount: input.amount,
              method: input.method,
              reference: input.reference,
              date,
              allocations: allocDocs,
              toCredit: remainder,
              notes: input.notes,
              journalEntryId: je?._id,
              idempotencyKey,
              createdBy: ctx.userId,
            },
          ],
          { session },
        );
        await audit(ctx, 'customer.payment', 'CustomerPayment', id, { summary: `${paymentNo} ${input.amount}`, session });
        return { payment: payment.toObject(), replayed: false };
      }),
  );
}

export interface ReturnInput {
  reason: string;
  lines: { saleItemId: string; qty: number; condition: ReturnCondition }[];
  /** How to settle any amount already paid by the customer that exceeds what they now owe. */
  refundMethod?: PaymentMethod;
}

/**
 * Customer return against the original invoice. Revenue, tax and COGS are reversed
 * proportionally. Good items go back to sellable stock at their original cost; damaged
 * items are written off; uninspected items go to quarantine (never to sellable stock).
 */
export async function createCustomerReturn(saleId: string, input: ReturnInput, idempotencyKey: string | undefined, ctx: Ctx) {
  if (idempotencyKey) {
    const prior = await CustomerReturn.findOne({ idempotencyKey }).lean();
    if (prior) return { ret: prior, replayed: true };
  }
  const wh = await getDefaultWarehouse();
  return onceByKey(
    idempotencyKey,
    async () => {
      const r = await CustomerReturn.findOne({ idempotencyKey }).lean();
      return r ? { ret: r, replayed: true } : null;
    },
    () =>
      withTx(async (session) => {
        const sale = await Sale.findById(saleId).session(session);
        if (!sale) throw notFound('Sale');
        if (input.lines.length === 0) throw badRequest('Select at least one item to return');
        const returnId = new Types.ObjectId();
        const returnNo = await nextNumber('customerReturn', 'RET-', session);
        const party = { partyType: 'CUSTOMER' as const, partyId: sale.customerId };
        const lines = [];
        const jl: Parameters<typeof postJournal>[0]['lines'] = [];
        for (const l of input.lines) {
          const item = sale.items.find((i) => String(i._id) === l.saleItemId);
          if (!item) throw badRequest(`Item ${l.saleItemId} is not on invoice ${sale.invoiceNo}`);
          if (l.qty <= 0) throw badRequest('Return quantity must be positive');
          if (item.qtyReturned + l.qty > item.qty) throw unprocessable(`Cannot return ${l.qty} × ${item.sku}; only ${item.qty - item.qtyReturned} returnable`);
          const amount = returnShare(item.lineTotal, item.returnedTotal, l.qty, item.qtyReturned, item.qty);
          const tax = returnShare(item.tax, item.returnedTax, l.qty, item.qtyReturned, item.qty);
          const cost = returnShare(item.cogs, item.returnedCogs, l.qty, item.qtyReturned, item.qty);
          item.qtyReturned += l.qty;
          item.returnedTotal += amount;
          item.returnedTax += tax;
          item.returnedCogs += cost;

          jl.push({ account: ACCOUNTS.SALES_RETURNS, debit: amount - tax, productId: item.productId, categoryId: item.categoryId });
          jl.push({ account: ACCOUNTS.TAX_PAYABLE, debit: tax });
          jl.push({ account: ACCOUNTS.ACCOUNTS_RECEIVABLE, credit: amount, ...party });
          if (cost > 0) {
            const target = l.condition === 'GOOD' ? ACCOUNTS.INVENTORY : l.condition === 'DAMAGED' ? ACCOUNTS.INVENTORY_LOSS : ACCOUNTS.QUARANTINE_INVENTORY;
            jl.push({ account: target, debit: cost, productId: item.productId });
            jl.push({ account: ACCOUNTS.COGS, credit: cost, productId: item.productId, categoryId: item.categoryId });
          }
          if (l.condition === 'GOOD') {
            await receiveStock(
              {
                productId: item.productId,
                warehouseId: wh._id,
                qty: l.qty,
                totalCost: cost,
                movementType: 'CUSTOMER_RETURN',
                sourceType: 'CUSTOMER_RETURN',
                sourceId: returnId,
                sourceRef: `${returnNo} (${sale.invoiceNo})`,
                lineKey: String(item._id),
                reason: input.reason,
                userId: ctx.userId,
              },
              session,
            );
          }
          lines.push({ saleItemId: item._id, productId: item.productId, sku: item.sku, name: item.name, qty: l.qty, condition: l.condition, amount, tax, cost });
        }
        const totalAmount = sum(lines.map((l) => l.amount));
        sale.returnedAmount += totalAmount;
        recomputeSaleState(sale);

        // Customer had paid more than they now owe → settle the excess.
        let refundAmount = 0;
        if (sale.balanceDue < 0) {
          refundAmount = -sale.balanceDue;
          const method = input.refundMethod ?? 'CASH';
          if (method === 'STORE_CREDIT') {
            if (!sale.customerId) throw unprocessable('Store credit requires a registered customer');
            jl.push({ account: ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: refundAmount, ...party });
            jl.push({ account: ACCOUNTS.CUSTOMER_CREDITS, credit: refundAmount, ...party });
          } else {
            jl.push({ account: ACCOUNTS.ACCOUNTS_RECEIVABLE, debit: refundAmount, ...party });
            jl.push({ account: PAYMENT_METHOD_ACCOUNT[method], credit: refundAmount });
            const paymentNo = await nextNumber('customerPayment', 'RCPT-', session);
            await CustomerPayment.create(
              [
                {
                  paymentNo,
                  customerId: sale.customerId,
                  amount: refundAmount,
                  method,
                  date: new Date(),
                  kind: 'REFUND',
                  allocations: [{ saleId: sale._id, invoiceNo: sale.invoiceNo, amount: -refundAmount }],
                  toCredit: 0,
                  notes: `Refund for ${returnNo}`,
                  createdBy: ctx.userId,
                },
              ],
              { session },
            );
          }
          sale.refundedAmount += refundAmount;
          recomputeSaleState(sale);
        }
        const je = await postJournal(
          { memo: `Customer return ${returnNo} for ${sale.invoiceNo}`, sourceType: 'CUSTOMER_RETURN', sourceId: returnId, sourceRef: returnNo, postedBy: ctx.userId, lines: jl },
          session,
        );
        await sale.save({ session });
        const [ret] = await CustomerReturn.create(
          [
            {
              _id: returnId,
              returnNo,
              saleId: sale._id,
              invoiceNo: sale.invoiceNo,
              customerId: sale.customerId,
              date: new Date(),
              reason: input.reason,
              lines,
              totalAmount,
              refundAmount,
              refundMethod: refundAmount > 0 ? (input.refundMethod ?? 'CASH') : undefined,
              creditApplied: totalAmount - refundAmount,
              idempotencyKey,
              journalEntryId: je?._id,
              createdBy: ctx.userId,
            },
          ],
          { session },
        );
        await audit(ctx, 'sale.return', 'CustomerReturn', returnId, { summary: `${returnNo} on ${sale.invoiceNo}: ${totalAmount}`, session });
        return { ret: ret.toObject(), replayed: false };
      }),
  );
}

/** Decide on a returned item that was awaiting inspection. */
export async function inspectReturnLine(returnId: string, saleItemId: string, decision: 'RESTOCK' | 'WRITE_OFF', notes: string | undefined, ctx: Ctx) {
  const wh = await getDefaultWarehouse();
  return withTx(async (session) => {
    const ret = await CustomerReturn.findById(returnId).session(session);
    if (!ret) throw notFound('Return');
    const line = ret.lines.find((l) => String(l.saleItemId) === saleItemId && l.condition === 'PENDING_INSPECTION');
    if (!line) throw notFound('Pending return line');
    if (line.inspection?.decision) throw conflict('This item has already been inspected');
    if (decision === 'RESTOCK') {
      await receiveStock(
        {
          productId: line.productId,
          warehouseId: wh._id,
          qty: line.qty,
          totalCost: line.cost,
          movementType: 'CUSTOMER_RETURN',
          sourceType: 'RETURN_INSPECTION',
          sourceId: ret._id,
          sourceRef: `${ret.returnNo} inspection`,
          lineKey: saleItemId,
          reason: notes,
          userId: ctx.userId,
        },
        session,
      );
    }
    if (line.cost > 0) {
      await postJournal(
        {
          memo: `Inspection of ${line.sku} from ${ret.returnNo}: ${decision}`,
          sourceType: 'RETURN_INSPECTION',
          sourceId: ret._id,
          sourceRef: ret.returnNo,
          postedBy: ctx.userId,
          lines: [
            { account: decision === 'RESTOCK' ? ACCOUNTS.INVENTORY : ACCOUNTS.INVENTORY_LOSS, debit: line.cost, productId: line.productId },
            { account: ACCOUNTS.QUARANTINE_INVENTORY, credit: line.cost, productId: line.productId },
          ],
        },
        session,
      );
    }
    line.inspection = { decision, at: new Date(), by: ctx.userId, notes };
    ret.markModified('lines');
    await ret.save({ session });
    await audit(ctx, 'return.inspect', 'CustomerReturn', ret._id, { summary: `${line.sku}: ${decision}`, session });
    return ret.toObject();
  });
}

/* ------------------------------ Warranty ------------------------------ */

export async function createWarrantyClaim(input: { saleId: string; saleItemId: string; issue: string }, ctx: Ctx) {
  const sale = await Sale.findById(input.saleId).lean();
  if (!sale) throw notFound('Sale');
  const item = sale.items.find((i) => String(i._id) === input.saleItemId);
  if (!item) throw notFound('Invoice line');
  if (!item.warrantyMonths) throw unprocessable(`${item.sku} was sold without a warranty`);
  const start = sale.date;
  const end = new Date(start);
  end.setMonth(end.getMonth() + item.warrantyMonths);
  if (end < new Date()) throw unprocessable(`Warranty expired on ${end.toISOString().slice(0, 10)}`);
  return withTx(async (session) => {
    const claimNo = await nextNumber('warranty', 'WC-', session);
    const [doc] = await WarrantyClaim.create(
      [
        {
          claimNo,
          saleId: sale._id,
          saleItemId: item._id,
          invoiceNo: sale.invoiceNo,
          productId: item.productId,
          productName: `${item.sku} — ${item.name}`,
          customerId: sale.customerId,
          customerName: sale.customerName,
          warrantyStart: start,
          warrantyEnd: end,
          issue: input.issue,
          notes: [],
          createdBy: ctx.userId,
        },
      ],
      { session },
    );
    await audit(ctx, 'warranty.create', 'WarrantyClaim', doc._id, { summary: claimNo, session });
    return doc.toObject();
  });
}

export async function updateWarrantyClaim(
  id: string,
  input: {
    status?: 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED' | 'RESOLVED';
    note?: string;
    resolution?: 'REPLACED' | 'REPAIRED' | 'REFUNDED' | 'REJECTED' | 'OTHER';
    resolutionNotes?: string;
    replaceFromStock?: boolean;
  },
  ctx: Ctx,
) {
  const wh = await getDefaultWarehouse();
  return withTx(async (session) => {
    const c = await WarrantyClaim.findById(id).session(session);
    if (!c) throw notFound('Warranty claim');
    if (c.status === 'RESOLVED' || c.status === 'REJECTED') throw unprocessable('This claim is closed');
    if (input.note) c.notes.push({ at: new Date(), by: ctx.userId, text: input.note });
    if (input.status) c.status = input.status;
    if (input.resolution) {
      c.resolution = input.resolution;
      c.resolutionNotes = input.resolutionNotes;
      c.status = input.resolution === 'REJECTED' ? 'REJECTED' : 'RESOLVED';
      if (input.resolution === 'REPLACED' && input.replaceFromStock) {
        const { totalCost } = await issueStock(
          {
            productId: c.productId,
            warehouseId: wh._id,
            qty: 1,
            movementType: 'DAMAGE',
            sourceType: 'WARRANTY',
            sourceId: c._id,
            sourceRef: c.claimNo,
            lineKey: 'replacement',
            reason: 'Warranty replacement',
            userId: ctx.userId,
          },
          session,
        );
        c.replacementCost = totalCost;
        await postJournal(
          {
            memo: `Warranty replacement ${c.claimNo}`,
            sourceType: 'STOCK_ADJUSTMENT',
            sourceId: c._id,
            sourceRef: c.claimNo,
            postedBy: ctx.userId,
            lines: [
              { account: ACCOUNTS.INVENTORY_LOSS, debit: totalCost, productId: c.productId },
              { account: ACCOUNTS.INVENTORY, credit: totalCost, productId: c.productId },
            ],
          },
          session,
        );
      }
    }
    await c.save({ session });
    await audit(ctx, 'warranty.update', 'WarrantyClaim', c._id, { summary: `${c.claimNo} → ${c.status}`, session });
    return c.toObject();
  });
}
