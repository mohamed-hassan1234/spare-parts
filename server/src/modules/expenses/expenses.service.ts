import { onceByKey } from '../../utils/idempotency.js';
import { Types } from 'mongoose';
import { ACCOUNTS, PAYMENT_METHOD_ACCOUNT, type ExpenseKind, type PaymentMethod } from '@autoparts/shared';
import { DEFAULT_EXPENSE_CATEGORIES, Expense, ExpenseCategory, RecurringExpense } from './expenses.models.js';
import { accountBalance, postJournal, reverseJournal } from '../ledger/ledger.service.js';
import { audit } from '../system/audit.service.js';
import { nextNumber } from '../system/system.models.js';
import { withTx } from '../../utils/tx.js';
import { conflict, notFound, unprocessable } from '../../utils/errors.js';
import type { Ctx } from '../../utils/http.js';
import { getSettings } from '../settings/settings.model.js';
import { localDateKey } from '../../utils/dates.js';

/** Which ledger account each kind of outflow is charged to. Only OPERATING hits the P&L as an operating expense. */
export const KIND_ACCOUNT: Record<ExpenseKind, string> = {
  OPERATING: ACCOUNTS.OPERATING_EXPENSES,
  CAPITAL_EXPENDITURE: ACCOUNTS.FIXED_ASSETS,
  OWNER_DRAWING: ACCOUNTS.OWNER_DRAWINGS,
  LOAN_REPAYMENT: ACCOUNTS.LOANS_PAYABLE,
};

export async function ensureExpenseCategories() {
  for (const c of DEFAULT_EXPENSE_CATEGORIES) {
    await ExpenseCategory.updateOne({ name: c.name }, { $setOnInsert: { ...c, isActive: true } }, { upsert: true, collation: { locale: 'en', strength: 2 } });
  }
}

export interface ExpenseInput {
  categoryId: string;
  description: string;
  amount: number;
  date: Date;
  method: Exclude<PaymentMethod, 'STORE_CREDIT'>;
  reference?: string;
  receiptUrl?: string;
  notes?: string;
}

export async function createExpense(input: ExpenseInput, idempotencyKey: string | undefined, ctx: Ctx, recurringTemplateId?: Types.ObjectId) {
  if (idempotencyKey) {
    const prior = await Expense.findOne({ idempotencyKey }).lean();
    if (prior) return prior;
  }
  const cat = await ExpenseCategory.findById(input.categoryId).lean();
  if (!cat) throw notFound('Expense category');
  if (input.amount <= 0) throw unprocessable('Expense amount must be positive');
  return onceByKey(
    idempotencyKey,
    () => Expense.findOne({ idempotencyKey }).lean(),
    () =>
      withTx(async (session) => {
        const expenseNo = await nextNumber('expense', 'EXP-', session);
        const id = new Types.ObjectId();
        const je = await postJournal(
          {
            date: input.date,
            memo: `${cat.name}: ${input.description}`,
            sourceType: 'EXPENSE',
            sourceId: id,
            sourceRef: expenseNo,
            postedBy: ctx.userId,
            lines: [
              { account: KIND_ACCOUNT[cat.kind], debit: input.amount, expenseCategoryId: cat._id },
              { account: PAYMENT_METHOD_ACCOUNT[input.method], credit: input.amount },
            ],
          },
          session,
        );
        const [doc] = await Expense.create(
          [
            {
              _id: id,
              expenseNo,
              kind: cat.kind,
              categoryId: cat._id,
              description: input.description,
              amount: input.amount,
              date: input.date,
              method: input.method,
              reference: input.reference,
              receiptUrl: input.receiptUrl,
              notes: input.notes,
              journalEntryId: je?._id,
              recurringTemplateId,
              idempotencyKey,
              createdBy: ctx.userId,
            },
          ],
          { session },
        );
        await audit(ctx, 'expense.create', 'Expense', id, { summary: `${expenseNo} ${cat.name} ${input.amount}`, after: doc.toObject(), session });
        return doc.toObject();
      }),
  );
}

/** Only descriptive fields may change after posting; financial fields require void + re-entry. */
export async function updateExpenseDetails(id: string, patch: { description?: string; reference?: string; notes?: string; receiptUrl?: string }, ctx: Ctx) {
  const before = await Expense.findById(id).lean();
  if (!before) throw notFound('Expense');
  const after = await Expense.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean();
  await audit(ctx, 'expense.update', 'Expense', id, { before, after });
  return after;
}

