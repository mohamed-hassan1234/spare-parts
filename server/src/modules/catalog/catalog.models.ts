import { Schema, model, Types } from 'mongoose';

/* Categories (a category with a parent is a subcategory) */
export interface CategoryDoc {
  _id: Types.ObjectId;
  name: string;
  parentId?: Types.ObjectId | null;
  description?: string;
  isActive: boolean;
}
const CategorySchema = new Schema<CategoryDoc>(
  {
    name: { type: String, required: true, trim: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    description: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
CategorySchema.index({ parentId: 1, name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export const Category = model<CategoryDoc>('Category', CategorySchema, 'categories');

/* Brands */
export interface BrandDoc {
  _id: Types.ObjectId;
  name: string;
  country?: string;
  isActive: boolean;
}
const BrandSchema = new Schema<BrandDoc>(
  {
    name: { type: String, required: true, trim: true },
    country: String,
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);
BrandSchema.index({ name: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export const Brand = model<BrandDoc>('Brand', BrandSchema, 'brands');

/* Products */
export const PRODUCT_CONDITIONS = ['NEW', 'USED', 'REFURBISHED'] as const;
export interface ProductDoc {
  _id: Types.ObjectId;
  sku: string;
  name: string;
  manufacturerPartNumber?: string;
  oemPartNumbers: string[];
  alternativePartNumbers: string[];
  barcode?: string;
  brandId?: Types.ObjectId;
  categoryId?: Types.ObjectId;
  subcategoryId?: Types.ObjectId;
  description?: string;
  imageUrl?: string;
  unit: string;
  weightGrams?: number;
  /** Most recent landed unit cost (cents) — informational only; COGS always comes from FIFO layers. */
  lastPurchaseCost: number;
  sellingPrice: number;
  minimumSellingPrice: number;
  warrantyMonths: number;
  warrantyTerms?: string;
  supplierIds: Types.ObjectId[];
  storageLocation?: string;
  reorderPoint: number;
  reorderQuantity: number;
  condition: (typeof PRODUCT_CONDITIONS)[number];
  isActive: boolean;
  archivedAt?: Date;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
const ProductSchema = new Schema<ProductDoc>(
  {
    sku: { type: String, required: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    manufacturerPartNumber: { type: String, trim: true, uppercase: true },
    oemPartNumbers: { type: [String], default: [] },
    alternativePartNumbers: { type: [String], default: [] },
    barcode: { type: String, trim: true },
    brandId: { type: Schema.Types.ObjectId, ref: 'Brand' },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    subcategoryId: { type: Schema.Types.ObjectId, ref: 'Category' },
    description: String,
    imageUrl: String,
    unit: { type: String, default: 'pcs' },
    weightGrams: { type: Number, min: 0 },
    lastPurchaseCost: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, required: true, min: 0 },
    minimumSellingPrice: { type: Number, default: 0, min: 0 },
    warrantyMonths: { type: Number, default: 0, min: 0 },
    warrantyTerms: String,
    supplierIds: [{ type: Schema.Types.ObjectId, ref: 'Supplier' }],
    storageLocation: String,
    reorderPoint: { type: Number, default: 5, min: 0 },
    reorderQuantity: { type: Number, default: 10, min: 0 },
    condition: { type: String, enum: PRODUCT_CONDITIONS, default: 'NEW' },
    isActive: { type: Boolean, default: true, index: true },
    archivedAt: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
ProductSchema.index({ sku: 1 }, { unique: true });
ProductSchema.index({ barcode: 1 }, { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } });
ProductSchema.index({ manufacturerPartNumber: 1 });
ProductSchema.index({ oemPartNumbers: 1 });
ProductSchema.index({ alternativePartNumbers: 1 });
ProductSchema.index({ categoryId: 1, isActive: 1 });
ProductSchema.index({ brandId: 1 });
ProductSchema.index({ name: 'text', description: 'text', sku: 'text', manufacturerPartNumber: 'text', oemPartNumbers: 'text', alternativePartNumbers: 'text' });
export const Product = model<ProductDoc>('Product', ProductSchema, 'products');

/* Price history (append-only audit of price changes) */
export interface PriceHistoryDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  field: 'sellingPrice' | 'minimumSellingPrice' | 'lastPurchaseCost';
  oldValue: number;
  newValue: number;
  reason?: string;
  changedBy?: Types.ObjectId;
  at: Date;
}
const PriceHistorySchema = new Schema<PriceHistoryDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true, index: true },
    field: { type: String, required: true },
    oldValue: Number,
    newValue: Number,
    reason: String,
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
export const PriceHistory = model<PriceHistoryDoc>('PriceHistory', PriceHistorySchema, 'price_history');

/* Vehicles — one document per specific variant (make/model/generation/engine) */
export const FUEL_TYPES = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'LPG', 'OTHER'] as const;
export interface VehicleDoc {
  _id: Types.ObjectId;
  make: string;
  model: string;
  generation?: string;
  yearFrom: number;
  yearTo?: number;
  engineCode?: string;
  engineSize?: string;
  fuelType?: (typeof FUEL_TYPES)[number];
  transmission?: string;
  variant?: string;
}
const VehicleSchema = new Schema<VehicleDoc>(
  {
    make: { type: String, required: true, trim: true },
    model: { type: String, required: true, trim: true },
    generation: { type: String, trim: true },
    yearFrom: { type: Number, required: true, min: 1900, max: 2100 },
    yearTo: { type: Number, min: 1900, max: 2100 },
    engineCode: { type: String, trim: true, uppercase: true },
    engineSize: { type: String, trim: true },
    fuelType: { type: String, enum: FUEL_TYPES },
    transmission: String,
    variant: String,
  },
  { timestamps: true },
);
VehicleSchema.index({ make: 1, model: 1, yearFrom: 1 });
VehicleSchema.index({ make: 1, model: 1, generation: 1, yearFrom: 1, yearTo: 1, engineCode: 1, engineSize: 1, variant: 1 }, { unique: true, collation: { locale: 'en', strength: 2 } });
export const Vehicle = model<VehicleDoc>('Vehicle', VehicleSchema, 'vehicles');

/* Product ↔ vehicle compatibility with provenance */
export const FITMENT_SOURCES = ['MANUFACTURER_CATALOG', 'OEM_CROSS_REFERENCE', 'SUPPLIER_DATA', 'PHYSICALLY_VERIFIED', 'CUSTOMER_REPORT', 'OTHER'] as const;
export interface CompatibilityDoc {
  _id: Types.ObjectId;
  productId: Types.ObjectId;
  vehicleId: Types.ObjectId;
  source: (typeof FITMENT_SOURCES)[number];
  sourceReference?: string;
  verified: boolean;
  notes?: string;
  createdBy?: Types.ObjectId;
}
const CompatibilitySchema = new Schema<CompatibilityDoc>(
  {
    productId: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    vehicleId: { type: Schema.Types.ObjectId, ref: 'Vehicle', required: true, index: true },
    source: { type: String, enum: FITMENT_SOURCES, required: true },
    sourceReference: String,
    verified: { type: Boolean, default: false },
    notes: String,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
CompatibilitySchema.index({ productId: 1, vehicleId: 1 }, { unique: true });
export const Compatibility = model<CompatibilityDoc>('Compatibility', CompatibilitySchema, 'product_compatibilities');
