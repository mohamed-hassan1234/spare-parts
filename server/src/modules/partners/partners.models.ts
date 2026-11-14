import { Schema, model, Types } from 'mongoose';

/**
 * Suppliers and customers. NOTE: there are deliberately NO balance fields here.
 * Balances are always derived from the general ledger (AP / AR control
 * accounts tagged with the party id) so they can never drift.
 */
export interface SupplierDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
  country?: string;
  city?: string;
  address?: string;
  paymentTermsDays: number;
  status: 'ACTIVE' | 'INACTIVE';
  notes?: string;
  createdAt: Date;
}
const SupplierSchema = new Schema<SupplierDoc>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    contactPerson: String,
    phone: String,
    email: { type: String, lowercase: true, trim: true },
    country: String,
    city: String,
    address: String,
    paymentTermsDays: { type: Number, default: 30, min: 0 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    notes: String,
  },
  { timestamps: true },
);
SupplierSchema.index({ name: 'text', contactPerson: 'text', phone: 'text' });
export const Supplier = model<SupplierDoc>('Supplier', SupplierSchema, 'suppliers');

export const CUSTOMER_TYPES = ['WALK_IN', 'INDIVIDUAL', 'GARAGE', 'BUSINESS', 'FLEET'] as const;
export interface CustomerDoc {
  _id: Types.ObjectId;
  code: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  type: (typeof CUSTOMER_TYPES)[number];
  /** Credit limit in cents. 0 = credit sales not allowed. */
  creditLimit: number;
  paymentTermsDays: number;
  status: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  notes?: string;
  createdAt: Date;
}
const CustomerSchema = new Schema<CustomerDoc>(
  {
    code: { type: String, required: true, unique: true },
    name: { type: String, required: true, trim: true },
    phone: String,
    email: { type: String, lowercase: true, trim: true },
    address: String,
    type: { type: String, enum: CUSTOMER_TYPES, default: 'INDIVIDUAL' },
    creditLimit: { type: Number, default: 0, min: 0 },
    paymentTermsDays: { type: Number, default: 30, min: 0 },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'], default: 'ACTIVE' },
    notes: String,
  },
  { timestamps: true },
);
CustomerSchema.index({ name: 'text', phone: 'text', email: 'text' });
CustomerSchema.index({ phone: 1 });
export const Customer = model<CustomerDoc>('Customer', CustomerSchema, 'customers');
