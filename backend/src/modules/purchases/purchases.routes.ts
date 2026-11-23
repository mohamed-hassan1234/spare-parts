import { z } from 'zod';
import { LANDED_COST_METHODS } from '@autoparts/shared';
import { ModuleRouter, zCents, zDate, zId, zOptStr, zQty } from '../../utils/http.js';
import { Purchase, PurchaseReceipt, SupplierPayment, SupplierReturn } from './purchases.models.js';
import * as svc from './purchases.service.js';
import { PageQuery, escapeRegex, paginate } from '../../utils/pagination.js';
import { notFound } from '../../utils/errors.js';
import { Supplier } from '../partners/partners.models.js';

export const purchaseRoutes = new ModuleRouter('', 'Purchasing');
const r = purchaseRoutes;

const PurchaseBody = z.object({
  supplierId: zId,
  supplierInvoiceNo: zOptStr(60),
  reference: zOptStr(100),
  purchaseDate: zDate,
  expectedDate: zDate.optional(),
  freightCost: zCents.default(0),
  customsCost: zCents.default(0),
  otherCost: zCents.default(0),
  allocationMethod: z.enum(LANDED_COST_METHODS).default('VALUE'),
  notes: zOptStr(2000),
  items: z
    .array(z.object({ productId: zId, qtyOrdered: zQty, unitPrice: zCents, discount: zCents.optional(), manualExtraCost: zCents.optional() }))
    .min(1)
    .max(500),
  submit: z.boolean().optional(),
});

const idem = (h: unknown) => (typeof h === 'string' && h.length >= 8 && h.length <= 100 ? h : undefined);

