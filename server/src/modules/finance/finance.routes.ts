import { z } from 'zod';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { env } from '../../config/env.js';
import { Types } from 'mongoose';
import { EXPENSE_KINDS } from '@autoparts/shared';
import { ModuleRouter, zCents, zDate, zId, zOptStr } from '../../utils/http.js';
import { Expense, ExpenseCategory, RecurringExpense } from '../expenses/expenses.models.js';
import { CASH_TX_TYPES, createExpense, recordCashTransaction, recordRecurring, updateExpenseDetails, voidExpense } from '../expenses/expenses.service.js';
import { Account, JournalEntry, SOURCE_TYPES } from '../ledger/ledger.models.js';
import { reverseJournal } from '../ledger/ledger.service.js';
import * as rep from '../reports/reports.service.js';
import { PageQuery, escapeRegex, paginate } from '../../utils/pagination.js';
import { badRequest, notFound, unprocessable } from '../../utils/errors.js';
import { PERIOD_KEYS } from '../../utils/dates.js';
import { sendTable } from '../../utils/export.js';
import { withTx } from '../../utils/tx.js';
import { audit } from '../system/audit.service.js';

export const financeRoutes = new ModuleRouter('', 'Finance');
const r = financeRoutes;
const Period = z.object({ period: z.enum(PERIOD_KEYS).default('thisMonth'), from: z.string().optional(), to: z.string().optional() });
const idem = (h: unknown) => (typeof h === 'string' && h.length >= 8 && h.length <= 100 ? h : undefined);

/* ------------------------------- Expenses ------------------------------- */
r.get('/expense-categories', { summary: 'Expense categories', permission: 'expenses:read' }, async () => ExpenseCategory.find().sort({ kind: 1, name: 1 }).lean());
r.post(
  '/expense-categories',
  { summary: 'Create expense category', permission: 'expenses:write', body: z.object({ name: z.string().trim().min(2).max(80), kind: z.enum(EXPENSE_KINDS).default('OPERATING') }) },
  async ({ body, ctx }) => {
    const doc = await ExpenseCategory.create(body);
    await audit(ctx, 'expense_category.create', 'ExpenseCategory', doc._id, { summary: `${doc.name} (${doc.kind})` });
    return doc;
  },
);
r.patch(
  '/expense-categories/:id',
  {
    summary: 'Rename / deactivate category (kind is fixed once used)',
    permission: 'expenses:write',
    body: z.object({ name: z.string().trim().min(2).max(80).optional(), isActive: z.boolean().optional() }),
  },
  async ({ params, body, ctx }) => {
    const doc = await ExpenseCategory.findByIdAndUpdate(params.id, { $set: body }, { new: true });
    if (!doc) throw notFound('Expense category');
    await audit(ctx, 'expense_category.update', 'ExpenseCategory', doc._id, { after: body });
    return doc;
  },
);

const ExpenseBody = z.object({
  categoryId: zId,
  description: z.string().trim().min(2).max(300),
  amount: zCents.min(1),
  date: zDate,
  method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY']),
  reference: zOptStr(100),
  receiptUrl: zOptStr(500),
  notes: zOptStr(1000),
});
r.get(
  '/expenses',
  {
    summary: 'List expenses',
    permission: 'expenses:read',
    query: PageQuery.extend({
      categoryId: zId.optional(),
      kind: z.enum(EXPENSE_KINDS).optional(),
      status: z.enum(['POSTED', 'VOIDED']).optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
  },
  async ({ query }) => {
    const f: Record<string, unknown> = {};
    if (query.categoryId) f.categoryId = new Types.ObjectId(query.categoryId);
    if (query.kind) f.kind = query.kind;
    if (query.status) f.status = query.status;
    if (query.from || query.to) f.date = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lt: query.to } : {}) };
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      f.$or = [{ description: rx }, { expenseNo: rx }, { reference: rx }];
    }
    return paginate(Expense, f, query, ['date', 'amount'], { path: 'categoryId', select: 'name kind' }, '-date');
  },
);
r.post(
  '/expenses',
  { summary: 'Record an expense (kind follows its category: operating, capex, drawing, loan repayment)', permission: 'expenses:write', headers: ['Idempotency-Key'], body: ExpenseBody },
  async ({ body, req, ctx }) => createExpense(body, idem(req.headers['idempotency-key']), ctx),
);
r.get('/expenses/:id', { summary: 'Expense details', permission: 'expenses:read' }, async ({ params }) => {
  const e = await Expense.findById(zId.parse(params.id)).populate('categoryId', 'name kind').lean();
  if (!e) throw notFound('Expense');
  const journal = e.journalEntryId ? await JournalEntry.findById(e.journalEntryId).lean() : null;
  return { ...e, journal };
});
r.patch(
  '/expenses/:id',
  {
    summary: 'Edit descriptive fields. To change the amount, void and re-enter.',
    permission: 'expenses:write',
    body: z.object({ description: z.string().trim().min(2).max(300).optional(), reference: zOptStr(100), notes: zOptStr(1000), receiptUrl: zOptStr(500) }),
  },
  async ({ params, body, ctx }) => updateExpenseDetails(zId.parse(params.id), body, ctx),
);
r.post(
  '/expenses/:id/void',
  { summary: 'Void an expense with a reversing journal entry', permission: 'expenses:write', status: 200, body: z.object({ reason: z.string().trim().min(3).max(300) }) },
  async ({ params, body, ctx }) => voidExpense(zId.parse(params.id), body.reason, ctx),
);

