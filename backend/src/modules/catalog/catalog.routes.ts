import { z } from 'zod';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Types } from 'mongoose';
import { ModuleRouter, zId, zOptStr } from '../../utils/http.js';
import { Brand, Category, Compatibility, FITMENT_SOURCES, FUEL_TYPES, PriceHistory, Product, Vehicle } from './catalog.models.js';
import { bulkPriceUpdate, createProduct, importRowToInput, ProductInput, productStock, searchProducts, updateProduct } from './catalog.service.js';
import { Movement } from '../inventory/inventory.models.js';
import { AuditLog } from '../system/system.models.js';
import { audit } from '../system/audit.service.js';
import { PageQuery, escapeRegex, paginate } from '../../utils/pagination.js';
import { badRequest, conflict, notFound, unprocessable } from '../../utils/errors.js';
import { isZip, parseCsv, parseXlsx, sendTable } from '../../utils/export.js';
import { env } from '../../config/env.js';
import { requestAdjustment } from '../inventory/adjustments.service.js';
import { parseToCents } from '@autoparts/shared';

export const catalogRoutes = new ModuleRouter('', 'Catalog');
const r = catalogRoutes;

/* ------------------------------ Categories ------------------------------ */
const CategoryInput = z.object({ name: z.string().trim().min(2).max(100), parentId: zId.nullable().optional(), description: zOptStr(500), isActive: z.boolean().default(true) });

r.get('/categories', { summary: 'List categories (tree data)', permission: 'products:read' }, async () => {
  const cats = await Category.find().sort({ name: 1 }).lean();
  const counts = await Product.aggregate<{ _id: Types.ObjectId; n: number }>([{ $match: { isActive: true } }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]);
  const c = new Map(counts.map((x) => [String(x._id), x.n]));
  return cats.map((x) => ({ ...x, productCount: c.get(String(x._id)) ?? 0 }));
});
r.post('/categories', { summary: 'Create category or subcategory', permission: 'products:write', body: CategoryInput }, async ({ body, ctx }) => {
  if (body.parentId && !(await Category.exists({ _id: body.parentId }))) throw badRequest('Unknown parent category');
  const doc = await Category.create(body);
  await audit(ctx, 'category.create', 'Category', doc._id, { summary: doc.name });
  return doc;
});
r.patch('/categories/:id', { summary: 'Update category', permission: 'products:write', body: CategoryInput.partial() }, async ({ body, params, ctx }) => {
  if (body.parentId === params.id) throw unprocessable('A category cannot be its own parent');
  const doc = await Category.findByIdAndUpdate(params.id, { $set: body }, { new: true, runValidators: true });
  if (!doc) throw notFound('Category');
  await audit(ctx, 'category.update', 'Category', doc._id, { summary: doc.name, after: body });
  return doc;
});

/* -------------------------------- Brands -------------------------------- */
const BrandInput = z.object({ name: z.string().trim().min(1).max(100), country: zOptStr(60), isActive: z.boolean().default(true) });
r.get('/brands', { summary: 'List brands', permission: 'products:read' }, async () => Brand.find().sort({ name: 1 }).lean());
r.post('/brands', { summary: 'Create brand', permission: 'products:write', body: BrandInput }, async ({ body, ctx }) => {
  const doc = await Brand.create(body);
  await audit(ctx, 'brand.create', 'Brand', doc._id, { summary: doc.name });
  return doc;
});
r.patch('/brands/:id', { summary: 'Update brand', permission: 'products:write', body: BrandInput.partial() }, async ({ body, params, ctx }) => {
  const doc = await Brand.findByIdAndUpdate(params.id, { $set: body }, { new: true, runValidators: true });
  if (!doc) throw notFound('Brand');
  await audit(ctx, 'brand.update', 'Brand', doc._id, { summary: doc.name });
  return doc;
});

/* ------------------------------- Products ------------------------------- */
const ProductQuery = PageQuery.extend({
  categoryId: zId.optional(),
  brandId: zId.optional(),
  vehicleId: zId.optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  stock: z.enum(['low', 'out', 'in']).optional(),
});

