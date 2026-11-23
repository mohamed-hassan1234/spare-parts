import { Types, type ClientSession, type PipelineStage } from 'mongoose';
import { ACCOUNTS } from '@autoparts/shared';
import { Account, JournalEntry, type AccountType, type JournalLine, type SourceType, type PartyType } from './ledger.models.js';
import { nextNumber } from '../system/system.models.js';
import { badRequest, notFound, unprocessable } from '../../utils/errors.js';

export const DEFAULT_ACCOUNTS: { code: string; name: string; type: AccountType; isCashAccount?: boolean }[] = [
  { code: ACCOUNTS.CASH, name: 'Cash on Hand', type: 'ASSET', isCashAccount: true },
  { code: ACCOUNTS.BANK, name: 'Bank Account', type: 'ASSET', isCashAccount: true },
  { code: ACCOUNTS.MOBILE_MONEY, name: 'Mobile Money Clearing', type: 'ASSET', isCashAccount: true },
  { code: ACCOUNTS.ACCOUNTS_RECEIVABLE, name: 'Accounts Receivable', type: 'ASSET' },
  { code: ACCOUNTS.INVENTORY, name: 'Inventory Asset', type: 'ASSET' },
  { code: ACCOUNTS.QUARANTINE_INVENTORY, name: 'Returned Goods Awaiting Inspection', type: 'ASSET' },
  { code: ACCOUNTS.SUPPLIER_RECEIVABLE, name: 'Supplier Advances & Credits', type: 'ASSET' },
  { code: ACCOUNTS.FIXED_ASSETS, name: 'Fixed Assets (Capital Expenditure)', type: 'ASSET' },
  { code: ACCOUNTS.ACCOUNTS_PAYABLE, name: 'Accounts Payable', type: 'LIABILITY' },
  { code: ACCOUNTS.TAX_PAYABLE, name: 'Tax Payable', type: 'LIABILITY' },
  { code: ACCOUNTS.CUSTOMER_CREDITS, name: 'Customer Store Credit', type: 'LIABILITY' },
  { code: ACCOUNTS.LOANS_PAYABLE, name: 'Loans Payable', type: 'LIABILITY' },
  { code: ACCOUNTS.OWNER_CAPITAL, name: 'Owner Capital', type: 'EQUITY' },
  { code: ACCOUNTS.OWNER_DRAWINGS, name: 'Owner Drawings', type: 'EQUITY' },
  { code: ACCOUNTS.RETAINED_EARNINGS, name: 'Retained Earnings', type: 'EQUITY' },
  { code: ACCOUNTS.OPENING_BALANCE_EQUITY, name: 'Opening Balance Equity', type: 'EQUITY' },
  { code: ACCOUNTS.SALES_REVENUE, name: 'Sales Revenue', type: 'REVENUE' },
  { code: ACCOUNTS.SALES_RETURNS, name: 'Sales Returns', type: 'CONTRA_REVENUE' },
  { code: ACCOUNTS.SALES_DISCOUNTS, name: 'Sales Discounts', type: 'CONTRA_REVENUE' },
  { code: ACCOUNTS.OTHER_INCOME, name: 'Other Income', type: 'REVENUE' },
  { code: ACCOUNTS.COGS, name: 'Cost of Goods Sold', type: 'EXPENSE' },
  { code: ACCOUNTS.INVENTORY_LOSS, name: 'Inventory Shrinkage & Damage', type: 'EXPENSE' },
  { code: ACCOUNTS.OPERATING_EXPENSES, name: 'Operating Expenses', type: 'EXPENSE' },
  { code: ACCOUNTS.OTHER_EXPENSES, name: 'Other Non-operating Expenses', type: 'EXPENSE' },
];

const normalFor = (t: AccountType) => (t === 'ASSET' || t === 'EXPENSE' || t === 'CONTRA_REVENUE' ? 'DEBIT' : 'CREDIT');

export async function ensureChartOfAccounts() {
  for (const a of DEFAULT_ACCOUNTS) {
    await Account.updateOne({ code: a.code }, { $setOnInsert: { ...a, normal: normalFor(a.type), isSystem: true, isCashAccount: !!a.isCashAccount, isActive: true } }, { upsert: true });
  }
}

export interface LineInput {
  account: string;
  debit?: number;
  credit?: number;
  partyType?: PartyType;
  partyId?: Types.ObjectId | string;
  productId?: Types.ObjectId;
  categoryId?: Types.ObjectId;
  expenseCategoryId?: Types.ObjectId;
  memo?: string;
}

export interface PostInput {
  date?: Date;
  memo: string;
  sourceType: SourceType;
  sourceId?: Types.ObjectId;
  sourceRef?: string;
  lines: LineInput[];
  postedBy?: Types.ObjectId;
  reversalOf?: Types.ObjectId;
}

const validCodes = new Set(DEFAULT_ACCOUNTS.map((a) => a.code));

/**
 * Post a balanced journal entry. Zero-amount lines are dropped; lines on the
 * same account/party/dimension are kept separate for traceability.
 * Must be called inside the caller's transaction so the business document and
 * its accounting impact commit (or roll back) together.
 */
