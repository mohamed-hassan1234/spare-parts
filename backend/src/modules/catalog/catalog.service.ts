import { Types } from 'mongoose';
import { z } from 'zod';
import { Brand, Category, PriceHistory, Product, PRODUCT_CONDITIONS, type ProductDoc } from './catalog.models.js';
import { InventoryBalance } from '../inventory/inventory.models.js';
import { getSettings } from '../settings/settings.model.js';
import { audit } from '../system/audit.service.js';
import { badRequest, conflict, notFound, unprocessable } from '../../utils/errors.js';
import { escapeRegex } from '../../utils/pagination.js';
import { zCents, zId, zOptStr, type Ctx } from '../../utils/http.js';
import { withTx } from '../../utils/tx.js';
import { parseToCents } from '@autoparts/shared';

const partList = z.array(z.string().trim().toUpperCase().min(1).max(60)).max(50).default([]);

export const ProductInput = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .min(1)
    .max(60)
    .regex(/^[A-Z0-9._\-/]+$/, 'SKU may contain letters, numbers and . _ - /'),
  name: z.string().trim().min(2).max(200),
  manufacturerPartNumber: zOptStr(60),
  oemPartNumbers: partList,
  alternativePartNumbers: partList,
  barcode: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{4,64}$/, 'Barcode must be 4–64 letters, digits or dashes')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  /** null or '' clears the reference. */
  brandId: zId
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  /** null or '' clears the reference. */
  categoryId: zId
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  /** null or '' clears the reference. */
  subcategoryId: zId
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  description: zOptStr(4000),
  imageUrl: zOptStr(500),
  unit: z.string().trim().min(1).max(20).default('pcs'),
  weightGrams: z.number().int().min(0).max(10_000_000).optional(),
  sellingPrice: zCents,
  minimumSellingPrice: zCents.default(0),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
  warrantyTerms: zOptStr(1000),
  supplierIds: z.array(zId).max(20).default([]),
  storageLocation: zOptStr(100),
  reorderPoint: z.number().int().min(0).max(1_000_000).default(5),
  reorderQuantity: z.number().int().min(0).max(1_000_000).default(10),
  condition: z.enum(PRODUCT_CONDITIONS).default('NEW'),
  isActive: z.boolean().default(true),
});
export type ProductInput = z.infer<typeof ProductInput>;

