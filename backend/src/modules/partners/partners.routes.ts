import { z } from 'zod';
import { Types } from 'mongoose';
import { ACCOUNTS } from '@autoparts/shared';
import { ModuleRouter, zCents, zId, zOptStr } from '../../utils/http.js';
import { Customer, CUSTOMER_TYPES, Supplier } from './partners.models.js';
import { JournalEntry } from '../ledger/ledger.models.js';
import { customerBalance, supplierBalance } from '../ledger/ledger.service.js';
import { Purchase, SupplierPayment, SupplierReturn } from '../purchases/purchases.models.js';
import { Sale, CustomerPayment, CustomerReturn } from '../sales/sales.models.js';
import { nextNumber } from '../system/system.models.js';
import { audit } from '../system/audit.service.js';
import { PageQuery, escapeRegex, paginate } from '../../utils/pagination.js';
import { notFound } from '../../utils/errors.js';
import { rangeFrom } from '../reports/reports.service.js';
import { PERIOD_KEYS } from '../../utils/dates.js';
import { withTx } from '../../utils/tx.js';
import { sendTable } from '../../utils/export.js';

export const partnerRoutes = new ModuleRouter('', 'Suppliers & Customers');
const r = partnerRoutes;

const PeriodQuery = z.object({ period: z.enum(PERIOD_KEYS).default('all'), from: z.string().optional(), to: z.string().optional(), format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json') });

/** Party statement from the ledger: every AR/AP movement with a running balance. */
async function partyStatement(partyId: Types.ObjectId, accounts: string[], sign: 1 | -1, range: { from: Date; to: Date }) {
  const lineFilter = { 'lines.partyId': partyId, 'lines.accountCode': { $in: accounts } };
  const before = await JournalEntry.aggregate<{ b: number }>([
    { $match: { date: { $lt: range.from }, ...lineFilter } },
    { $unwind: '$lines' },
    { $match: lineFilter },
    { $group: { _id: null, b: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } } } },
  ]);
  let balance = sign * (before[0]?.b ?? 0);
  const opening = balance;
  const entries = await JournalEntry.find({ date: { $gte: range.from, $lt: range.to }, ...lineFilter })
    .sort({ date: 1, entryNo: 1 })
    .lean();
  const rows = entries.map((e) => {
    const d = e.lines.filter((l) => String(l.partyId) === String(partyId) && accounts.includes(l.accountCode)).reduce((s, l) => s + l.debit - l.credit, 0) * sign;
    balance += d;
    return { date: e.date, entryNo: e.entryNo, reference: e.sourceRef, type: e.sourceType, memo: e.memo, increase: d > 0 ? d : 0, decrease: d < 0 ? -d : 0, balance };
  });
  return { opening, closing: balance, rows };
}

/* ------------------------------- Suppliers ------------------------------ */
const SupplierInput = z.object({
  name: z.string().trim().min(2).max(150),
  contactPerson: zOptStr(100),
  phone: zOptStr(40),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  country: zOptStr(60),
  city: zOptStr(60),
  address: zOptStr(300),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  notes: zOptStr(2000),
});

