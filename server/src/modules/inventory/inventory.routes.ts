import { z } from 'zod';
import { Types } from 'mongoose';
import { MOVEMENT_TYPES } from '@autoparts/shared';
import { ModuleRouter, zCents, zId, zOptStr, zQty } from '../../utils/http.js';
import { ADJUSTMENT_REASONS, Movement, StockAdjustment, StockCount, Warehouse } from './inventory.models.js';
import { approveAdjustment, recordStockCount, rejectAdjustment, requestAdjustment } from './adjustments.service.js';
import { getDefaultWarehouse, releaseReservation, reserveStock } from './inventory.service.js';
import { inventoryReport } from '../reports/reports.service.js';
import { searchProducts } from '../catalog/catalog.service.js';
import { Product } from '../catalog/catalog.models.js';
import { PageQuery, escapeRegex, paginate } from '../../utils/pagination.js';
import { sendTable } from '../../utils/export.js';
import { withTx } from '../../utils/tx.js';
import { audit } from '../system/audit.service.js';

export const inventoryRoutes = new ModuleRouter('/inventory', 'Inventory');
const r = inventoryRoutes;

r.get(
  '/',
  {
    summary: 'Stock overview (paginated products with quantities)',
    permission: 'inventory:read',
    query: PageQuery.extend({ categoryId: zId.optional(), stock: z.enum(['low', 'out', 'in']).optional() }),
  },
  async ({ query }) => searchProducts({ ...query, status: 'active' }),
);
r.get('/warehouses', { summary: 'Stock locations', permission: 'inventory:read' }, async () => Warehouse.find().lean());