r.get('/products', { summary: 'Search/list products with stock (name, SKU, barcode, OEM/alt part numbers)', permission: 'products:read', query: ProductQuery }, async ({ query }) =>
  searchProducts(query),
);

r.get(
  '/products/lookup',
  { summary: 'Exact lookup by barcode, SKU or part number (POS scanner)', permission: 'products:read', query: z.object({ code: z.string().trim().min(1).max(64) }) },
  async ({ query }) => {
    const up = query.code.toUpperCase();
    const p = await Product.findOne({ isActive: true, $or: [{ barcode: query.code }, { sku: up }, { manufacturerPartNumber: up }, { oemPartNumbers: up }, { alternativePartNumbers: up }] }).lean();
    if (!p) throw notFound(`No active product matches "${query.code}"`);
    return { ...p, ...(await productStock(p._id)) };
  },
);

r.get(
  '/products/export',
  { summary: 'Export products (csv|xlsx|pdf)', permission: 'products:read', query: z.object({ format: z.enum(['csv', 'xlsx', 'pdf']).default('csv') }), raw: true },
  async ({ query, res }) => {
    const { items } = await searchProducts({ status: 'all', page: 1, limit: 100_000 });
    type P = (typeof items)[number];
    await sendTable<P>(
      res,
      query.format,
      'products',
      'Products',
      [
        { header: 'sku', value: (p) => p.sku },
        { header: 'name', value: (p) => p.name },
        { header: 'brand', value: (p) => p.brandName },
        { header: 'category', value: (p) => p.categoryName },
        { header: 'manufacturerPartNumber', value: (p) => p.manufacturerPartNumber },
        { header: 'oemPartNumbers', value: (p) => (p.oemPartNumbers ?? []).join(';') },
        { header: 'alternativePartNumbers', value: (p) => (p.alternativePartNumbers ?? []).join(';') },
        { header: 'barcode', value: (p) => p.barcode },
        { header: 'sellingPrice', value: (p) => p.sellingPrice, money: true },
        { header: 'minimumSellingPrice', value: (p) => p.minimumSellingPrice, money: true },
        { header: 'lastPurchaseCost', value: (p) => p.lastPurchaseCost, money: true },
        { header: 'qtyOnHand', value: (p) => p.qtyOnHand },
        { header: 'reorderPoint', value: (p) => p.reorderPoint },
        { header: 'storageLocation', value: (p) => p.storageLocation },
        { header: 'active', value: (p) => (p.isActive ? 'yes' : 'no') },
      ],
      items,
    );
  },
);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

