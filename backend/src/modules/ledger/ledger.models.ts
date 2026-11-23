import { Schema, model, Types } from 'mongoose';

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'CONTRA_REVENUE', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface AccountDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  type: AccountType;
  /** Normal balance side; used for sign of reported balances. */
  normal: 'DEBIT' | 'CREDIT';
  isSystem: boolean;
  isCashAccount: boolean;
  isActive: boolean;
}
const AccountSchema = new Schema<AccountDoc>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    type: { type: String, enum: ACCOUNT_TYPES, required: true },
    normal: { type: String, enum: ['DEBIT', 'CREDIT'], required: true },
    isSystem: { type: Boolean, default: false },
    isCashAccount: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const Account = model<AccountDoc>('Account', AccountSchema, 'chart_of_accounts');

export type PartyType = 'CUSTOMER' | 'SUPPLIER';

export interface JournalLine {
  accountCode: string;
  debit: number;
  credit: number;
  partyType?: PartyType;
  partyId?: Types.ObjectId;
  /** Optional analytic dimensions (product, category, expense category...). */
  productId?: Types.ObjectId;
  categoryId?: Types.ObjectId;
  expenseCategoryId?: Types.ObjectId;
  memo?: string;
}

export const SOURCE_TYPES = [
  'SALE',
  'CUSTOMER_PAYMENT',
  'CUSTOMER_RETURN',
  'PURCHASE_RECEIPT',
  'SUPPLIER_PAYMENT',
  'SUPPLIER_RETURN',
  'STOCK_ADJUSTMENT',
  'RETURN_INSPECTION',
  'EXPENSE',
  'CAPITAL',
  'TRANSFER',
  'OPENING_BALANCE',
  'MANUAL',
  'REVERSAL',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface JournalEntryDoc {
  _id: Types.ObjectId;
  entryNo: string;
  date: Date;
  memo: string;
  sourceType: SourceType;
  sourceId?: Types.ObjectId;
  sourceRef?: string;
  lines: JournalLine[];
  totalDebit: number;
  totalCredit: number;
  reversalOf?: Types.ObjectId;
  reversedBy?: Types.ObjectId;
  postedBy?: Types.ObjectId;
  createdAt: Date;
}

const LineSchema = new Schema<JournalLine>(
  {
    accountCode: { type: String, required: true },
    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },
    partyType: { type: String, enum: ['CUSTOMER', 'SUPPLIER'] },
    partyId: { type: Schema.Types.ObjectId },
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    expenseCategoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory' },
    memo: String,
  },
  { _id: false },
);

const JournalEntrySchema = new Schema<JournalEntryDoc>(
  {
    entryNo: { type: String, required: true, unique: true },
    date: { type: Date, required: true, index: true },
    memo: { type: String, required: true },
    sourceType: { type: String, enum: SOURCE_TYPES, required: true },
    sourceId: { type: Schema.Types.ObjectId },
    sourceRef: String,
    lines: { type: [LineSchema], validate: [(v: unknown[]) => v.length >= 2, 'A journal entry needs at least two lines'] },
    totalDebit: { type: Number, required: true },
    totalCredit: { type: Number, required: true },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    reversedBy: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    postedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
JournalEntrySchema.index({ sourceType: 1, sourceId: 1 });
JournalEntrySchema.index({ 'lines.accountCode': 1, date: 1 });
JournalEntrySchema.index({ 'lines.partyId': 1, date: 1 });

JournalEntrySchema.pre('validate', function () {
  const debit = this.lines.reduce((s, l) => s + l.debit, 0);
  const credit = this.lines.reduce((s, l) => s + l.credit, 0);
  for (const l of this.lines) {
    if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit)) throw new Error('Journal amounts must be integer cents');
    if (l.debit > 0 && l.credit > 0) throw new Error('A journal line cannot have both debit and credit');
  }
  if (debit !== credit) throw new Error(`Unbalanced journal entry: debit ${debit} ≠ credit ${credit}`);
  if (debit === 0) throw new Error('Journal entry total cannot be zero');
  this.totalDebit = debit;
  this.totalCredit = credit;
});

// Posted entries are immutable. The only permitted update is linking a reversal.
for (const op of ['updateMany', 'deleteOne', 'deleteMany', 'findOneAndDelete', 'replaceOne'] as const) {
  JournalEntrySchema.pre(op, function () {
    throw new Error('Posted journal entries are immutable; post a reversal instead');
  });
}
JournalEntrySchema.pre(['updateOne', 'findOneAndUpdate'], function () {
  const u = this.getUpdate() as Record<string, unknown> | null;
  // Mongoose's timestamps plugin adds `$setOnInsert: { createdAt }`; it is inert without upsert, which is never allowed here.
  if (this.getOptions().upsert) throw new Error('Posted journal entries are immutable; post a reversal instead');
  const keys = Object.keys(u ?? {})
    .filter((k) => k !== '$setOnInsert')
    .flatMap((k) => (k.startsWith('$') ? Object.keys((u as Record<string, object>)[k] ?? {}) : [k]));
  if (keys.some((k) => k !== 'reversedBy')) throw new Error('Posted journal entries are immutable; post a reversal instead');
});

export const JournalEntry = model<JournalEntryDoc>('JournalEntry', JournalEntrySchema, 'journal_entries');
