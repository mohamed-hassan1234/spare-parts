import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, key, loginAsAdmin, useTestDb, type Api } from '../helpers.js';
import { InventoryBalance } from '../../modules/inventory/inventory.models.js';
import { Notification } from '../../modules/system/system.models.js';
import { Sale } from '../../modules/sales/sales.models.js';
import { runAlertChecks } from '../../jobs/scheduler.js';

/** Workflows not covered by the core business-flow suite. Amounts in cents. */
const t = useTestDb();
let api: Api;
let supplierId = '';
const stock = async (productId: string) => (await InventoryBalance.findOne({ productId }).lean())?.qtyOnHand ?? 0;
const cash = async (code: string) => expectOk(await api.get('/finance/cash')).accounts.find((a: { code: string }) => a.code === code).balance as number;
const reconciled = async () => expect(expectOk(await api.get('/finance/reconciliation')).checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([]);

async function stocked(sku: string, qty: number, unitPrice: number, sellingPrice = unitPrice * 2, extra: object = {}) {
  const productId = expectOk(await api.post('/products', { sku, name: `Item ${sku}`, sellingPrice, ...extra }), 201)._id as string;
  const p = expectOk(await api.post('/purchases', { supplierId, purchaseDate: new Date().toISOString(), submit: true, items: [{ productId, qtyOrdered: qty, unitPrice }] }), 201);
  expectOk(await api.post(`/purchases/${p._id}/receive`, { lines: [{ itemId: p.items[0]._id, qty }] }), 201);
  return { productId, purchaseId: p._id as string };
}

beforeAll(async () => {
  api = await loginAsAdmin(t.app);
  supplierId = expectOk(await api.post('/suppliers', { name: 'Workflow Supplier', paymentTermsDays: 1 }), 201)._id;
});

describe('stock counts', () => {
  it('records differences as count-correction adjustments and posts them when approved', async () => {
    const { productId } = await stocked('CNT-1', 10, 300);
    const count = expectOk(await api.post('/inventory/stock-counts', { approve: true, lines: [{ productId, countedQty: 8 }] }), 201);
    const line = count.lines[0];
    expect(line.systemQty).toBe(10);
    expect(line.difference).toBe(-2);
    expect(await stock(productId)).toBe(8);
    const pl = expectOk(await api.get('/reports/profit-loss?period=all'));
    expect(pl.inventoryLoss).toBe(600);
    await reconciled();
  });
});

describe('supplier returns', () => {
  it('returns goods for credit (reduces the payable) and for replacement (stock comes back)', async () => {
    const { productId, purchaseId } = await stocked('SR-1', 10, 500);
    const before = expectOk(await api.get(`/suppliers/${supplierId}`)).payable;
    const credit = expectOk(await api.post('/supplier-returns', { supplierId, purchaseId, reason: 'DEFECTIVE', settlement: 'CREDIT', lines: [{ productId, qty: 2 }] }), 201);
    expect(credit.totalCost).toBe(1_000);
    expect(await stock(productId)).toBe(8);
    expect(expectOk(await api.get(`/suppliers/${supplierId}`)).payable).toBe(before - 1_000);
    const repl = expectOk(await api.post('/supplier-returns', { supplierId, purchaseId, reason: 'INCORRECT_ITEM', settlement: 'REPLACEMENT', lines: [{ productId, qty: 3 }] }), 201);
    expect(repl.status).toBe('AWAITING_REPLACEMENT');
    expect(await stock(productId)).toBe(5);
    expectOk(await api.post(`/supplier-returns/${repl._id}/replacement`));
    expect(await stock(productId)).toBe(8);
    expect((await api.post(`/supplier-returns/${repl._id}/replacement`)).status).toBeGreaterThanOrEqual(400);
    expect((await api.post('/supplier-returns', { supplierId, reason: 'OTHER', settlement: 'CREDIT', lines: [{ productId, qty: 999 }] })).status).toBeGreaterThanOrEqual(400);
    await reconciled();
  });
});

describe('warranty claims', () => {
  it('opens a claim within the warranty period and resolves it with a replacement from stock', async () => {
    const { productId } = await stocked('WAR-1', 3, 2_000, 5_000, { warrantyMonths: 6 });
    const sale = expectOk(await api.post('/sales', { items: [{ productId, qty: 1 }], payments: [{ method: 'CASH', amount: 5_000 }] }, { 'Idempotency-Key': key() }), 201).sale;
    const claim = expectOk(await api.post('/warranty-claims', { saleId: sale._id, saleItemId: sale.items[0]._id, issue: 'Noise after 2 weeks' }), 201);
    expect(claim.status).toBe('OPEN');
    expectOk(await api.patch(`/warranty-claims/${claim._id}`, { status: 'IN_REVIEW', note: 'Inspected on bench' }));
    const done = expectOk(await api.patch(`/warranty-claims/${claim._id}`, { resolution: 'REPLACED', resolutionNotes: 'Swapped', replaceFromStock: true }));
    expect(done.status).toBe('RESOLVED');
    expect(done.replacementCost).toBe(2_000);
    expect(await stock(productId)).toBe(1);
    expect((await api.patch(`/warranty-claims/${claim._id}`, { note: 'late' })).status).toBe(422);
    // A product sold without warranty cannot be claimed.
    const noW = await stocked('WAR-2', 1, 100);
    const s2 = expectOk(await api.post('/sales', { items: [{ productId: noW.productId, qty: 1 }], payments: [{ method: 'CASH', amount: 200 }] }, { 'Idempotency-Key': key() }), 201).sale;
    expect((await api.post('/warranty-claims', { saleId: s2._id, saleItemId: s2.items[0]._id, issue: 'Not working' })).status).toBe(422);
    await reconciled();
  });
});

describe('cash, capital and journal reversals', () => {
  it('posts capital, transfers between accounts, and reverses a transfer exactly once', async () => {
    expectOk(await api.post('/finance/transactions', { type: 'CAPITAL_INJECTION', amount: 100_000, account: '1010', memo: 'Owner capital' }), 201);
    const bank = await cash('1010');
    const cashBefore = await cash('1000');
    const tr = expectOk(await api.post('/finance/transactions', { type: 'TRANSFER', amount: 30_000, account: '1000', fromAccount: '1010', memo: 'Float' }), 201);
    expect(await cash('1010')).toBe(bank - 30_000);
    expect(await cash('1000')).toBe(cashBefore + 30_000);
    const je = tr.journalEntryId ?? tr._id;
    expectOk(await api.post(`/finance/journal/${je}/reverse`, { reason: 'Entered twice' }));
    expect(await cash('1000')).toBe(cashBefore);
    expect((await api.post(`/finance/journal/${je}/reverse`, { reason: 'again' })).status).toBe(422);
    // Business documents cannot be reversed from the ledger screen.
    const saleJe = (await Sale.findOne().lean())!.journalEntryId;
    expect((await api.post(`/finance/journal/${saleJe}/reverse`, { reason: 'nope' })).status).toBe(422);
    const pl = expectOk(await api.get('/reports/profit-loss?period=all'));
    expect(pl.otherIncome).toBe(0); // capital is equity, never income
    await reconciled();
  });
});

describe('recurring expenses and bulk prices', () => {
  it('records a recurring expense once per month', async () => {
    const rent = expectOk(await api.get('/expense-categories')).find((c: { name: string }) => c.name === 'Shop Rent');
    const tpl = expectOk(await api.post('/recurring-expenses', { name: 'Rent', categoryId: rent._id, amount: 50_000, method: 'BANK_TRANSFER', dayOfMonth: 1 }), 201);
    expectOk(await api.post(`/recurring-expenses/${tpl._id}/record`), 201);
    expect((await api.post(`/recurring-expenses/${tpl._id}/record`)).status).toBe(409);
  });

  it('updates prices in bulk with price history and leaves past invoices untouched', async () => {
    const cat = expectOk(await api.post('/categories', { name: 'Bulk Cat' }), 201)._id;
    const a = expectOk(await api.post('/products', { sku: 'BULK-A', name: 'Bulk A', sellingPrice: 1_000, categoryId: cat }), 201)._id;
    const b = expectOk(await api.post('/products', { sku: 'BULK-B', name: 'Bulk B', sellingPrice: 2_005, categoryId: cat }), 201)._id;
    expectOk(await api.post('/products/bulk-price', { categoryId: cat, mode: 'PERCENT', value: 1_000, reason: 'Supplier increase' }));
    expect(expectOk(await api.get(`/products/${a}`)).sellingPrice).toBe(1_100);
    expect(expectOk(await api.get(`/products/${b}`)).sellingPrice).toBe(2_206); // 2005 × 1.10 = 2205.5 → rounded half away from zero
    expect(expectOk(await api.get(`/products/${a}/history`)).prices).toHaveLength(1);
  });
});

describe('settings, alerts and AI insights', () => {
  it('validates and audits settings changes', async () => {
    expect((await api.patch('/settings', { ...expectOk(await api.get('/settings')), timezone: 'Mars/Olympus' })).status).toBe(400);
    const s = expectOk(await api.get('/settings'));
    const { _id: _ignored, updatedAt: _u, updatedBy: _b, logoUrl: _l, ...body } = s;
    expectOk(await api.patch('/settings', { ...body, businessName: 'Test Spare Parts', taxRateBps: 0 }));
    expect(expectOk(await api.get('/settings/public')).businessName).toBe('Test Spare Parts');
    const audit = expectOk(await api.get('/audit-logs?action=settings.update'));
    expect(audit.items.length).toBeGreaterThan(0);
  });

  it('raises overdue-invoice, supplier-due and stock alerts', async () => {
    const { productId } = await stocked('ALERT-1', 3, 100, 300, { reorderPoint: 5 });
    const c = expectOk(await api.post('/customers', { name: 'Late Payer', creditLimit: 10_000, paymentTermsDays: 1 }), 201)._id;
    const s = expectOk(await api.post('/sales', { customerId: c, items: [{ productId, qty: 1 }], payments: [] }, { 'Idempotency-Key': key() }), 201).sale;
    await Sale.updateOne({ _id: s._id }, { $set: { dueDate: new Date(Date.now() - 86_400_000) } });
    await runAlertChecks();
    const types = new Set((await Notification.find().lean()).map((n) => n.type));
    expect(types.has('OVERDUE_INVOICE')).toBe(true);
    expect(types.has('SUPPLIER_PAYMENT_DUE')).toBe(true);
    expect(types.has('LOW_STOCK')).toBe(true);
    const n = await Notification.countDocuments();
    await runAlertChecks();
    expect(await Notification.countDocuments()).toBe(n); // idempotent
  });

  it('produces a monthly report from ledger figures without an AI key', async () => {
    const r = expectOk(await api.post('/ai/monthly-report', { period: 'thisMonth' }));
    expect(r.source).toBe('rules');
    const pl = expectOk(await api.get('/reports/profit-loss?period=thisMonth'));
    expect(r.facts.totals.netSales).toBe(pl.netSales);
    expect(r.facts.totals.netProfit).toBe(pl.netProfit);
    expect(r.narrative.suggestedActions.length).toBeGreaterThan(0);
  });
});
