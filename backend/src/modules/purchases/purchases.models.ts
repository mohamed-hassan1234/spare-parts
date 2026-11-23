import { Schema, model, Types } from 'mongoose';
import { LANDED_COST_METHODS, PAYMENT_METHODS, PURCHASE_STATUSES, type LandedCostMethod, type PaymentMethod, type PurchaseStatus } from '@autoparts/shared';

export interface PurchaseItem {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  sku: string;
  name: string;
  qtyOrdered: number;
  unitPrice: number;
  discount: number;
  /** qtyOrdered × unitPrice − discount */
  lineNet: number;
  weightGrams?: number;
  manualExtraCost?: number;
  /** Share of freight/customs/other costs allocated to this line. */
  extraCost: number;
  /** lineNet + extraCost — the landed cost of the full ordered quantity. */
  landedCost: number;
  qtyReceived: number;
  costReceived: number;
}

export interface PurchaseDoc {
  _id: Types.ObjectId;
  purchaseNo: string;
  supplierId: Types.ObjectId;
  supplierInvoiceNo?: string;
  reference?: string;
  purchaseDate: Date;
  expectedDate?: Date;
  dueDate?: Date;
  status: PurchaseStatus;
  warehouseId: Types.ObjectId;
  items: PurchaseItem[];
  freightCost: number;
  customsCost: number;
  otherCost: number;
  allocationMethod: LandedCostMethod;
  subtotal: number;
  extraTotal: number;
  total: number;
  /** Cached; reconciled against supplier_payments + ledger. */
  amountPaid: number;
  /** Cached Σ receipt cost; reconciled against purchase_receipts. */
  receivedValue: number;
  returnedValue: number;
  notes?: string;
  createdBy?: Types.ObjectId;
  orderedAt?: Date;
  postedAt?: Date;
  postedBy?: Types.ObjectId;
  cancelledAt?: Date;
  cancelReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ItemSchema = new Schema<PurchaseItem>({
  productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  sku: String,
  name: String,
  qtyOrdered: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  discount: { type: Number, default: 0, min: 0 },
  lineNet: { type: Number, required: true, min: 0 },
  weightGrams: Number,
  manualExtraCost: Number,
  extraCost: { type: Number, default: 0, min: 0 },
  landedCost: { type: Number, required: true, min: 0 },
  qtyReceived: { type: Number, default: 0, min: 0 },
  costReceived: { type: Number, default: 0, min: 0 },
});

const PurchaseSchema = new Schema<PurchaseDoc>(
  {
    purchaseNo: { type: String, required: true, unique: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    supplierInvoiceNo: String,
    reference: String,
    purchaseDate: { type: Date, required: true, index: true },
    expectedDate: Date,
    dueDate: Date,
    status: { type: String, enum: PURCHASE_STATUSES, default: 'DRAFT', index: true },
    warehouseId: { type: Schema.Types.ObjectId, ref: 'Warehouse', required: true },
    items: { type: [ItemSchema], validate: [(v: unknown[]) => v.length > 0, 'A purchase needs at least one item'] },
    freightCost: { type: Number, default: 0, min: 0 },
    customsCost: { type: Number, default: 0, min: 0 },
    otherCost: { type: Number, default: 0, min: 0 },
    allocationMethod: { type: String, enum: LANDED_COST_METHODS, default: 'VALUE' },
    subtotal: { type: Number, required: true },
    extraTotal: { type: Number, required: true },
    total: { type: Number, required: true },
    amountPaid: { type: Number, default: 0, min: 0 },
    receivedValue: { type: Number, default: 0, min: 0 },
    returnedValue: { type: Number, default: 0, min: 0 },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    orderedAt: Date,
    postedAt: Date,
    postedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    cancelledAt: Date,
    cancelReason: String,
  },
  { timestamps: true, optimisticConcurrency: true },
);
PurchaseSchema.index({ supplierId: 1, supplierInvoiceNo: 1 }, { unique: true, partialFilterExpression: { supplierInvoiceNo: { $type: 'string' } } });
export const Purchase = model<PurchaseDoc>('Purchase', PurchaseSchema, 'purchases');

export interface PurchaseReceiptDoc {
  _id: Types.ObjectId;
  receiptNo: string;
  purchaseId: Types.ObjectId;
  supplierId: Types.ObjectId;
  date: Date;
  lines: { itemId: Types.ObjectId; productId: Types.ObjectId; qty: number; cost: number }[];
  totalCost: number;
  journalEntryId?: Types.ObjectId;
  idempotencyKey?: string;
  notes?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}
const PurchaseReceiptSchema = new Schema<PurchaseReceiptDoc>(
  {
    receiptNo: { type: String, required: true, unique: true },
    purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', required: true, index: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true },
    date: { type: Date, required: true },
    lines: [{ _id: false, itemId: Schema.Types.ObjectId, productId: { type: Schema.Types.ObjectId, ref: 'Product' }, qty: Number, cost: Number }],
    totalCost: { type: Number, required: true },
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    idempotencyKey: String,
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
PurchaseReceiptSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
export const PurchaseReceipt = model<PurchaseReceiptDoc>('PurchaseReceipt', PurchaseReceiptSchema, 'purchase_receipts');

export interface SupplierPaymentDoc {
  _id: Types.ObjectId;
  paymentNo: string;
  supplierId: Types.ObjectId;
  purchaseId?: Types.ObjectId;
  amount: number;
  method: Exclude<PaymentMethod, 'STORE_CREDIT'>;
  reference?: string;
  date: Date;
  notes?: string;
  journalEntryId?: Types.ObjectId;
  idempotencyKey?: string;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}
const SupplierPaymentSchema = new Schema<SupplierPaymentDoc>(
  {
    paymentNo: { type: String, required: true, unique: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase', index: true },
    amount: { type: Number, required: true, min: 1 },
    method: { type: String, enum: PAYMENT_METHODS.filter((m) => m !== 'STORE_CREDIT'), required: true },
    reference: String,
    date: { type: Date, required: true, index: true },
    notes: String,
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    idempotencyKey: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);
SupplierPaymentSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
export const SupplierPayment = model<SupplierPaymentDoc>('SupplierPayment', SupplierPaymentSchema, 'supplier_payments');

export interface SupplierReturnDoc {
  _id: Types.ObjectId;
  returnNo: string;
  supplierId: Types.ObjectId;
  purchaseId?: Types.ObjectId;
  reason: 'DAMAGED' | 'INCORRECT_ITEM' | 'DEFECTIVE' | 'OTHER';
  settlement: 'CREDIT' | 'REPLACEMENT';
  status: 'CREDITED' | 'AWAITING_REPLACEMENT' | 'REPLACED';
  lines: { productId: Types.ObjectId; sku: string; name: string; qty: number; cost: number; qtyReplaced: number }[];
  totalCost: number;
  notes?: string;
  journalEntryId?: Types.ObjectId;
  createdBy?: Types.ObjectId;
  createdAt: Date;
}
const SupplierReturnSchema = new Schema<SupplierReturnDoc>(
  {
    returnNo: { type: String, required: true, unique: true },
    supplierId: { type: Schema.Types.ObjectId, ref: 'Supplier', required: true, index: true },
    purchaseId: { type: Schema.Types.ObjectId, ref: 'Purchase' },
    reason: { type: String, enum: ['DAMAGED', 'INCORRECT_ITEM', 'DEFECTIVE', 'OTHER'], required: true },
    settlement: { type: String, enum: ['CREDIT', 'REPLACEMENT'], required: true },
    status: { type: String, enum: ['CREDITED', 'AWAITING_REPLACEMENT', 'REPLACED'], required: true },
    lines: [{ _id: false, productId: { type: Schema.Types.ObjectId, ref: 'Product' }, sku: String, name: String, qty: Number, cost: Number, qtyReplaced: { type: Number, default: 0 } }],
    totalCost: { type: Number, required: true },
    notes: String,
    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const SupplierReturn = model<SupplierReturnDoc>('SupplierReturn', SupplierReturnSchema, 'supplier_returns');
