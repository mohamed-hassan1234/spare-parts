import { z } from 'zod';
import { Types } from 'mongoose';
import { PAYMENT_METHODS, RETURN_CONDITIONS } from '@autoparts/shared';
import { ModuleRouter, zCents, zId, zOptStr, zQty } from '../../utils/http.js';
import { CustomerPayment, CustomerReturn, Sale, WarrantyClaim, WARRANTY_STATUSES } from './sales.models.js';
import * as svc from './sales.service.js';
import { renderInvoicePdf } from './invoice.pdf.js';
import { getSettings } from '../settings/settings.model.js';
import { PageQuery, escapeRegex, paginate } from '../../utils/pagination.js';
import { badRequest, notFound } from '../../utils/errors.js';

export const salesRoutes = new ModuleRouter('', 'Sales & POS');
const r = salesRoutes;
const idem = (h: unknown) => (typeof h === 'string' && h.length >= 8 && h.length <= 100 ? h : undefined);

const CheckoutBody = z.object({
  customerId: zId.optional(),
  items: z
    .array(z.object({ productId: zId, qty: zQty, unitPrice: zCents.optional(), discount: zCents.optional() }))
    .min(1)
    .max(200),
  cartDiscount: zCents.default(0),
  payments: z
    .array(z.object({ method: z.enum(PAYMENT_METHODS), amount: zCents.min(1), reference: zOptStr(100) }))
    .max(5)
    .default([]),
  notes: zOptStr(1000),
  overrideMinimumPrice: z.boolean().optional(),
});

r.get(
  '/sales',
  {
    summary: 'Sales history / invoice search',
    permission: 'sales:read',
    query: PageQuery.extend({
      customerId: zId.optional(),
      paymentStatus: z.enum(['PAID', 'PARTIAL', 'UNPAID']).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
      status: z.string().optional(),
    }),
  },
  async ({ query }) => {
    const f: Record<string, unknown> = {};
    if (query.customerId) f.customerId = new Types.ObjectId(query.customerId);
    if (query.paymentStatus) f.paymentStatus = query.paymentStatus;
    if (query.status) f.status = { $in: query.status.split(',') };
    if (query.from || query.to) f.date = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lt: query.to } : {}) };
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      f.$or = [{ invoiceNo: rx }, { customerName: rx }, { customerPhone: rx }, { 'items.sku': rx }];
    }
    const page = await paginate(Sale, f, query, ['date', 'total', 'invoiceNo', 'balanceDue'], undefined, '-date');
    return {
      ...page,
      items: page.items.map(({ items, ...s }) => ({ ...s, itemCount: items.length, items: items.map((i: { sku: string; name: string; qty: number }) => ({ sku: i.sku, name: i.name, qty: i.qty })) })),
    };
  },
);

r.post(
  '/sales',
  { summary: 'POS checkout. Requires Idempotency-Key header; repeats return the original sale (200).', permission: 'sales:create', headers: ['Idempotency-Key'], body: CheckoutBody },
  async ({ body, req, res, ctx }) => {
    const key = idem(req.headers['idempotency-key']);
    if (!key) throw badRequest('Idempotency-Key header (8–100 chars) is required');
    const out = await svc.checkout(body, key, ctx);
    res.status(out.replayed ? 200 : 201).json({ data: out });
  },
);

r.get('/sales/:id', { summary: 'Sale details with payments and returns', permission: 'sales:read' }, async ({ params }) => {
  const s = await Sale.findById(zId.parse(params.id)).populate('customerId', 'name code phone email').lean();
  if (!s) throw notFound('Sale');
  const [payments, returns, warranty] = await Promise.all([
    CustomerPayment.find({ 'allocations.saleId': s._id }).sort({ date: 1 }).lean(),
    CustomerReturn.find({ saleId: s._id }).sort({ date: 1 }).lean(),
    WarrantyClaim.find({ saleId: s._id }).lean(),
  ]);
  return { ...s, payments, returns, warrantyClaims: warranty };
});

r.get(
  '/sales/:id/invoice',
  { summary: 'Invoice PDF (format=a4|thermal)', permission: 'sales:read', query: z.object({ format: z.enum(['a4', 'thermal']).default('a4') }), raw: true },
  async ({ params, query, res }) => {
    const s = await Sale.findById(zId.parse(params.id)).lean();
    if (!s) throw notFound('Sale');
    const payments = await CustomerPayment.find({ 'allocations.saleId': s._id, kind: 'PAYMENT' }).lean();
    const byMethod = new Map<string, number>();
    for (const p of payments) {
      const a = p.allocations.find((x) => String(x.saleId) === String(s._id));
      byMethod.set(p.method, (byMethod.get(p.method) ?? 0) + (a?.amount ?? 0));
    }
    renderInvoicePdf(
      res,
      s,
      await getSettings(),
      query.format,
      [...byMethod].map(([method, amount]) => ({ method, amount })),
    );
  },
);