export async function voidExpense(id: string, reason: string, ctx: Ctx) {
  return withTx(async (session) => {
    const e = await Expense.findById(id).session(session);
    if (!e) throw notFound('Expense');
    if (e.status === 'VOIDED') throw conflict('Expense is already voided');
    if (e.journalEntryId) await reverseJournal(e.journalEntryId, `Void ${e.expenseNo}: ${reason}`, ctx.userId, session);
    e.status = 'VOIDED';
    e.voidReason = reason;
    await e.save({ session });
    await audit(ctx, 'expense.void', 'Expense', e._id, { summary: `${e.expenseNo}: ${reason}`, session });
    return e.toObject();
  });
}

export async function recordRecurring(templateId: string, ctx: Ctx) {
  const t = await RecurringExpense.findById(templateId);
  if (!t || !t.isActive) throw notFound('Recurring expense template');
  const settings = await getSettings();
  const period = localDateKey(new Date(), settings.timezone).slice(0, 7);
  if (t.lastRecordedPeriod === period) throw conflict(`"${t.name}" has already been recorded for ${period}`);
  const exp = await createExpense(
    { categoryId: String(t.categoryId), description: `${t.name} (${period})`, amount: t.amount, date: new Date(), method: t.method },
    `recurring:${t._id}:${period}`,
    ctx,
    t._id,
  );
  await RecurringExpense.updateOne({ _id: t._id }, { $set: { lastRecordedPeriod: period } });
  return exp;
}

/* ----------------------- Owner / cash transactions ----------------------- */

export const CASH_TX_TYPES = ['CAPITAL_INJECTION', 'LOAN_RECEIVED', 'TRANSFER', 'OPENING_CASH', 'OTHER_INCOME', 'OTHER_EXPENSE'] as const;
export type CashTxType = (typeof CASH_TX_TYPES)[number];
const CASH_ACCOUNTS = [ACCOUNTS.CASH, ACCOUNTS.BANK, ACCOUNTS.MOBILE_MONEY] as string[];

export async function recordCashTransaction(input: { type: CashTxType; amount: number; account: string; fromAccount?: string; date?: Date; memo: string }, ctx: Ctx) {
  if (!CASH_ACCOUNTS.includes(input.account)) throw unprocessable('Target must be a cash, bank or mobile money account');
  if (input.amount <= 0) throw unprocessable('Amount must be positive');
  const map: Record<Exclude<CashTxType, 'TRANSFER'>, { debit: string; credit: string }> = {
    CAPITAL_INJECTION: { debit: input.account, credit: ACCOUNTS.OWNER_CAPITAL },
    LOAN_RECEIVED: { debit: input.account, credit: ACCOUNTS.LOANS_PAYABLE },
    OPENING_CASH: { debit: input.account, credit: ACCOUNTS.OPENING_BALANCE_EQUITY },
    OTHER_INCOME: { debit: input.account, credit: ACCOUNTS.OTHER_INCOME },
    OTHER_EXPENSE: { debit: ACCOUNTS.OTHER_EXPENSES, credit: input.account },
  };
  let debit: string, credit: string;
  if (input.type === 'TRANSFER') {
    if (!input.fromAccount || !CASH_ACCOUNTS.includes(input.fromAccount) || input.fromAccount === input.account) {
      throw unprocessable('Transfers need two different cash/bank accounts');
    }
    const available = await accountBalance(input.fromAccount);
    if (available < input.amount) throw unprocessable('Insufficient balance in the source account');
    debit = input.account;
    credit = input.fromAccount;
  } else {
    ({ debit, credit } = map[input.type]);
  }
  return withTx(async (session) => {
    const ref = await nextNumber('cashTx', 'CTX-', session);
    const je = await postJournal(
      {
        date: input.date ?? new Date(),
        memo: `${input.type.replace(/_/g, ' ').toLowerCase()}: ${input.memo}`,
        sourceType: input.type === 'TRANSFER' ? 'TRANSFER' : input.type === 'OPENING_CASH' ? 'OPENING_BALANCE' : 'CAPITAL',
        sourceRef: ref,
        postedBy: ctx.userId,
        lines: [
          { account: debit, debit: input.amount },
          { account: credit, credit: input.amount },
        ],
      },
      session,
    );
    await audit(ctx, 'finance.cash_tx', 'JournalEntry', je?._id, { summary: `${ref} ${input.type} ${input.amount}`, session });
    return je?.toObject();
  });
}
