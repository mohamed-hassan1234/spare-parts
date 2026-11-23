import { Schema, model, Types } from 'mongoose';
import { EXPENSE_KINDS, PAYMENT_METHODS, type ExpenseKind, type PaymentMethod } from '@autoparts/shared';

export interface ExpenseCategoryDoc {
  _id: Types.ObjectId;
  name: string;
  kind: ExpenseKind;
  isActive: boolean;
}
const ExpenseCategorySchema = new Schema<ExpenseCategoryDoc>(
  {
    name: { type: String, required: true, trim: true },
    kind: { type: String, enum: EXPENSE_KINDS, default: 'OPERATING' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
ExpenseCategorySchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export const ExpenseCategory = model<ExpenseCategoryDoc>('ExpenseCategory', ExpenseCategorySchema, 'expense_categories');

export interface ExpenseDoc {
  _id: Types.ObjectId;
  expenseNo: string;
  kind: ExpenseKind;
  categoryId: Types.ObjectId;
  description: string;
  amount: number;
  date: Date;
  method: Exclude<PaymentMethod, 'STORE_CREDIT'>;
  reference?: string;
  receiptUrl?: string;
  /** File name of the private supporting document (see /expenses/:id/attachment). */
  attachmentFile?: string;
  notes?: string;
  status: 'POSTED' | 'VOIDED';
  voidReason?: string;
  journalEntryId?: Types.ObjectId;
  recurringTemplateId?: Types.ObjectId;
  idempotencyKey?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}
const ExpenseSchema = new Schema<ExpenseDoc>(
  {
    expenseNo: { type: String, required: true, unique: true },
    kind: { type: String, enum: EXPENSE_KINDS, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true, index: true },
    description: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 },
    date: { type: Date, required: true, index: true },
    method: { type: String, enum: PAYMENT_METHODS.filter((m) => m !== 'STORE_CREDIT'), required: true },
    reference: String,
    receiptUrl: String,
    attachmentFile: String,
    notes: String,
    status: { type: String, enum: ['POSTED', 'VOIDED'], default: 'POSTED', index: true },
    voidReason: String,
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    recurringTemplateId: { type: Schema.Types.ObjectId, ref: 'RecurringExpense' },
    idempotencyKey: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
ExpenseSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
export const Expense = model<ExpenseDoc>('Expense', ExpenseSchema, 'expenses');

export interface RecurringExpenseDoc {
  _id: Types.ObjectId;
  name: string;
  categoryId: Types.ObjectId;
  amount: number;
  method: Exclude<PaymentMethod, 'STORE_CREDIT'>;
  dayOfMonth: number;
  isActive: boolean;
  lastRecordedPeriod?: string;
}
const RecurringExpenseSchema = new Schema<RecurringExpenseDoc>(
  {
    name: { type: String, required: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ExpenseCategory', required: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: PAYMENT_METHODS.filter((m) => m !== 'STORE_CREDIT'), required: true },
    dayOfMonth: { type: Number, min: 1, max: 28, default: 1 },
    isActive: { type: Boolean, default: true },
    lastRecordedPeriod: String,
  },
  { timestamps: true },
);
export const RecurringExpense = model<RecurringExpenseDoc>('RecurringExpense', RecurringExpenseSchema, 'recurring_expenses');

export const DEFAULT_EXPENSE_CATEGORIES: { name: string; kind: ExpenseKind }[] = [
  { name: 'Shop Rent', kind: 'OPERATING' },
  { name: 'Electricity', kind: 'OPERATING' },
  { name: 'Internet', kind: 'OPERATING' },
  { name: 'Employee Salaries', kind: 'OPERATING' },
  { name: 'Transportation', kind: 'OPERATING' },
  { name: 'Marketing', kind: 'OPERATING' },
  { name: 'Maintenance', kind: 'OPERATING' },
  { name: 'Bank Fees', kind: 'OPERATING' },
  { name: 'Utilities', kind: 'OPERATING' },
  { name: 'Office Supplies', kind: 'OPERATING' },
  { name: 'Miscellaneous', kind: 'OPERATING' },
  { name: 'Equipment & Fixtures', kind: 'CAPITAL_EXPENDITURE' },
  { name: 'Owner Withdrawal', kind: 'OWNER_DRAWING' },
  { name: 'Loan Repayment', kind: 'LOAN_REPAYMENT' },
];