r.get(
  '/suppliers',
  { summary: 'List suppliers with payable balances', permission: 'suppliers:read', query: PageQuery.extend({ status: z.enum(['ACTIVE', 'INACTIVE']).optional() }) },
  async ({ query }) => {
    const f: Record<string, unknown> = {};
    if (query.status) f.status = query.status;
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      f.$or = [{ name: rx }, { code: rx }, { contactPerson: rx }, { phone: rx }, { email: rx }];
    }
    const page = await paginate(Supplier, f, query, ['name', 'code', 'createdAt'], undefined, 'name');
    const items = await Promise.all(page.items.map(async (s) => ({ ...s, ...(await supplierBalance(s._id)) })));
    return { ...page, items };
  },
);
r.post('/suppliers', { summary: 'Register supplier', permission: 'suppliers:write', body: SupplierInput }, async ({ body, ctx }) =>
  withTx(async (session) => {
    const code = await nextNumber('supplier', 'SUP-', session, 4);
    const [doc] = await Supplier.create([{ ...body, code }], { session });
    await audit(ctx, 'supplier.create', 'Supplier', doc._id, { summary: `${code} ${doc.name}`, after: doc.toObject(), session });
    return doc.toObject();
  }),
);
r.get('/suppliers/:id', { summary: 'Supplier details, balance, purchases, payments, returns', permission: 'suppliers:read' }, async ({ params }) => {
  const id = new Types.ObjectId(zId.parse(params.id));
  const s = await Supplier.findById(id).lean();
  if (!s) throw notFound('Supplier');
  const [bal, purchases, payments, returns, totals] = await Promise.all([
    supplierBalance(id),
    Purchase.find({ supplierId: id }).sort({ purchaseDate: -1 }).limit(100).select('-items.allocations').lean(),
    SupplierPayment.find({ supplierId: id }).sort({ date: -1 }).limit(100).lean(),
    SupplierReturn.find({ supplierId: id }).sort({ createdAt: -1 }).limit(100).lean(),
    Purchase.aggregate([
      { $match: { supplierId: id, status: { $nin: ['DRAFT', 'CANCELLED'] } } },
      { $group: { _id: null, received: { $sum: '$receivedValue' }, paid: { $sum: '$amountPaid' }, last: { $max: '$purchaseDate' } } },
    ]),
  ]);
  const paidTotal = payments.reduce((a, p) => a + p.amount, 0);
  return {
    ...s,
    ...bal,
    totalPurchased: totals[0]?.received ?? 0,
    totalPaid: paidTotal,
    lastPurchaseDate: totals[0]?.last,
    totalReturned: returns.reduce((a, x) => a + x.totalCost, 0),
    purchases,
    payments,
    returns,
  };
});
r.patch('/suppliers/:id', { summary: 'Update supplier', permission: 'suppliers:write', body: SupplierInput.partial() }, async ({ params, body, ctx }) => {
  const before = await Supplier.findById(params.id).lean();
  if (!before) throw notFound('Supplier');
  const doc = await Supplier.findByIdAndUpdate(params.id, { $set: body }, { new: true, runValidators: true }).lean();
  await audit(ctx, 'supplier.update', 'Supplier', params.id, { before, after: doc });
  return doc;
});
r.get('/suppliers/:id/statement', { summary: 'Supplier statement (AP ledger with running balance)', permission: 'suppliers:read', query: PeriodQuery, raw: true }, async ({ params, query, res }) => {
  const s = await Supplier.findById(zId.parse(params.id)).lean();
  if (!s) throw notFound('Supplier');
  const range = await rangeFrom(query);
  const st = await partyStatement(s._id, [ACCOUNTS.ACCOUNTS_PAYABLE, ACCOUNTS.SUPPLIER_RECEIVABLE], -1, range);
  if (query.format !== 'json') {
    return sendTable(
      res,
      query.format,
      `statement-${s.code}`,
      `Statement — ${s.name}`,
      [
        { header: 'Date', value: (x) => x.date.toISOString().slice(0, 10) },
        { header: 'Reference', value: (x) => x.reference },
        { header: 'Description', value: (x) => x.memo },
        { header: 'Billed', value: (x) => x.increase, money: true },
        { header: 'Paid/Credited', value: (x) => x.decrease, money: true },
        { header: 'Balance', value: (x) => x.balance, money: true },
      ],
      st.rows,
      `${range.label}. Opening ${(st.opening / 100).toFixed(2)}, closing ${(st.closing / 100).toFixed(2)}`,
    );
  }
  res.json({ data: { supplier: s, period: range, ...st } });
});

/* ------------------------------- Customers ------------------------------ */
const CustomerInput = z.object({
  name: z.string().trim().min(2).max(150),
  phone: zOptStr(40),
  email: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  address: zOptStr(300),
  type: z.enum(CUSTOMER_TYPES).default('INDIVIDUAL'),
  creditLimit: zCents.default(0),
  paymentTermsDays: z.number().int().min(0).max(365).default(30),
  status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).default('ACTIVE'),
  notes: zOptStr(2000),
});

