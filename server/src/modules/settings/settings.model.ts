import { Schema, model, Types } from 'mongoose';
import { DEFAULT_CURRENCY, DEFAULT_TIMEZONE } from '@autoparts/shared';

export interface SettingsDoc {
  _id: string;
  businessName: string;
  logoUrl?: string;
  address?: string;
  phone?: string;
  email?: string;
  receiptFooter?: string;
  currency: string;
  timezone: string;
  invoicePrefix: string;
  purchasePrefix: string;
  /** Tax rate in basis points (e.g. 500 = 5%). 0 disables tax. */
  taxRateBps: number;
  taxName: string;
  pricesIncludeTax: boolean;
  returnPolicy?: string;
  warrantyPolicy?: string;
  returnWindowDays: number;
  lowStockDefault: number;
  deadStockDays: number;
  allowDuplicateManufacturerPartNumbers: boolean;
  /** Max discount (bps of line value) allowed without `sales:discount` permission. */
  maxDiscountBpsWithoutApproval: number;
  enforceMinimumPrice: boolean;
  sessionIdleMinutes: number;
  backupRetentionCount: number;
  updatedBy?: Types.ObjectId;
  updatedAt?: Date;
}

const SettingsSchema = new Schema<SettingsDoc>(
  {
    _id: { type: String, default: 'business' },
    businessName: { type: String, default: 'AutoParts Store' },
    logoUrl: String,
    address: String,
    phone: String,
    email: String,
    receiptFooter: { type: String, default: 'Thank you for your business!' },
    currency: { type: String, default: DEFAULT_CURRENCY },
    timezone: { type: String, default: DEFAULT_TIMEZONE },
    invoicePrefix: { type: String, default: 'INV-' },
    purchasePrefix: { type: String, default: 'PO-' },
    taxRateBps: { type: Number, default: 0, min: 0, max: 10_000 },
    taxName: { type: String, default: 'VAT' },
    pricesIncludeTax: { type: Boolean, default: false },
    returnPolicy: { type: String, default: 'Returns accepted within 14 days with original invoice. Electrical parts are non-returnable once installed.' },
    warrantyPolicy: { type: String, default: 'Manufacturer warranty applies where stated on the invoice.' },
    returnWindowDays: { type: Number, default: 14 },
    lowStockDefault: { type: Number, default: 5 },
    deadStockDays: { type: Number, default: 90 },
    allowDuplicateManufacturerPartNumbers: { type: Boolean, default: true },
    maxDiscountBpsWithoutApproval: { type: Number, default: 1000 },
    enforceMinimumPrice: { type: Boolean, default: true },
    sessionIdleMinutes: { type: Number, default: 30, min: 5, max: 1440 },
    backupRetentionCount: { type: Number, default: 14, min: 1, max: 365 },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: false, updatedAt: true }, versionKey: false },
);
export const Settings = model<SettingsDoc>('Settings', SettingsSchema, 'business_settings');

let cache: { value: SettingsDoc; at: number } | null = null;
export async function getSettings(): Promise<SettingsDoc> {
  if (cache && Date.now() - cache.at < 5_000) return cache.value;
  let s = await Settings.findById('business').lean();
  if (!s) {
    await Settings.updateOne({ _id: 'business' }, { $setOnInsert: { _id: 'business' } }, { upsert: true });
    s = await Settings.findById('business').lean();
  }
  cache = { value: s as SettingsDoc, at: Date.now() };
  return cache.value;
}
export function invalidateSettingsCache() {
  cache = null;
}