r.post(
  '/sales/:id/payments',
  {
    summary: 'Record a payment against an invoice',
    permission: 'customers:pay',
    headers: ['Idempotency-Key'],
    body: z.object({ amount: zCents.min(1), method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY']), reference: zOptStr(100), notes: zOptStr(500), allowCredit: z.boolean().optional() }),
  },
  async ({ params, body, req, ctx }) => svc.receiveCustomerPayment({ ...body, saleId: zId.parse(params.id) }, idem(req.headers['idempotency-key']), ctx),
);

r.post(
  '/sales/:id/returns',
  {
    summary: 'Return items from an invoice (full or partial)',
    permission: 'sales:return',
    headers: ['Idempotency-Key'],
    body: z.object({
      reason: z.string().trim().min(3).max(500),
      refundMethod: z.enum(PAYMENT_METHODS).optional(),
      lines: z.array(z.object({ saleItemId: zId, qty: zQty, condition: z.enum(RETURN_CONDITIONS) })).min(1),
    }),
  },
  async ({ params, body, req, ctx }) => svc.createCustomerReturn(zId.parse(params.id), body, idem(req.headers['idempotency-key']), ctx),
);

r.get(
  '/customer-payments',
  { summary: 'Customer payments and refunds', permission: 'sales:read', query: PageQuery.extend({ customerId: zId.optional(), method: z.enum(PAYMENT_METHODS).optional() }) },
  async ({ query }) => {
    const f: Record<string, unknown> = {};
    if (query.customerId) f.customerId = new Types.ObjectId(query.customerId);
    if (query.method) f.method = query.method;
    if (query.search)
      f.$or = [
        { paymentNo: new RegExp(escapeRegex(query.search), 'i') },
        { reference: new RegExp(escapeRegex(query.search), 'i') },
        { 'allocations.invoiceNo': new RegExp(escapeRegex(query.search), 'i') },
      ];
    return paginate(CustomerPayment, f, query, ['date', 'amount'], { path: 'customerId', select: 'name code' }, '-date');
  },
);
r.post(
  '/customer-payments',
  {
    summary: 'Receive a payment on account (allocated oldest invoice first). Excess requires allowCredit.',
    permission: 'customers:pay',
    headers: ['Idempotency-Key'],
    body: z.object({
      customerId: zId,
      amount: zCents.min(1),
      method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY']),
      reference: zOptStr(100),
      notes: zOptStr(500),
      allowCredit: z.boolean().optional(),
    }),
  },
  async ({ body, req, ctx }) => svc.receiveCustomerPayment(body, idem(req.headers['idempotency-key']), ctx),
);

r.get('/returns', { summary: 'Customer returns', permission: 'sales:read', query: PageQuery.extend({ pending: z.enum(['true', 'false']).optional() }) }, async ({ query }) => {
  const f: Record<string, unknown> = {};
  if (query.pending === 'true') f.lines = { $elemMatch: { condition: 'PENDING_INSPECTION', inspection: { $exists: false } } };
  if (query.search) f.$or = [{ returnNo: new RegExp(escapeRegex(query.search), 'i') }, { invoiceNo: new RegExp(escapeRegex(query.search), 'i') }];
  return paginate(CustomerReturn, f, query, ['date'], { path: 'customerId', select: 'name' }, '-date');
});
r.post(
  '/returns/:id/inspect',
  {
    summary: 'Inspect a returned item: restock or write off',
    permission: 'sales:return',
    status: 200,
    body: z.object({ saleItemId: zId, decision: z.enum(['RESTOCK', 'WRITE_OFF']), notes: zOptStr(500) }),
  },
  async ({ params, body, ctx }) => svc.inspectReturnLine(zId.parse(params.id), body.saleItemId, body.decision, body.notes, ctx),
);

r.get('/warranty-claims', { summary: 'Warranty claims', permission: 'warranty:read', query: PageQuery.extend({ status: z.enum(WARRANTY_STATUSES).optional() }) }, async ({ query }) => {
  const f: Record<string, unknown> = {};
  if (query.status) f.status = query.status;
  if (query.search)
    f.$or = [{ claimNo: new RegExp(escapeRegex(query.search), 'i') }, { invoiceNo: new RegExp(escapeRegex(query.search), 'i') }, { customerName: new RegExp(escapeRegex(query.search), 'i') }];
  return paginate(WarrantyClaim, f, query, ['createdAt'], undefined);
});
r.post(
  '/warranty-claims',
  { summary: 'Open a warranty claim for an invoice line', permission: 'warranty:write', body: z.object({ saleId: zId, saleItemId: zId, issue: z.string().trim().min(3).max(2000) }) },
  async ({ body, ctx }) => svc.createWarrantyClaim(body, ctx),
);
r.patch(
  '/warranty-claims/:id',
  {
    summary: 'Update / resolve a warranty claim',
    permission: 'warranty:write',
    body: z.object({
      status: z.enum(WARRANTY_STATUSES).optional(),
      note: zOptStr(2000),
      resolution: z.enum(['REPLACED', 'REPAIRED', 'REFUNDED', 'REJECTED', 'OTHER']).optional(),
      resolutionNotes: zOptStr(2000),
      replaceFromStock: z.boolean().optional(),
    }),
  },
  async ({ params, body, ctx }) => svc.updateWarrantyClaim(zId.parse(params.id), body, ctx),
);