r.get(
  '/movements',
  {
    summary: 'Stock movement history',
    permission: 'inventory:read',
    query: PageQuery.extend({ productId: zId.optional(), type: z.enum(MOVEMENT_TYPES).optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
  },
  async ({ query }) => {
    const f: Record<string, unknown> = {};
    if (query.productId) f.productId = new Types.ObjectId(query.productId);
    if (query.type) f.type = query.type;
    if (query.from || query.to) f.at = { ...(query.from ? { $gte: query.from } : {}), ...(query.to ? { $lt: query.to } : {}) };
    if (query.search) {
      const ids = await Product.find({ $or: [{ sku: new RegExp(escapeRegex(query.search), 'i') }, { name: new RegExp(escapeRegex(query.search), 'i') }] }).distinct('_id');
      f.$or = [{ productId: { $in: ids } }, { sourceRef: new RegExp(escapeRegex(query.search), 'i') }];
    }
    return paginate(Movement, f, query, ['at'], { path: 'productId', select: 'sku name' }, '-at');
  },
);

r.get(
  '/valuation',
  {
    summary: 'Inventory valuation (Σ remaining FIFO layer cost) with aging, dead and slow stock',
    permission: 'inventory:read',
    query: z.object({ format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json') }),
    raw: true,
  },
  async ({ query, res }) => {
    const rep = await inventoryReport();
    if (query.format === 'json') return void res.json({ data: rep });
    type R = (typeof rep.rows)[number];
    await sendTable<R>(
      res,
      query.format,
      'inventory-valuation',
      'Inventory Valuation (FIFO)',
      [
        { header: 'SKU', value: (x) => x.sku },
        { header: 'Product', value: (x) => x.name },
        { header: 'Category', value: (x) => x.category },
        { header: 'On hand', value: (x) => x.onHand },
        { header: 'Avg unit cost', value: (x) => x.avgUnitCost, money: true },
        { header: 'Value', value: (x) => x.value, money: true },
        { header: 'Oldest stock (days)', value: (x) => x.oldestStockDays },
        { header: 'Status', value: (x) => x.status },
      ],
      rep.rows,
      `Total value ${(rep.totalValue / 100).toFixed(2)}`,
    );
  },
);
r.get('/low-stock', { summary: 'Products at or below reorder point, and out of stock', permission: 'inventory:read' }, async () => {
  const rep = await inventoryReport();
  return { lowStock: rep.lowStock, outOfStock: rep.outOfStock };
});

r.get(
  '/adjustments',
  { summary: 'Stock adjustments', permission: 'inventory:read', query: PageQuery.extend({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional() }) },
  async ({ query }) => {
    const f: Record<string, unknown> = {};
    if (query.status) f.status = query.status;
    return paginate(
      StockAdjustment,
      f,
      query,
      ['createdAt'],
      [
        { path: 'productId', select: 'sku name' },
        { path: 'requestedBy', select: 'fullName' },
      ],
    );
  },
);
r.post(
  '/adjustments',
  {
    summary: 'Request a stock adjustment (reason required). approve=true posts immediately.',
    permission: 'inventory:adjust',
    body: z.object({
      productId: zId,
      qtyChange: z
        .number()
        .int()
        .refine((v) => v !== 0, 'Quantity change cannot be zero'),
      reason: z.enum(ADJUSTMENT_REASONS),
      notes: z.string().trim().min(3).max(1000),
      unitCost: zCents.optional(),
      approve: z.boolean().default(false),
    }),
  },
  async ({ body, ctx }) => requestAdjustment(body, ctx),
);
r.post('/adjustments/:id/approve', { summary: 'Approve and post a pending adjustment', permission: 'inventory:adjust', status: 200 }, async ({ params, ctx }) =>
  approveAdjustment(zId.parse(params.id), ctx),
);
r.post(
  '/adjustments/:id/reject',
  { summary: 'Reject a pending adjustment', permission: 'inventory:adjust', status: 200, body: z.object({ reason: z.string().trim().min(3).max(500) }) },
  async ({ params, body, ctx }) => rejectAdjustment(zId.parse(params.id), body.reason, ctx),
);

r.get('/stock-counts', { summary: 'Physical stock counts', permission: 'inventory:read', query: PageQuery }, async ({ query }) =>
  paginate(StockCount, {}, query, ['createdAt'], { path: 'lines.productId', select: 'sku name' }),
);
r.post(
  '/stock-counts',
  {
    summary: 'Record a physical count; differences generate adjustments',
    permission: 'inventory:adjust',
    body: z.object({
      notes: zOptStr(1000),
      approve: z.boolean().default(false),
      lines: z
        .array(z.object({ productId: zId, countedQty: z.number().int().min(0) }))
        .min(1)
        .max(2000),
    }),
  },
  async ({ body, ctx }) => recordStockCount(body, ctx),
);

const ReserveBody = z.object({ productId: zId, qty: zQty, reference: z.string().trim().min(1).max(100) });
r.post('/reservations', { summary: 'Reserve stock (reduces available, not on-hand)', permission: 'inventory:adjust', body: ReserveBody }, async ({ body, ctx }) => {
  const wh = await getDefaultWarehouse();
  return withTx(async (session) => {
    const bal = await reserveStock(
      {
        productId: new Types.ObjectId(body.productId),
        warehouseId: wh._id,
        qty: body.qty,
        sourceType: 'RESERVATION',
        sourceId: new Types.ObjectId(),
        sourceRef: body.reference,
        lineKey: 'reserve',
        userId: ctx.userId,
      },
      session,
    );
    await audit(ctx, 'inventory.reserve', 'Product', body.productId, { summary: `${body.qty} for ${body.reference}`, session });
    return bal;
  });
});
r.post('/reservations/release', { summary: 'Release reserved stock', permission: 'inventory:adjust', status: 200, body: ReserveBody }, async ({ body, ctx }) => {
  const wh = await getDefaultWarehouse();
  return withTx(async (session) => {
    const bal = await releaseReservation(
      {
        productId: new Types.ObjectId(body.productId),
        warehouseId: wh._id,
        qty: body.qty,
        sourceType: 'RESERVATION',
        sourceId: new Types.ObjectId(),
        sourceRef: body.reference,
        lineKey: 'release',
        userId: ctx.userId,
      },
      session,
    );
    await audit(ctx, 'inventory.release', 'Product', body.productId, { summary: `${body.qty} for ${body.reference}`, session });
    return bal;
  });
});
