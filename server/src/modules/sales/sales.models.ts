import { Schema, model, Types } from 'mongoose';
import { PAYMENT_METHODS, RETURN_CONDITIONS, SALE_STATUSES, type PaymentMethod, type ReturnCondition, type SaleStatus } from '@autoparts/shared';

export interface SaleItem {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  sku: string;
  name: string;
  partNumber?: string;
  brand?: string;
  categoryId?: Types.ObjectId;
  qty: number;
  unitPrice: number;
  /** Line discount entered by the cashier (cents). */
  discount: number;
  /** Share of the cart-level discount allocated to this line. */
  cartDiscountShare: number;
  /** Revenue before discount, excluding tax. */
  revenueEx: number;
  /** Total discount on the line, excluding tax. */
  discountEx: number;
  tax: number;
  /** Amount charged for the line, including tax. */
  lineTotal: number;
  cogs: number;
  allocations: { layerId: Types.ObjectId; qty: number; cost: number }[];
  warrantyMonths: number;
  qtyReturned: number;
  returnedTotal: number;
  returnedTax: number;
  returnedCogs: number;
}

export interface SaleDoc {
  _id: Types.ObjectId;
  invoiceNo: string;
  date: Date;
  customerId?: Types.ObjectId;
  customerName: string;
  customerPhone?: string;
  warehouseId: Types.ObjectId;
  items: SaleItem[];
  subtotal: number;
  discountTotal: number;
  netSales: number;
  taxTotal: number;
  total: number;
  cogsTotal: number;
  grossProfit: number;
  amountPaid: number;
  returnedAmount: number;
  refundedAmount: number;
  balanceDue: number;
  dueDate?: Date;
  status: SaleStatus;
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID';
  taxRateBps: number;
  pricesIncludeTax: boolean;
  notes?: string;
  idempotencyKey: string;
  journalEntryId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdByName?: string;
  createdAt: Date;
}

const SaleItemSchema = new Schema<SaleItem>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: String,
  name: String,
  partNumber: String,
  brand: String,
  categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
  qty: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  cartDiscountShare: { type: Number, default: 0, min: 0 },
  revenueEx: { type: Number, required: true },
  discountEx: { type: Number, required: true },
  tax: { type: Number, required: true },
  lineTotal: { type: Number, required: true },
  cogs: { type: Number, required: true },
  allocations: [{ _id: false, layerId: Schema.Types.ObjectId, qty: Number, cost: Number }],
  warrantyMonths: { type: Number, default: 0 },
  qtyReturned: { type: Number, default: 0 },
  returnedTotal: { type: Number, default: 0 },
  returnedTax: { type: Number, default: 0 },
  returnedCogs: { type: Number, default: 0 },
});