r.post(
  '/products/import',
  {
    summary: 'Bulk import products from CSV or Excel .xlsx (multipart field "file"). Optional openingQty + openingUnitCost columns create opening-stock adjustments.',
    permission: 'products:write',
    status: 200,
    query: z.object({ dryRun: z.enum(['true', 'false']).default('false') }),
  },
  async ({ req, query, ctx }) => {
    const file = req.file;
    if (!file) throw badRequest('Upload a CSV or Excel (.xlsx) file in the "file" field');
    const rows = isZip(file.buffer)
      ? await parseXlsx(file.buffer).catch(() => {
          throw badRequest('The Excel file could not be read');
        })
      : parseCsv(file.buffer.toString('utf8'));
    if (rows.length === 0) throw badRequest('The file has no data rows');
    if (rows.length > 5000) throw badRequest('Import at most 5,000 rows at a time');
    const brands = new Map((await Brand.find().lean()).map((b) => [b.name.toLowerCase(), String(b._id)]));
    const categories = new Map((await Category.find().lean()).map((c) => [c.name.toLowerCase(), String(c._id)]));
    const results: { row: number; sku?: string; status: 'created' | 'error' | 'valid'; message?: string }[] = [];
    for (const [i, row] of rows.entries()) {
      try {
        if (row.brand && !brands.has(row.brand.toLowerCase())) {
          if (query.dryRun === 'true') throw new Error(`Brand "${row.brand}" will be created`);
          const b = await Brand.create({ name: row.brand });
          brands.set(row.brand.toLowerCase(), String(b._id));
        }
        if (row.category && !categories.has(row.category.toLowerCase())) throw new Error(`Unknown category "${row.category}" — create it first`);
        const input = importRowToInput(row, { brands, categories });
        if (await Product.exists({ sku: input.sku })) throw new Error(`SKU ${input.sku} already exists`);
        if (query.dryRun === 'true') {
          results.push({ row: i + 2, sku: input.sku, status: 'valid' });
          continue;
        }
        const p = await createProduct(input, ctx);
        const openingQty = row.openingQty ? Number(row.openingQty) : 0;
        if (openingQty > 0) {
          const unitCost = row.openingUnitCost ? parseToCents(row.openingUnitCost) : 0;
          await requestAdjustment({ productId: String(p._id), qtyChange: openingQty, reason: 'OPENING_BALANCE', notes: 'Opening stock from product import', unitCost, approve: true }, ctx);
        }
        results.push({ row: i + 2, sku: input.sku, status: 'created' });
      } catch (e) {
        const msg = e instanceof z.ZodError ? e.issues.map((x) => `${x.path.join('.')}: ${x.message}`).join('; ') : (e as Error).message;
        results.push({ row: i + 2, sku: row.sku, status: 'error', message: msg });
      }
    }
    await audit(ctx, 'product.import', 'Product', null, { summary: `${results.filter((x) => x.status === 'created').length} created, ${results.filter((x) => x.status === 'error').length} errors` });
    return { total: rows.length, created: results.filter((x) => x.status === 'created').length, errors: results.filter((x) => x.status === 'error').length, results };
  },
  [upload.single('file')],
);

r.post('/products', { summary: 'Create product', permission: 'products:write', body: ProductInput }, async ({ body, ctx }) => createProduct(body, ctx));

r.post(
  '/products/bulk-price',
  {
    summary: 'Bulk price update (percent in basis points or fixed cents)',
    permission: 'products:write',
    status: 200,
    body: z.object({
      productIds: z.array(zId).optional(),
      categoryId: zId.optional(),
      brandId: zId.optional(),
      mode: z.enum(['PERCENT', 'AMOUNT']),
      value: z.number().int().min(-1_000_000).max(1_000_000),
      reason: z.string().trim().min(3).max(300),
    }),
  },
  async ({ body, ctx }) => bulkPriceUpdate(body, ctx),
);

r.get('/products/:id', { summary: 'Product details with stock and compatibility', permission: 'products:read' }, async ({ params }) => {
  const p = await Product.findById(zId.parse(params.id)).populate('brandId', 'name').populate('categoryId', 'name').populate('subcategoryId', 'name').populate('supplierIds', 'name code').lean();
  if (!p) throw notFound('Product');
  const compat = await Compatibility.find({ productId: p._id }).populate('vehicleId').lean();
  const { inventoryValuation } = await import('../inventory/inventory.service.js');
  const [val] = await inventoryValuation({ productIds: [p._id] });
  return { ...p, ...(await productStock(p._id)), inventoryValue: val?.value ?? 0, avgUnitCost: val && val.qty ? Math.round(val.value / val.qty) : 0, compatibility: compat };
});

r.patch(
  '/products/:id',
  { summary: 'Update product (price changes are recorded in price history)', permission: 'products:write', body: ProductInput.partial().extend({ priceChangeReason: zOptStr(300) }) },
  async ({ params, body, ctx }) => updateProduct(zId.parse(params.id), body, ctx),
);

r.post('/products/:id/archive', { summary: 'Archive (soft-delete) a product; history is retained', permission: 'products:write', status: 200 }, async ({ params, ctx }) =>
  updateProduct(zId.parse(params.id), { isActive: false }, ctx),
);
r.post('/products/:id/restore', { summary: 'Restore an archived product', permission: 'products:write', status: 200 }, async ({ params, ctx }) =>
  updateProduct(zId.parse(params.id), { isActive: true }, ctx),
);