r.get('/purchases', { summary: 'List purchases', permission: 'purchases:read', query: PageQuery.extend({ status: z.string().optional(), supplierId: zId.optional() }) }, async ({ query }) => {
  const f: Record<string, unknown> = {};
  if (query.status) f.status = { $in: query.status.split(',') };
  if (query.supplierId) f.supplierId = query.supplierId;
  if (query.search) {
    const rx = new RegExp(escapeRegex(query.search), 'i');
    const sups = await Supplier.find({ name: rx }).distinct('_id');
    f.$or = [{ purchaseNo: rx }, { supplierInvoiceNo: rx }, { reference: rx }, { supplierId: { $in: sups } }];
  }
  const page = await paginate(Purchase, f, query, ['purchaseDate', 'purchaseNo', 'total', 'createdAt'], { path: 'supplierId', select: 'name code' }, '-purchaseDate');
  return { ...page, items: page.items.map((p) => ({ ...p, outstanding: svc.purchaseOutstanding(p) })) };
});
r.post(
  '/purchases',
  { summary: 'Create a purchase (draft, or ordered with submit=true). Landed costs are allocated to lines.', permission: 'purchases:write', body: PurchaseBody },
  async ({ body, ctx }) => svc.createPurchase(body, ctx),
);
r.get('/purchases/:id', { summary: 'Purchase details with receipts and payments', permission: 'purchases:read' }, async ({ params }) => {
  const p = await Purchase.findById(zId.parse(params.id)).populate('supplierId', 'name code phone paymentTermsDays').lean();
  if (!p) throw notFound('Purchase');
  const [receipts, payments, returns] = await Promise.all([
    PurchaseReceipt.find({ purchaseId: p._id }).sort({ date: 1 }).lean(),
    SupplierPayment.find({ purchaseId: p._id }).sort({ date: 1 }).lean(),
    SupplierReturn.find({ purchaseId: p._id }).sort({ createdAt: 1 }).lean(),
  ]);
  return { ...p, outstanding: svc.purchaseOutstanding(p), receipts, payments, returns };
});
r.patch('/purchases/:id', { summary: 'Edit a draft purchase', permission: 'purchases:write', body: PurchaseBody.omit({ submit: true }) }, async ({ params, body, ctx }) =>
  svc.updateDraftPurchase(zId.parse(params.id), body, ctx),
);
r.post('/purchases/:id/order', { summary: 'Mark a draft as ordered', permission: 'purchases:write', status: 200 }, async ({ params, ctx }) => svc.markOrdered(zId.parse(params.id), ctx));
r.post(
  '/purchases/:id/cancel',
  { summary: 'Cancel a purchase with no receipts or payments', permission: 'purchases:write', status: 200, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
  async ({ params, body, ctx }) => svc.cancelPurchase(zId.parse(params.id), body.reason, ctx),
);
r.post(
  '/purchases/:id/receive',
  {
    summary: 'Receive goods (partial allowed). Creates FIFO layers, movements and Dr Inventory / Cr AP. Send Idempotency-Key.',
    permission: 'purchases:receive',
    headers: ['Idempotency-Key'],
    body: z.object({ lines: z.array(z.object({ itemId: zId, qty: z.number().int().min(0) })).min(1), date: zDate.optional(), notes: zOptStr(500) }),
  },
  async ({ params, body, req, ctx }) => svc.receivePurchase(zId.parse(params.id), body, idem(req.headers['idempotency-key']), ctx),
);
r.post('/purchases/:id/post', { summary: 'Post (close) a received purchase', permission: 'purchases:write', status: 200 }, async ({ params, ctx }) => svc.postPurchase(zId.parse(params.id), ctx));
r.post(
  '/purchases/:id/payments',
  {
    summary: 'Pay a supplier against this purchase. Send Idempotency-Key.',
    permission: 'purchases:pay',
    headers: ['Idempotency-Key'],
    body: z.object({ amount: zCents.min(1), method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY']), reference: zOptStr(100), date: zDate.optional(), notes: zOptStr(500) }),
  },
  async ({ params, body, req, ctx }) => {
    const p = await Purchase.findById(zId.parse(params.id)).lean();
    if (!p) throw notFound('Purchase');
    return svc.paySupplier({ ...body, supplierId: String(p.supplierId), purchaseId: String(p._id) }, idem(req.headers['idempotency-key']), ctx);
  },
);

r.get('/purchase-receipts', { summary: 'List goods-received notes', permission: 'purchases:read', query: PageQuery }, async ({ query }) => {
  const f: Record<string, unknown> = {};
  if (query.search) f.receiptNo = new RegExp(escapeRegex(query.search), 'i');
  return paginate(
    PurchaseReceipt,
    f,
    query,
    ['date', 'receiptNo'],
    [
      { path: 'supplierId', select: 'name' },
      { path: 'purchaseId', select: 'purchaseNo' },
      { path: 'lines.productId', select: 'sku name' },
    ],
    '-date',
  );
});

r.get('/supplier-payments', { summary: 'List supplier payments', permission: 'purchases:read', query: PageQuery.extend({ supplierId: zId.optional() }) }, async ({ query }) => {
  const f: Record<string, unknown> = {};
  if (query.supplierId) f.supplierId = query.supplierId;
  if (query.search) f.$or = [{ paymentNo: new RegExp(escapeRegex(query.search), 'i') }, { reference: new RegExp(escapeRegex(query.search), 'i') }];
  return paginate(
    SupplierPayment,
    f,
    query,
    ['date', 'amount'],
    [
      { path: 'supplierId', select: 'name' },
      { path: 'purchaseId', select: 'purchaseNo' },
    ],
    '-date',
  );
});
r.post(
  '/supplier-payments',
  {
    summary: 'Pay a supplier on account (optionally against a purchase). Send Idempotency-Key.',
    permission: 'purchases:pay',
    headers: ['Idempotency-Key'],
    body: z.object({
      supplierId: zId,
      purchaseId: zId.optional(),
      amount: zCents.min(1),
      method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY']),
      reference: zOptStr(100),
      date: zDate.optional(),
      notes: zOptStr(500),
    }),
  },
  async ({ body, req, ctx }) => svc.paySupplier(body, idem(req.headers['idempotency-key']), ctx),
);

r.get('/supplier-returns', { summary: 'List supplier returns', permission: 'purchases:read', query: PageQuery.extend({ status: z.string().optional() }) }, async ({ query }) => {
  const f: Record<string, unknown> = {};
  if (query.status) f.status = query.status;
  return paginate(
    SupplierReturn,
    f,
    query,
    ['createdAt'],
    [
      { path: 'supplierId', select: 'name' },
      { path: 'purchaseId', select: 'purchaseNo' },
    ],
  );
});
r.post(
  '/supplier-returns',
  {
    summary: 'Return goods to a supplier for credit or replacement',
    permission: 'purchases:write',
    body: z.object({
      supplierId: zId,
      purchaseId: zId.optional(),
      reason: z.enum(['DAMAGED', 'INCORRECT_ITEM', 'DEFECTIVE', 'OTHER']),
      settlement: z.enum(['CREDIT', 'REPLACEMENT']),
      notes: zOptStr(1000),
      lines: z.array(z.object({ productId: zId, qty: zQty })).min(1),
    }),
  },
  async ({ body, ctx }) => svc.createSupplierReturn(body, ctx),
);
r.post('/supplier-returns/:id/replacement', { summary: 'Receive replacement goods for a supplier return', permission: 'purchases:receive', status: 200 }, async ({ params, ctx }) =>
  svc.receiveReplacement(zId.parse(params.id), ctx),
);