const SaleSchema = new Schema<SaleDoc>(
  {
    invoiceNo: { type: String, required: true, unique: true },
    date: { type: Date, required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    customerName: { type: String, required: true },
    customerPhone: String,
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    items: [SaleItemSchema],
    subtotal: Number,
    discountTotal: Number,
    netSales: Number,
    taxTotal: Number,
    total: Number,
    cogsTotal: Number,
    grossProfit: Number,
    amountPaid: { type: Number, default: 0 },
    returnedAmount: { type: Number, default: 0 },
    refundedAmount: { type: Number, default: 0 },
    balanceDue: Number,
    dueDate: Date,
    status: { type: String, enum: SALE_STATUSES, default: 'COMPLETED', index: true },
    paymentStatus: { type: String, enum: ['PAID', 'PARTIAL', 'UNPAID'], index: true },
    taxRateBps: Number,
    pricesIncludeTax: Boolean,
    notes: String,
    idempotencyKey: { type: String, required: true, unique: true },
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    createdByName: String,
  },
  { timestamps: true, optimisticConcurrency: true },
);
SaleSchema.index({ 'items.productId': 1, date: -1 });
SaleSchema.index({ customerId: 1, balanceDue: 1 });
export const Sale = model<SaleDoc>('Sale', SaleSchema, 'sales');

export interface CustomerPaymentDoc {
  _id: Types.ObjectId;
  paymentNo: string;
  customerId?: Types.ObjectId;
  amount: number;
  method: PaymentMethod;
  reference?: string;
  date: Date;
  allocations: { saleId: Types.ObjectId; invoiceNo: string; amount: number }[];
  /** Portion of the payment kept as customer store credit. */
  toCredit: number;
  kind: 'PAYMENT' | 'REFUND';
  notes?: string;
  journalEntryId?: Types.ObjectId;
  idempotencyKey?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}
const CustomerPaymentSchema = new Schema<CustomerPaymentDoc>(
  {
    paymentNo: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    reference: String,
    date: { type: Date, required: true, index: true },
    allocations: [{ _id: false, saleId: { type: Schema.Types.ObjectId, ref: 'Sale' }, invoiceNo: String, amount: Number }],
    toCredit: { type: Number, default: 0 },
    kind: { type: String, enum: ['PAYMENT', 'REFUND'], default: 'PAYMENT' },
    notes: String,
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    idempotencyKey: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
CustomerPaymentSchema.index({ 'allocations.saleId': 1 });
CustomerPaymentSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
export const CustomerPayment = model<CustomerPaymentDoc>('CustomerPayment', CustomerPaymentSchema, 'customer_payments');

export interface CustomerReturnLine {
  saleItemId: Types.ObjectId;
  productId: Types.ObjectId;
  sku: string;
  name: string;
  qty: number;
  condition: ReturnCondition;
  amount: number;
  tax: number;
  cost: number;
  inspection?: { decision: 'RESTOCK' | 'WRITE_OFF'; at: Date; by?: Types.ObjectId; notes?: string };
}
export interface CustomerReturnDoc {
  _id: Types.ObjectId;
  returnNo: string;
  saleId: Types.ObjectId;
  invoiceNo: string;
  customerId?: Types.ObjectId;
  date: Date;
  reason: string;
  lines: CustomerReturnLine[];
  totalAmount: number;
  refundAmount: number;
  refundMethod?: PaymentMethod;
  creditApplied: number;
  idempotencyKey?: string;
  journalEntryId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}
const CustomerReturnSchema = new Schema<CustomerReturnDoc>(
  {
    returnNo: { type: String, required: true, unique: true },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true, index: true },
    invoiceNo: String,
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    date: { type: Date, required: true, index: true },
    reason: { type: String, required: true },
    lines: [
      {
        _id: false,
        saleItemId: Schema.Types.ObjectId,
        productId: { type: Schema.Types.ObjectId, ref: 'Product' },
        sku: String,
        name: String,
        qty: Number,
        condition: { type: String, enum: RETURN_CONDITIONS },
        amount: Number,
        tax: Number,
        cost: Number,
        inspection: { decision: String, at: Date, by: Schema.Types.ObjectId, notes: String },
      },
    ],
    totalAmount: Number,
    refundAmount: Number,
    refundMethod: { type: String, enum: PAYMENT_METHODS },
    creditApplied: Number,
    idempotencyKey: String,
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
CustomerReturnSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
export const CustomerReturn = model<CustomerReturnDoc>('CustomerReturn', CustomerReturnSchema, 'customer_returns');

export const WARRANTY_STATUSES = ['OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'] as const;
export interface WarrantyClaimDoc {
  _id: Types.ObjectId;
  claimNo: string;
  saleId: Types.ObjectId;
  saleItemId: Types.ObjectId;
  invoiceNo: string;
  productId: Types.ObjectId;
  productName: string;
  customerId?: Types.ObjectId;
  customerName: string;
  warrantyStart: Date;
  warrantyEnd: Date;
  status: (typeof WARRANTY_STATUSES)[number];
  issue: string;
  notes: { at: Date; by?: Types.ObjectId; text: string }[];
  resolution?: 'REPLACED' | 'REPAIRED' | 'REFUNDED' | 'REJECTED' | 'OTHER';
  resolutionNotes?: string;
  replacementCost?: number;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}
const WarrantyClaimSchema = new Schema<WarrantyClaimDoc>(
  {
    claimNo: { type: String, required: true, unique: true },
    saleId: { type: Schema.Types.ObjectId, ref: 'Sale', required: true },
    saleItemId: { type: Schema.Types.ObjectId, required: true },
    invoiceNo: String,
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    productName: String,
    customerId: { type: Schema.Types.ObjectId, ref: 'Customer' },
    customerName: String,
    warrantyStart: Date,
    warrantyEnd: Date,
    status: { type: String, enum: WARRANTY_STATUSES, default: 'OPEN', index: true },
    issue: { type: String, required: true },
    notes: [{ _id: false, at: Date, by: Schema.Types.ObjectId, text: String }],
    resolution: { type: String, enum: ['REPLACED', 'REPAIRED', 'REFUNDED', 'REJECTED', 'OTHER'] },
    resolutionNotes: String,
    replacementCost: Number,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const WarrantyClaim = model<WarrantyClaimDoc>('WarrantyClaim', WarrantyClaimSchema, 'warranty_claims');