r.get('/products/:id/history', { summary: 'Price history, stock movements and audit trail of a product', permission: 'products:read' }, async ({ params }) => {
  const id = new Types.ObjectId(zId.parse(params.id));
  const [prices, movements, auditTrail] = await Promise.all([
    PriceHistory.find({ productId: id }).sort({ at: -1 }).limit(200).lean(),
    Movement.find({ productId: id }).sort({ at: -1 }).limit(500).lean(),
    AuditLog.find({ entity: 'Product', entityId: String(id) })
      .sort({ at: -1 })
      .limit(100)
      .lean(),
  ]);
  return { prices, movements, audit: auditTrail };
});

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});
function sniffImage(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
}
r.post(
  '/products/:id/image',
  { summary: 'Upload product image (PNG/JPEG/WebP ≤ 2 MB, multipart field "image")', permission: 'products:write', status: 200 },
  async ({ req, params, ctx }) => {
    const id = zId.parse(params.id);
    if (!req.file) throw badRequest('Upload a PNG, JPEG or WebP image in the "image" field');
    const ext = sniffImage(req.file.buffer);
    if (!ext) throw badRequest('File content is not a valid PNG, JPEG or WebP image');
    const dir = path.resolve(env.UPLOAD_DIR, 'products');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${id}-${randomBytes(6).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(dir, name), req.file.buffer);
    return updateProduct(id, { imageUrl: `/uploads/products/${name}` }, ctx);
  },
  [imageUpload.single('image')],
);

/* ------------------------------- Vehicles ------------------------------- */
const VehicleInput = z
  .object({
    make: z.string().trim().min(1).max(60),
    model: z.string().trim().min(1).max(60),
    generation: zOptStr(60),
    yearFrom: z.number().int().min(1900).max(2100),
    yearTo: z.number().int().min(1900).max(2100).optional(),
    engineCode: zOptStr(30),
    engineSize: zOptStr(20),
    fuelType: z.enum(FUEL_TYPES).optional(),
    transmission: zOptStr(40),
    variant: zOptStr(80),
  })
  .refine((v) => !v.yearTo || v.yearTo >= v.yearFrom, { message: 'End year must be after start year', path: ['yearTo'] });

const VehicleQuery = PageQuery.extend({ make: z.string().optional(), model: z.string().optional(), year: z.coerce.number().int().optional(), engine: z.string().optional() });
function vehicleFilter(q: z.infer<typeof VehicleQuery>) {
  const f: Record<string, unknown> = {};
  if (q.make) f.make = new RegExp(`^${escapeRegex(q.make)}$`, 'i');
  if (q.model) f.model = new RegExp(escapeRegex(q.model), 'i');
  if (q.year) {
    f.yearFrom = { $lte: q.year };
    f.$or = [{ yearTo: { $gte: q.year } }, { yearTo: null }];
  }
  if (q.engine) f.$and = [{ $or: [{ engineCode: new RegExp(escapeRegex(q.engine), 'i') }, { engineSize: new RegExp(escapeRegex(q.engine), 'i') }] }];
  if (q.search) {
    const rx = new RegExp(escapeRegex(q.search), 'i');
    f.$and = [...((f.$and as object[]) ?? []), { $or: [{ make: rx }, { model: rx }, { generation: rx }, { variant: rx }, { engineCode: rx }] }];
  }
  return f;
}
r.get('/vehicles', { summary: 'Search vehicles by make, model, year, engine', permission: 'products:read', query: VehicleQuery }, async ({ query }) =>
  paginate(Vehicle, vehicleFilter(query), query, ['make', 'model', 'yearFrom'], undefined, 'make'),
);
r.get('/vehicles/makes', { summary: 'Distinct vehicle makes and models', permission: 'products:read' }, async () => {
  const rows = await Vehicle.aggregate([{ $group: { _id: '$make', models: { $addToSet: '$model' } } }, { $sort: { _id: 1 } }]);
  return rows.map((r2) => ({ make: r2._id, models: (r2.models as string[]).sort() }));
});
r.post('/vehicles', { summary: 'Register a vehicle variant', permission: 'products:write', body: VehicleInput }, async ({ body, ctx }) => {
  const doc = await Vehicle.create(body);
  await audit(ctx, 'vehicle.create', 'Vehicle', doc._id, { summary: `${doc.make} ${doc.model} ${doc.yearFrom}` });
  return doc;
});
r.patch('/vehicles/:id', { summary: 'Update vehicle', permission: 'products:write', body: VehicleInput.innerType().partial() }, async ({ params, body, ctx }) => {
  const doc = await Vehicle.findByIdAndUpdate(params.id, { $set: body }, { new: true, runValidators: true });
  if (!doc) throw notFound('Vehicle');
  await audit(ctx, 'vehicle.update', 'Vehicle', doc._id);
  return doc;
});