export async function postJournal(input: PostInput, session: ClientSession) {
  const lines: JournalLine[] = input.lines
    .map((l) => {
      if (!validCodes.has(l.account)) throw badRequest(`Unknown ledger account ${l.account}`);
      const debit = l.debit ?? 0;
      const credit = l.credit ?? 0;
      if (debit < 0 || credit < 0) throw new Error('Negative journal amounts are not allowed; swap the side instead');
      return {
        accountCode: l.account,
        debit,
        credit,
        partyType: l.partyType,
        partyId: l.partyId ? new Types.ObjectId(String(l.partyId)) : undefined,
        productId: l.productId,
        categoryId: l.categoryId,
        expenseCategoryId: l.expenseCategoryId,
        memo: l.memo,
      };
    })
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  if (lines.length === 0) return null; // nothing to post (e.g. zero-value transaction)
  const entryNo = await nextNumber('journal', 'JE-', session, 7);
  const [doc] = await JournalEntry.create(
    [
      {
        entryNo,
        date: input.date ?? new Date(),
        memo: input.memo,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceRef: input.sourceRef,
        lines,
        postedBy: input.postedBy,
        reversalOf: input.reversalOf,
        totalDebit: 0,
        totalCredit: 0,
      },
    ],
    { session },
  );
  return doc;
}

/** Reverse a posted entry with an equal and opposite entry. The original is never edited (except to link). */
export async function reverseJournal(entryId: Types.ObjectId | string, memo: string, postedBy: Types.ObjectId | undefined, session: ClientSession) {
  const orig = await JournalEntry.findById(entryId).session(session);
  if (!orig) throw notFound('Journal entry');
  if (orig.reversedBy) throw unprocessable('This journal entry has already been reversed');
  if (orig.reversalOf) throw unprocessable('A reversal entry cannot itself be reversed');
  const rev = await postJournal(
    {
      memo: `Reversal of ${orig.entryNo}: ${memo}`,
      sourceType: 'REVERSAL',
      sourceId: orig.sourceId,
      sourceRef: orig.entryNo,
      reversalOf: orig._id,
      postedBy,
      lines: orig.lines.map((l) => ({
        account: l.accountCode,
        debit: l.credit,
        credit: l.debit,
        partyType: l.partyType,
        partyId: l.partyId,
        productId: l.productId,
        categoryId: l.categoryId,
        expenseCategoryId: l.expenseCategoryId,
      })),
    },
    session,
  );
  await JournalEntry.updateOne({ _id: orig._id }, { $set: { reversedBy: rev!._id } }, { session });
  return rev;
}

interface BalanceFilter {
  from?: Date;
  to?: Date;
  accounts?: string[];
  partyId?: Types.ObjectId | string;
  partyType?: PartyType;
}

/** Sum of debit and credit per account (optionally per party) within a date range. */
export async function accountTotals(f: BalanceFilter, groupBy: 'account' | 'party' | 'account_party' = 'account') {
  const match: Record<string, unknown> = {};
  if (f.from || f.to) match.date = { ...(f.from ? { $gte: f.from } : {}), ...(f.to ? { $lt: f.to } : {}) };
  const lineMatch: Record<string, unknown> = {};
  if (f.accounts) lineMatch['lines.accountCode'] = { $in: f.accounts };
  if (f.partyId) lineMatch['lines.partyId'] = new Types.ObjectId(String(f.partyId));
  if (f.partyType) lineMatch['lines.partyType'] = f.partyType;
  const id = groupBy === 'account' ? '$lines.accountCode' : groupBy === 'party' ? '$lines.partyId' : { account: '$lines.accountCode', party: '$lines.partyId' };
  const pipeline: PipelineStage[] = [
    { $match: { ...match, ...(f.accounts ? { 'lines.accountCode': { $in: f.accounts } } : {}) } },
    { $unwind: '$lines' },
    { $match: lineMatch },
    { $group: { _id: id, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } } },
  ];
  return JournalEntry.aggregate<{ _id: string | Types.ObjectId | { account: string; party: Types.ObjectId }; debit: number; credit: number }>(pipeline);
}

/** Debit-positive balance of one account (optionally for one party) as of `to`. */
export async function accountBalance(account: string, opts: { to?: Date; from?: Date; partyId?: Types.ObjectId | string } = {}) {
  const rows = await accountTotals({ accounts: [account], to: opts.to, from: opts.from, partyId: opts.partyId });
  const r = rows[0];
  return r ? r.debit - r.credit : 0;
}

/** Customer balance owed to the shop (AR debit) minus store credit held (liability credit). */
export async function customerBalance(customerId: Types.ObjectId | string) {
  const [ar, credit] = await Promise.all([accountBalance(ACCOUNTS.ACCOUNTS_RECEIVABLE, { partyId: customerId }), accountBalance(ACCOUNTS.CUSTOMER_CREDITS, { partyId: customerId })]);
  return { receivable: ar, storeCredit: -credit };
}

/** Amount the shop owes a supplier (AP credit balance) and supplier credits held (asset). */
export async function supplierBalance(supplierId: Types.ObjectId | string) {
  const [ap, adv] = await Promise.all([accountBalance(ACCOUNTS.ACCOUNTS_PAYABLE, { partyId: supplierId }), accountBalance(ACCOUNTS.SUPPLIER_RECEIVABLE, { partyId: supplierId })]);
  return { payable: -ap, supplierCredit: adv };
}