r.get(
  '/customers',
  {
    summary: 'List customers with balances',
    permission: 'customers:read',
    query: PageQuery.extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'BLOCKED']).optional(), withBalance: z.enum(['true', 'false']).optional() }),
  },
  async ({ query }) => {
    const f: Record<string, unknown> = {};
    if (query.status) f.status = query.status;
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      f.$or = [{ name: rx }, { code: rx }, { phone: rx }, { email: rx }];
    }
    if (query.withBalance === 'true') f._id = { $in: await Sale.distinct('customerId', { balanceDue: { $gt: 0 } }) };
    const page = await paginate(Customer, f, query, ['name', 'code', 'createdAt'], undefined, 'name');
    const items = await Promise.all(page.items.map(async (c) => ({ ...c, ...(await customerBalance(c._id)) })));
    return { ...page, items };
  },
);
r.post('/customers', { summary: 'Register customer', permission: 'customers:write', body: CustomerInput }, async ({ body, ctx }) =>
  withTx(async (session) => {
    const code = await nextNumber('customer', 'CUS-', session, 5);
    const [doc] = await Customer.create([{ ...body, code }], { session });
    await audit(ctx, 'customer.create', 'Customer', doc._id, { summary: `${code} ${doc.name}`, session });
    return doc.toObject();
  }),
);
r.get('/customers/:id', { summary: 'Customer details: balance, sales, payments, returns', permission: 'customers:read' }, async ({ params }) => {
  const id = new Types.ObjectId(zId.parse(params.id));
  const c = await Customer.findById(id).lean();
  if (!c) throw notFound('Customer');
  const [bal, sales, payments, returns, totals] = await Promise.all([
    customerBalance(id),
    Sale.find({ customerId: id }).sort({ date: -1 }).limit(200).select('invoiceNo date total amountPaid balanceDue returnedAmount status paymentStatus dueDate').lean(),
    CustomerPayment.find({ customerId: id }).sort({ date: -1 }).limit(200).lean(),
    CustomerReturn.find({ customerId: id }).sort({ date: -1 }).limit(100).lean(),
    Sale.aggregate([{ $match: { customerId: id } }, { $group: { _id: null, spent: { $sum: { $subtract: ['$total', '$returnedAmount'] } }, last: { $max: '$date' }, n: { $sum: 1 } } }]),
  ]);
  const now = new Date();
  return {
    ...c,
    ...bal,
    totalSpending: totals[0]?.spent ?? 0,
    invoiceCount: totals[0]?.n ?? 0,
    lastTransaction: totals[0]?.last,
    overdue: sales.filter((s) => s.balanceDue > 0 && s.dueDate && s.dueDate < now).reduce((a, s) => a + s.balanceDue, 0),
    availableCredit: Math.max(0, c.creditLimit - bal.receivable),
    sales,
    payments,
    returns,
  };
});
r.patch('/customers/:id', { summary: 'Update customer', permission: 'customers:write', body: CustomerInput.partial() }, async ({ params, body, ctx }) => {
  const before = await Customer.findById(params.id).lean();
  if (!before) throw notFound('Customer');
  const doc = await Customer.findByIdAndUpdate(params.id, { $set: body }, { new: true, runValidators: true }).lean();
  await audit(ctx, 'customer.update', 'Customer', params.id, { before, after: doc });
  return doc;
});
r.get('/customers/:id/statement', { summary: 'Customer statement (AR ledger with running balance)', permission: 'customers:read', query: PeriodQuery, raw: true }, async ({ params, query, res }) => {
  const c = await Customer.findById(zId.parse(params.id)).lean();
  if (!c) throw notFound('Customer');
  const range = await rangeFrom(query);
  const st = await partyStatement(c._id, [ACCOUNTS.ACCOUNTS_RECEIVABLE], 1, range);
  if (query.format !== 'json') {
    return sendTable(
      res,
      query.format,
      `statement-${c.code}`,
      `Statement — ${c.name}`,
      [
        { header: 'Date', value: (x) => x.date.toISOString().slice(0, 10) },
        { header: 'Reference', value: (x) => x.reference },
        { header: 'Description', value: (x) => x.memo },
        { header: 'Charges', value: (x) => x.increase, money: true },
        { header: 'Payments/Credits', value: (x) => x.decrease, money: true },
        { header: 'Balance', value: (x) => x.balance, money: true },
      ],
      st.rows,
      `${range.label}. Opening ${(st.opening / 100).toFixed(2)}, closing ${(st.closing / 100).toFixed(2)}`,
    );
  }
  res.json({ data: { customer: c, period: range, ...st } });
});