/** Parts that fit a vehicle search — only explicit compatibility records count, never name matching. */
r.get(
  '/vehicles/parts',
  { summary: 'Find compatible parts for a vehicle search (make/model/year/engine)', permission: 'products:read', query: VehicleQuery.extend({ part: z.string().optional() }) },
  async ({ query }) => {
    const vehicles = await Vehicle.find(vehicleFilter(query)).limit(200).lean();
    const compat = await Compatibility.find({ vehicleId: { $in: vehicles.map((v) => v._id) } }).lean();
    const pFilter: Record<string, unknown> = { _id: { $in: compat.map((c) => c.productId) }, isActive: true };
    if (query.part) {
      const rx = new RegExp(escapeRegex(query.part), 'i');
      pFilter.$or = [{ name: rx }, { sku: rx }, { oemPartNumbers: rx }, { alternativePartNumbers: rx }, { manufacturerPartNumber: rx }];
    }
    const products = await Product.find(pFilter).lean();
    const byP = new Map<string, typeof compat>();
    for (const c of compat) byP.set(String(c.productId), [...(byP.get(String(c.productId)) ?? []), c]);
    const vById = new Map(vehicles.map((v) => [String(v._id), v]));
    return {
      vehicles: vehicles.length,
      items: await Promise.all(
        products.map(async (p) => ({
          ...p,
          ...(await productStock(p._id)),
          fitments: (byP.get(String(p._id)) ?? []).map((c) => ({ ...c, vehicle: vById.get(String(c.vehicleId)) })),
          hasUnverified: (byP.get(String(p._id)) ?? []).some((c) => !c.verified),
        })),
      ),
    };
  },
);

const CompatInput = z.object({ productId: zId, vehicleId: zId, source: z.enum(FITMENT_SOURCES), sourceReference: zOptStr(200), verified: z.boolean().default(false), notes: zOptStr(500) });
r.post('/compatibility', { summary: 'Link a product to a vehicle with its data source', permission: 'products:write', body: CompatInput }, async ({ body, ctx }) => {
  if (!(await Product.exists({ _id: body.productId }))) throw notFound('Product');
  if (!(await Vehicle.exists({ _id: body.vehicleId }))) throw notFound('Vehicle');
  try {
    const doc = await Compatibility.create({ ...body, createdBy: ctx.userId });
    await audit(ctx, 'compatibility.create', 'Compatibility', doc._id, { after: body });
    return doc;
  } catch (e) {
    if ((e as { code?: number }).code === 11000) throw conflict('This product is already linked to that vehicle');
    throw e;
  }
});
r.patch(
  '/compatibility/:id',
  { summary: 'Update compatibility record (e.g. mark verified)', permission: 'products:write', body: CompatInput.pick({ source: true, sourceReference: true, verified: true, notes: true }).partial() },
  async ({ params, body, ctx }) => {
    const doc = await Compatibility.findByIdAndUpdate(params.id, { $set: body }, { new: true });
    if (!doc) throw notFound('Compatibility record');
    await audit(ctx, 'compatibility.update', 'Compatibility', doc._id, { after: body });
    return doc;
  },
);
r.delete('/compatibility/:id', { summary: 'Remove an incorrect compatibility link', permission: 'products:write' }, async ({ params, ctx }) => {
  const doc = await Compatibility.findByIdAndDelete(params.id).lean();
  if (!doc) throw notFound('Compatibility record');
  await audit(ctx, 'compatibility.delete', 'Compatibility', params.id, { before: doc });
  return { deleted: true };
});