/* Supporting documents (receipts, bills). Stored OUTSIDE the public /uploads folder and served only to authorised users. */
const attachmentDir = () => {
  const d = path.resolve(`${env.UPLOAD_DIR}-private`, 'expenses');
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
function sniffAttachment(b: Buffer): 'pdf' | 'png' | 'jpg' | null {
  if (b.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  return null;
}
r.post(
  '/expenses/:id/attachment',
  { summary: 'Attach a supporting document (PDF/PNG/JPEG ≤ 5 MB, multipart field "file")', permission: 'expenses:write', status: 200 },
  async ({ req, params, ctx }) => {
    const id = zId.parse(params.id);
    const e = await Expense.findById(id).lean();
    if (!e) throw notFound('Expense');
    if (!req.file) throw badRequest('Upload a PDF, PNG or JPEG in the "file" field');
    const ext = sniffAttachment(req.file.buffer);
    if (!ext) throw badRequest('Only PDF, PNG or JPEG files are accepted (file content checked)');
    const name = `${id}-${randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(attachmentDir(), name), req.file.buffer);
    const updated = await Expense.findByIdAndUpdate(id, { $set: { attachmentFile: name, receiptUrl: `/api/v1/expenses/${id}/attachment` } }, { new: true }).lean();
    await audit(ctx, 'expense.attachment', 'Expense', id, { summary: `${e.expenseNo}: ${ext.toUpperCase()} ${req.file.size} bytes` });
    return updated;
  },
  [attachmentUpload.single('file')],
);
r.get('/expenses/:id/attachment', { summary: 'Download the supporting document of an expense', permission: 'expenses:read', raw: true }, async ({ params, res }) => {
  const e = await Expense.findById(zId.parse(params.id)).lean();
  const file = (e as { attachmentFile?: string } | null)?.attachmentFile;
  if (!file) throw notFound('Attachment');
  const p = path.join(attachmentDir(), path.basename(file));
  if (!fs.existsSync(p)) throw notFound('Attachment file');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `inline; filename="${path.basename(file)}"`);
  // The path is built from path.basename() under a fixed directory, so dot-directories in UPLOAD_DIR are safe.
  res.sendFile(p, { dotfiles: 'allow' });
});

r.get('/recurring-expenses', { summary: 'Recurring expense templates', permission: 'expenses:read' }, async () => RecurringExpense.find().populate('categoryId', 'name kind').sort({ name: 1 }).lean());
r.post(
  '/recurring-expenses',
  {
    summary: 'Create recurring expense template',
    permission: 'expenses:write',
    body: z.object({
      name: z.string().trim().min(2).max(100),
      categoryId: zId,
      amount: zCents.min(1),
      method: z.enum(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY']),
      dayOfMonth: z.number().int().min(1).max(28).default(1),
    }),
  },
  async ({ body, ctx }) => {
    const doc = await RecurringExpense.create(body);
    await audit(ctx, 'recurring_expense.create', 'RecurringExpense', doc._id, { summary: doc.name });
    return doc;
  },
);
r.patch(
  '/recurring-expenses/:id',
  {
    summary: 'Update template',
    permission: 'expenses:write',
    body: z.object({ amount: zCents.min(1).optional(), isActive: z.boolean().optional(), dayOfMonth: z.number().int().min(1).max(28).optional(), name: z.string().trim().min(2).max(100).optional() }),
  },
  async ({ params, body, ctx }) => {
    const doc = await RecurringExpense.findByIdAndUpdate(params.id, { $set: body }, { new: true });
    if (!doc) throw notFound('Template');
    await audit(ctx, 'recurring_expense.update', 'RecurringExpense', doc._id, { after: body });
    return doc;
  },
);
r.post('/recurring-expenses/:id/record', { summary: 'Record this month’s occurrence (once per month)', permission: 'expenses:write' }, async ({ params, ctx }) =>
  recordRecurring(zId.parse(params.id), ctx),
);

/* -------------------------------- Ledger -------------------------------- */
r.get('/finance/accounts', { summary: 'Chart of accounts with balances', permission: 'finance:read' }, async () => (await rep.trialBalance()).rows);
r.get(
  '/finance/journal',
  {
    summary: 'General ledger journal entries',
    permission: 'finance:read',
    query: PageQuery.extend({ account: z.string().optional(), sourceType: z.enum(SOURCE_TYPES).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
  },
  async ({ query }) => {
    const f: Record<string, unknown> = {};
    if (query.account) f['lines.accountCode'] = query.account;
    if (query.sourceType) f.sourceType = query.sourceType;
    if (query.from || query.to) f.date = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lt: query.to } : {}) };
    if (query.search) {
      const rx = new RegExp(escapeRegex(query.search), 'i');
      f.$or = [{ entryNo: rx }, { memo: rx }, { sourceRef: rx }];
    }
    return paginate(JournalEntry, f, query, ['date', 'entryNo'], { path: 'postedBy', select: 'fullName' }, '-date');
  },
);
r.get('/finance/ledger/:account', { summary: 'Account ledger with running balance', permission: 'finance:read', query: Period }, async ({ params, query }) => {
  const acc = await Account.findOne({ code: params.account }).lean();
  if (!acc) throw notFound('Account');
  const range = await rep.rangeFrom(query);
  const st = await rep.cashStatement(acc.code, range);
  const sign = acc.normal === 'DEBIT' ? 1 : -1;
  return { account: acc, period: range, opening: sign * st.opening, closing: sign * st.closing, rows: st.rows.map((x) => ({ ...x, balance: sign * x.balance })) };
});
r.post(
  '/finance/journal/:id/reverse',
  {
    summary: 'Reverse a manual/capital/transfer entry (business documents are reversed via their own workflows)',
    permission: 'finance:write',
    status: 200,
    body: z.object({ reason: z.string().trim().min(3).max(300) }),
  },
  async ({ params, body, ctx }) => {
    const e = await JournalEntry.findById(zId.parse(params.id)).lean();
    if (!e) throw notFound('Journal entry');
    if (!['CAPITAL', 'TRANSFER', 'OPENING_BALANCE', 'MANUAL'].includes(e.sourceType) || e.sourceId) {
      throw unprocessable('Entries created by sales, purchases, returns, payments, adjustments or expenses must be corrected through those documents');
    }
    return withTx(async (session) => {
      const rev = await reverseJournal(e._id, body.reason, ctx.userId, session);
      await audit(ctx, 'journal.reverse', 'JournalEntry', e._id, { summary: `${e.entryNo}: ${body.reason}`, session });
      return rev;
    });
  },
);
r.post(
  '/finance/transactions',
  {
    summary: 'Owner capital, loans received, transfers between accounts, opening cash, other income/expense',
    permission: 'finance:write',
    body: z.object({ type: z.enum(CASH_TX_TYPES), amount: zCents.min(1), account: z.string(), fromAccount: z.string().optional(), date: zDate.optional(), memo: z.string().trim().min(2).max(300) }),
  },
  async ({ body, ctx }) => recordCashTransaction(body, ctx),
);

/* ------------------------------ Statements ------------------------------ */
r.get('/finance/trial-balance', { summary: 'Trial balance', permission: 'finance:read', query: z.object({ asOf: z.coerce.date().optional() }) }, async ({ query }) => rep.trialBalance(query.asOf));
r.get('/finance/balance-sheet', { summary: 'Balance sheet', permission: 'finance:read', query: z.object({ asOf: z.coerce.date().optional() }) }, async ({ query }) => rep.balanceSheet(query.asOf));
r.get('/finance/cash', { summary: 'Cash, bank and mobile money balances', permission: 'finance:read' }, async () => rep.cashPosition());
r.get('/finance/cash-statement/:account', { summary: 'Cash account statement', permission: 'finance:read', query: Period }, async ({ params, query }) => {
  const range = await rep.rangeFrom(query);
  return { period: range, ...(await rep.cashStatement(params.account, range)) };
});
r.get('/finance/reconciliation', { summary: 'Run integrity & reconciliation checks', permission: 'finance:read' }, async () => rep.reconciliation());

/* ---------------------------- Reports center ---------------------------- */
const ReportQuery = Period.extend({ format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'), unit: z.enum(['day', 'week', 'month', 'year']).default('day') });

r.get('/reports/profit-loss', { summary: 'Profit & loss statement', permission: 'reports:read', query: ReportQuery, raw: true }, async ({ query, res }) => {
  const range = await rep.rangeFrom(query);
  const pl = await rep.profitAndLoss(range);
  if (query.format === 'json') return void res.json({ data: { period: range, ...pl } });
  const rows: { line: string; amount: number }[] = [
    { line: 'Gross sales', amount: pl.grossSales },
    { line: 'Less: sales returns', amount: -pl.returns },
    { line: 'Less: sales discounts', amount: -pl.discounts },
    { line: 'Net sales', amount: pl.netSales },
    { line: 'Cost of goods sold', amount: -pl.cogs },
    { line: 'Gross profit', amount: pl.grossProfit },
    ...pl.expensesByCategory.map((e) => ({ line: `  ${e.category}`, amount: -e.amount })),
    { line: '  Inventory shrinkage & damage', amount: -pl.inventoryLoss },
    { line: 'Total operating expenses', amount: -pl.totalOperatingExpenses },
    { line: 'Operating profit', amount: pl.operatingProfit },
    { line: 'Other income', amount: pl.otherIncome },
    { line: 'Other expenses', amount: -pl.otherExpenses },
    { line: 'Net profit', amount: pl.netProfit },
  ];
  await sendTable(
    res,
    query.format,
    'profit-and-loss',
    'Profit & Loss',
    [
      { header: 'Line', value: (x) => x.line, width: 40 },
      { header: 'Amount', value: (x) => x.amount, money: true },
    ],
    rows,
    range.label,
  );
});

r.get(
  '/reports/sales',
  {
    summary: 'Sales analytics (by period, product, category, customer, payment method)',
    permission: 'reports:read',
    query: ReportQuery.extend({ view: z.enum(['series', 'product', 'category', 'customer', 'method']).default('series') }),
    raw: true,
  },
  async ({ query, res }) => {
    const range = await rep.rangeFrom(query);
    const data = await rep.salesReport(range, query.unit);
    if (query.format === 'json') return void res.json({ data: { period: range, ...data } });
    switch (query.view) {
      case 'product':
      case 'category':
        return sendTable(
          res,
          query.format,
          `sales-by-${query.view}`,
          `Sales by ${query.view}`,
          [
            { header: query.view === 'product' ? 'Product' : 'Category', value: (x) => x.name, width: 40 },
            { header: 'Qty', value: (x) => x.qty },
            { header: 'Net sales', value: (x) => x.netSales, money: true },
            { header: 'COGS', value: (x) => x.cogs, money: true },
            { header: 'Gross profit', value: (x) => x.grossProfit, money: true },
            { header: 'Margin %', value: (x) => x.marginPct },
          ],
          query.view === 'product' ? data.byProduct : data.byCategory,
          range.label,
        );
      case 'customer':
        return sendTable(
          res,
          query.format,
          'sales-by-customer',
          'Sales by customer',
          [
            { header: 'Customer', value: (x) => x.customer, width: 30 },
            { header: 'Invoices', value: (x) => x.invoices },
            { header: 'Total', value: (x) => x.total, money: true },
            { header: 'Outstanding', value: (x) => x.balanceDue, money: true },
          ],
          data.byCustomer,
          range.label,
        );
      case 'method':
        return sendTable(
          res,
          query.format,
          'sales-by-payment-method',
          'Receipts by payment method',
          [
            { header: 'Method', value: (x) => x.method },
            { header: 'Count', value: (x) => x.count },
            { header: 'Amount', value: (x) => x.amount, money: true },
          ],
          data.byPaymentMethod,
          range.label,
        );
      default:
        return sendTable(
          res,
          query.format,
          'sales-summary',
          'Sales summary',
          [
            { header: 'Period', value: (x) => x.period },
            { header: 'Net sales', value: (x) => x.netSales, money: true },
            { header: 'COGS', value: (x) => x.cogs, money: true },
            { header: 'Gross profit', value: (x) => x.grossProfit, money: true },
            { header: 'Expenses', value: (x) => x.expenses, money: true },
            { header: 'Net profit', value: (x) => x.netProfit, money: true },
          ],
          data.series,
          range.label,
        );
    }
  },
);

r.get('/reports/purchases', { summary: 'Purchase analytics', permission: 'reports:read', query: ReportQuery, raw: true }, async ({ query, res }) => {
  const range = await rep.rangeFrom(query);
  const data = await rep.purchasesReport(range);
  if (query.format === 'json') return void res.json({ data: { period: range, ...data } });
  await sendTable(
    res,
    query.format,
    'purchases-by-supplier',
    'Purchases by supplier',
    [
      { header: 'Supplier', value: (x) => x.supplier, width: 30 },
      { header: 'Receipts', value: (x) => x.receipts },
      { header: 'Amount', value: (x) => x.amount, money: true },
    ],
    data.bySupplier,
    range.label,
  );
});

r.get('/reports/inventory', { summary: 'Inventory analytics (valuation, aging, turnover, dead/slow/fast stock)', permission: 'reports:read' }, async () => rep.inventoryReport());

r.get('/reports/expenses', { summary: 'Expenses by category, month and kind', permission: 'reports:read', query: ReportQuery, raw: true }, async ({ query, res }) => {
  const range = await rep.rangeFrom(query);
  const data = await rep.expensesReport(range);
  if (query.format === 'json') return void res.json({ data: { period: range, ...data } });
  await sendTable(
    res,
    query.format,
    'expenses-by-category',
    'Expenses by category',
    [
      { header: 'Category', value: (x) => x.category, width: 30 },
      { header: 'Kind', value: (x) => x.kind },
      { header: 'Count', value: (x) => x.count },
      { header: 'Amount', value: (x) => x.amount, money: true },
    ],
    data.byCategory,
    range.label,
  );
});

r.get('/reports/cash-flow', { summary: 'Cash flow (opening, inflows/outflows by source, closing)', permission: 'reports:read', query: ReportQuery, raw: true }, async ({ query, res }) => {
  const range = await rep.rangeFrom(query);
  const data = await rep.cashFlow(range);
  if (query.format === 'json') return void res.json({ data: { period: range, ...data } });
  await sendTable(
    res,
    query.format,
    'cash-flow',
    'Cash flow',
    [
      { header: 'Source', value: (x) => x.label, width: 30 },
      { header: 'Inflow', value: (x) => x.inflow, money: true },
      { header: 'Outflow', value: (x) => x.outflow, money: true },
      { header: 'Net', value: (x) => x.net, money: true },
    ],
    data.lines,
    `${range.label}. Opening ${(data.openingBalance / 100).toFixed(2)}, closing ${(data.closingBalance / 100).toFixed(2)}`,
  );
});

r.get(
  '/reports/receivables',
  { summary: 'Accounts receivable aging', permission: 'reports:read', query: z.object({ format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json') }), raw: true },
  async ({ query, res }) => {
    const data = await rep.receivablesReport();
    if (query.format === 'json') return void res.json({ data });
    await sendTable(
      res,
      query.format,
      'receivables-aging',
      'Customer receivables aging',
      [
        { header: 'Customer', value: (x) => x.name, width: 30 },
        { header: 'Current', value: (x) => x.current, money: true },
        { header: '1-30', value: (x) => x.d1_30, money: true },
        { header: '31-60', value: (x) => x.d31_60, money: true },
        { header: '61-90', value: (x) => x.d61_90, money: true },
        { header: '90+', value: (x) => x.d90_plus, money: true },
        { header: 'Total', value: (x) => x.total, money: true },
      ],
      data.rows,
    );
  },
);
r.get(
  '/reports/payables',
  { summary: 'Accounts payable aging', permission: 'reports:read', query: z.object({ format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json') }), raw: true },
  async ({ query, res }) => {
    const data = await rep.payablesReport();
    if (query.format === 'json') return void res.json({ data });
    await sendTable(
      res,
      query.format,
      'payables-aging',
      'Supplier payables aging',
      [
        { header: 'Supplier', value: (x) => x.name, width: 30 },
        { header: 'Current', value: (x) => x.current, money: true },
        { header: '1-30', value: (x) => x.d1_30, money: true },
        { header: '31-60', value: (x) => x.d31_60, money: true },
        { header: '61-90', value: (x) => x.d61_90, money: true },
        { header: '90+', value: (x) => x.d90_plus, money: true },
        { header: 'Total', value: (x) => x.total, money: true },
      ],
      data.rows,
    );
  },
);
r.get('/reports/general-ledger', { summary: 'General ledger export', permission: 'reports:read', query: ReportQuery, raw: true }, async ({ query, res }) => {
  const range = await rep.rangeFrom(query);
  const entries = await JournalEntry.find({ date: { $gte: range.from, $lt: range.to } })
    .sort({ date: 1, entryNo: 1 })
    .lean();
  const rows = entries.flatMap((e) => e.lines.map((l) => ({ date: e.date, entryNo: e.entryNo, memo: e.memo, ref: e.sourceRef, account: l.accountCode, debit: l.debit, credit: l.credit })));
  if (query.format === 'json') return void res.json({ data: { period: range, rows } });
  await sendTable(
    res,
    query.format,
    'general-ledger',
    'General ledger',
    [
      { header: 'Date', value: (x) => x.date.toISOString().slice(0, 10) },
      { header: 'Entry', value: (x) => x.entryNo },
      { header: 'Reference', value: (x) => x.ref },
      { header: 'Memo', value: (x) => x.memo, width: 40 },
      { header: 'Account', value: (x) => x.account },
      { header: 'Debit', value: (x) => x.debit, money: true },
      { header: 'Credit', value: (x) => x.credit, money: true },
    ],
    rows,
    range.label,
  );
});
r.get(
  '/reports/trial-balance',
  { summary: 'Trial balance export', permission: 'reports:read', query: z.object({ format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json') }), raw: true },
  async ({ query, res }) => {
    const tb = await rep.trialBalance();
    if (query.format === 'json') return void res.json({ data: tb });
    await sendTable(
      res,
      query.format,
      'trial-balance',
      'Trial balance',
      [
        { header: 'Code', value: (x) => x.code },
        { header: 'Account', value: (x) => x.name, width: 35 },
        { header: 'Debit', value: (x) => x.debit, money: true },
        { header: 'Credit', value: (x) => x.credit, money: true },
      ],
      tb.rows,
      `Totals: Dr ${(tb.totalDebit / 100).toFixed(2)} / Cr ${(tb.totalCredit / 100).toFixed(2)}`,
    );
  },
);

/* ------------------------------- Dashboard ------------------------------ */
r.get('/dashboard/overview', { summary: 'Dashboard KPI cards for a period', permission: 'reports:read', query: Period }, async ({ query }) => rep.dashboardOverview(await rep.rangeFrom(query)));
r.get('/dashboard/charts', { summary: 'All dashboard chart datasets for a period', permission: 'reports:read', query: Period }, async ({ query }) => rep.dashboardCharts(await rep.rangeFrom(query)));
r.get(
  '/dashboard/sales-chart',
  { summary: 'Sales trend series', permission: 'reports:read', query: Period.extend({ unit: z.enum(['day', 'week', 'month', 'year']).default('day') }) },
  async ({ query }) => rep.salesSeries(await rep.rangeFrom(query), query.unit),
);
r.get('/dashboard/profit-chart', { summary: 'Monthly profit trend (last 12 months)', permission: 'reports:read' }, async () => {
  const range = await rep.rangeFrom({ period: 'all' });
  return (await rep.salesSeries(range, 'month')).slice(-12);
});
r.get('/dashboard/activity', { summary: 'Recent activity feed', permission: 'reports:read' }, async () => rep.recentActivity());