async function validateProductRefs(input: Partial<ProductInput>, excludeId?: Types.ObjectId) {
  if (input.minimumSellingPrice != null && input.sellingPrice != null && input.minimumSellingPrice > input.sellingPrice) {
    throw unprocessable('Minimum selling price cannot exceed the selling price');
  }
  if (input.brandId && !(await Brand.exists({ _id: input.brandId }))) throw badRequest('Unknown brand');
  if (input.categoryId && !(await Category.exists({ _id: input.categoryId }))) throw badRequest('Unknown category');
  if (input.subcategoryId) {
    const sub = await Category.findById(input.subcategoryId).lean();
    if (!sub) throw badRequest('Unknown subcategory');
    if (input.categoryId && String(sub.parentId) !== input.categoryId) throw unprocessable('Subcategory does not belong to the selected category');
  }
  if (input.manufacturerPartNumber) {
    const settings = await getSettings();
    if (!settings.allowDuplicateManufacturerPartNumbers) {
      const dup = await Product.findOne({ manufacturerPartNumber: input.manufacturerPartNumber.toUpperCase(), brandId: input.brandId, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
      if (dup) throw conflict(`Manufacturer part number already used by ${dup.sku}`);
    }
  }
  if (input.sku) {
    const dup = await Product.findOne({ sku: input.sku, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
    if (dup) throw conflict(`SKU ${input.sku} already exists`);
  }
  if (input.barcode) {
    const dup = await Product.findOne({ barcode: input.barcode, ...(excludeId ? { _id: { $ne: excludeId } } : {}) }).lean();
    if (dup) throw conflict(`Barcode is already assigned to ${dup.sku}`);
  }
}

export async function createProduct(input: ProductInput, ctx: Ctx) {
  await validateProductRefs(input);
  const doc = await Product.create({ ...input, createdBy: ctx.userId });
  await audit(ctx, 'product.create', 'Product', doc._id, { summary: `${doc.sku} ${doc.name}`, after: doc.toObject() });
  return doc.toObject();
}

export async function updateProduct(id: string, patch: Partial<ProductInput> & { priceChangeReason?: string }, ctx: Ctx) {
  const existing = await Product.findById(id);
  if (!existing) throw notFound('Product');
  const merged = { ...existing.toObject(), ...patch } as ProductDoc;
  await validateProductRefs(
    {
      ...patch,
      sku: patch.sku,
      sellingPrice: merged.sellingPrice,
      minimumSellingPrice: merged.minimumSellingPrice,
      brandId: merged.brandId ? String(merged.brandId) : undefined,
      categoryId: patch.categoryId ?? (merged.categoryId ? String(merged.categoryId) : undefined),
    },
    existing._id,
  );
  return withTx(async (session) => {
    const before = existing.toObject();
    for (const field of ['sellingPrice', 'minimumSellingPrice'] as const) {
      if (patch[field] != null && patch[field] !== existing[field]) {
        await PriceHistory.create([{ productId: existing._id, field, oldValue: existing[field], newValue: patch[field], reason: patch.priceChangeReason, changedBy: ctx.userId }], { session });
      }
    }
    const { priceChangeReason: _r, ...rest } = patch;
    existing.set(rest);
    if (patch.isActive === false && !existing.archivedAt) existing.archivedAt = new Date();
    if (patch.isActive === true) existing.archivedAt = undefined;
    await existing.save({ session });
    await audit(ctx, 'product.update', 'Product', existing._id, { summary: existing.sku, before, after: existing.toObject(), session });
    return existing.toObject();
  });
}

/** Bulk price update by percentage (basis points) or fixed amount, with audit and history. */
export async function bulkPriceUpdate(input: { productIds?: string[]; categoryId?: string; brandId?: string; mode: 'PERCENT' | 'AMOUNT'; value: number; reason: string }, ctx: Ctx) {
  const filter: Record<string, unknown> = { isActive: true };
  if (input.productIds?.length) filter._id = { $in: input.productIds.map((x) => new Types.ObjectId(x)) };
  if (input.categoryId) filter.categoryId = new Types.ObjectId(input.categoryId);
  if (input.brandId) filter.brandId = new Types.ObjectId(input.brandId);
  if (!input.productIds?.length && !input.categoryId && !input.brandId) throw badRequest('Choose products, a category or a brand');
  const products = await Product.find(filter);
  const changes = products.map((p) => {
    const next = input.mode === 'PERCENT' ? Math.round((p.sellingPrice * (10_000 + input.value)) / 10_000) : p.sellingPrice + input.value;
    return { p, next };
  });
  const bad = changes.find((c) => c.next < 0 || c.next < c.p.minimumSellingPrice);
  if (bad) throw unprocessable(`${bad.p.sku} would fall below its minimum price (${bad.p.minimumSellingPrice})`);
  await withTx(async (session) => {
    for (const { p, next } of changes) {
      if (next === p.sellingPrice) continue;
      await PriceHistory.create([{ productId: p._id, field: 'sellingPrice', oldValue: p.sellingPrice, newValue: next, reason: input.reason, changedBy: ctx.userId }], { session });
      await Product.updateOne({ _id: p._id }, { $set: { sellingPrice: next } }, { session });
    }
    await audit(ctx, 'product.bulk_price', 'Product', null, { summary: `${changes.length} products ${input.mode} ${input.value}: ${input.reason}`, session });
  });
  return { updated: changes.filter((c) => c.next !== c.p.sellingPrice).length };
}

/** Search products by name/SKU/barcode/part numbers; includes stock. */
export async function searchProducts(q: {
  search?: string;
  categoryId?: string;
  brandId?: string;
  status?: 'active' | 'archived' | 'all';
  stock?: 'low' | 'out' | 'in';
  page: number;
  limit: number;
  sort?: string;
  vehicleId?: string;
}) {
  const filter: Record<string, unknown> = {};
  if (q.status !== 'all') filter.isActive = q.status !== 'archived';
  if (q.categoryId) filter.$or = [{ categoryId: new Types.ObjectId(q.categoryId) }, { subcategoryId: new Types.ObjectId(q.categoryId) }];
  if (q.brandId) filter.brandId = new Types.ObjectId(q.brandId);
  if (q.search) {
    const s = q.search.trim();
    const rx = new RegExp(escapeRegex(s), 'i');
    const up = s.toUpperCase();
    const textOr = [
      { sku: up },
      { barcode: s },
      { manufacturerPartNumber: up },
      { oemPartNumbers: up },
      { alternativePartNumbers: up },
      { name: rx },
      { sku: rx },
      { manufacturerPartNumber: rx },
      { oemPartNumbers: rx },
      { alternativePartNumbers: rx },
    ];
    filter.$and = [...((filter.$and as object[]) ?? []), { $or: textOr }];
  }
  if (q.vehicleId) {
    const { Compatibility } = await import('./catalog.models.js');
    const ids = await Compatibility.distinct('productId', { vehicleId: new Types.ObjectId(q.vehicleId) });
    filter._id = { $in: ids };
  }
  const sortField = q.sort?.replace(/^-/, '');
  const sort: Record<string, 1 | -1> = sortField && ['name', 'sku', 'sellingPrice', 'createdAt', 'updatedAt'].includes(sortField) ? { [sortField]: q.sort!.startsWith('-') ? -1 : 1 } : { name: 1 };
  const pipeline: object[] = [
    { $match: filter },
    { $lookup: { from: 'inventory_balances', localField: '_id', foreignField: 'productId', as: 'bal' } },
    { $addFields: { qtyOnHand: { $sum: '$bal.qtyOnHand' }, qtyAvailable: { $sum: '$bal.qtyAvailable' } } },
    { $project: { bal: 0 } },
  ];
  if (q.stock === 'out') pipeline.push({ $match: { qtyAvailable: { $lte: 0 } } });
  if (q.stock === 'low') pipeline.push({ $match: { $expr: { $and: [{ $gt: ['$qtyAvailable', 0] }, { $lte: ['$qtyAvailable', '$reorderPoint'] }] } } });
  if (q.stock === 'in') pipeline.push({ $match: { qtyAvailable: { $gt: 0 } } });
  const [res] = await Product.aggregate([
    ...pipeline,
    {
      $facet: {
        items: [
          { $sort: sort },
          { $skip: (q.page - 1) * q.limit },
          { $limit: q.limit },
          { $lookup: { from: 'brands', localField: 'brandId', foreignField: '_id', as: 'brand' } },
          { $lookup: { from: 'categories', localField: 'categoryId', foreignField: '_id', as: 'category' } },
          { $addFields: { brandName: { $first: '$brand.name' }, categoryName: { $first: '$category.name' } } },
          { $project: { brand: 0, category: 0 } },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ] as never[]);
  const total = res.total[0]?.n ?? 0;
  return { items: res.items, total, page: q.page, limit: q.limit, pages: Math.ceil(total / q.limit) };
}

export async function productStock(productId: Types.ObjectId) {
  const rows = await InventoryBalance.find({ productId }).lean();
  return { qtyOnHand: rows.reduce((s, r) => s + r.qtyOnHand, 0), qtyAvailable: rows.reduce((s, r) => s + r.qtyAvailable, 0), qtyReserved: rows.reduce((s, r) => s + r.qtyReserved, 0) };
}

/** Parse a product import row (CSV) into validated input. Money columns are decimal strings. */
export function importRowToInput(row: Record<string, string>, refs: { brands: Map<string, string>; categories: Map<string, string> }) {
  const list = (s?: string) =>
    s
      ? s
          .split(/[;|]/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [];
  const money = (s?: string) => (s ? parseToCents(s) : undefined);
  return ProductInput.parse({
    sku: row.sku,
    name: row.name,
    manufacturerPartNumber: row.manufacturerPartNumber || undefined,
    oemPartNumbers: list(row.oemPartNumbers),
    alternativePartNumbers: list(row.alternativePartNumbers),
    barcode: row.barcode || undefined,
    brandId: row.brand ? refs.brands.get(row.brand.toLowerCase()) : undefined,
    categoryId: row.category ? refs.categories.get(row.category.toLowerCase()) : undefined,
    description: row.description || undefined,
    unit: row.unit || 'pcs',
    weightGrams: row.weightGrams ? Number(row.weightGrams) : undefined,
    sellingPrice: money(row.sellingPrice) ?? 0,
    minimumSellingPrice: money(row.minimumSellingPrice) ?? 0,
    warrantyMonths: row.warrantyMonths ? Number(row.warrantyMonths) : 0,
    storageLocation: row.storageLocation || undefined,
    reorderPoint: row.reorderPoint ? Number(row.reorderPoint) : 5,
    reorderQuantity: row.reorderQuantity ? Number(row.reorderQuantity) : 10,
  });
}
