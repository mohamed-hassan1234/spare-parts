import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, key, loginAsAdmin, useTestDb, type Api } from '../helpers.js';
import { InventoryBalance, Movement } from '../../modules/inventory/inventory.models.js';
import { Sale } from '../../modules/sales/sales.models.js';
import { JournalEntry } from '../../modules/ledger/ledger.models.js';

/**
 * Business scenarios A–H from the specification, with the exact expected figures.
 * Each describe block uses its own products so scenarios do not interfere. All amounts in cents.
 */
const t = useTestDb();
let api: Api;
let supplierId = '';

const stock = async (productId: string) => (await InventoryBalance.findOne({ productId }).lean())?.qtyOnHand ?? 0;
const valuation = async (productId: string) =>
  (expectOk(await api.get('/inventory/valuation')).rows as { productId: string; value: number }[]).find((r) => String(r.productId) === productId)?.value ?? 0;

async function newProduct(sku: string, sellingPrice: number) {
  return expectOk(await api.post('/products', { sku, name: `Scenario ${sku}`, sellingPrice }), 201)._id as string;
}
async function buyAndReceive(productId: string, qty: number, unitPrice: number) {
  const p = expectOk(await api.post('/purchases', { supplierId, purchaseDate: new Date().toISOString(), submit: true, items: [{ productId, qtyOrdered: qty, unitPrice }] }), 201);
  const r = expectOk(await api.post(`/purchases/${p._id}/receive`, { lines: [{ itemId: p.items[0]._id, qty }] }, { 'Idempotency-Key': key() }), 201);
  return { purchase: p, receipt: r.receipt };
}
const sell = async (body: object, idem = key()) => api.post('/sales', body, { 'Idempotency-Key': idem });
const plAll = async () => expectOk(await api.get('/reports/profit-loss?period=all'));

beforeAll(async () => {
  api = await loginAsAdmin(t.app);
  supplierId = expectOk(await api.post('/suppliers', { name: 'Scenario Supplier' }), 201)._id;
});

describe('Scenario A — product purchase: 100 oil filters at $5', () => {
  let oil = '';
  it('records $500 purchase, 100 units, a $500 FIFO layer, a payable and a balanced ledger', async () => {
    oil = await newProduct('SCN-OIL', 800);
    const { purchase, receipt } = await buyAndReceive(oil, 100, 500);
    expect(purchase.total).toBe(50_000);
    expect(receipt.totalCost).toBe(50_000);
    expect(await stock(oil)).toBe(100);
    expect(await valuation(oil)).toBe(50_000);
    const sup = expectOk(await api.get(`/suppliers/${supplierId}`));
    expect(sup.payable).toBe(50_000);
    expect(expectOk(await api.get('/finance/trial-balance')).balanced).toBe(true);
  });

  it('Scenario B — selling 30 at $8: revenue $240, COGS $150, GP $90, 70 left worth $350', async () => {
    const out = expectOk(await sell({ items: [{ productId: oil, qty: 30 }], payments: [{ method: 'CASH', amount: 24_000 }] }), 201);
    expect(out.sale.netSales).toBe(24_000);
    expect(out.sale.cogsTotal).toBe(15_000);
    expect(out.sale.grossProfit).toBe(9_000);
    expect(await stock(oil)).toBe(70);
    expect(await valuation(oil)).toBe(35_000);
  });

  it('Scenario C — $20 operating expense: GP stays $90, operating profit $70, cash reduced', async () => {
    const cashBefore = expectOk(await api.get('/finance/cash')).accounts.find((a: { code: string }) => a.code === '1000').balance;
    const rent = expectOk(await api.get('/expense-categories')).find((c: { name: string }) => c.name === 'Shop Rent');
    expectOk(await api.post('/expenses', { categoryId: rent._id, description: 'Scenario C', amount: 2_000, date: new Date().toISOString(), method: 'CASH' }), 201);
    const pl = await plAll();
    expect(pl.grossProfit).toBe(9_000);
    expect(pl.operatingProfit).toBe(7_000);
    const cashAfter = expectOk(await api.get('/finance/cash')).accounts.find((a: { code: string }) => a.code === '1000').balance;
    expect(cashBefore - cashAfter).toBe(2_000);
  });
});

describe('Scenario D — $200 credit sale, $80 paid', () => {
  it('leaves a $120 receivable that the customer statement reflects', async () => {
    const p = await newProduct('SCN-D', 2_000);
    await buyAndReceive(p, 10, 1_000);
    const c = expectOk(await api.post('/customers', { name: 'Scenario D Garage', creditLimit: 100_000 }), 201)._id;
    const s = expectOk(await sell({ customerId: c, items: [{ productId: p, qty: 10 }], payments: [] }), 201).sale;
    expect(s.total).toBe(20_000);
    expect(s.paymentStatus).toBe('UNPAID');
    expectOk(await api.post(`/sales/${s._id}/payments`, { amount: 8_000, method: 'CASH' }), 201);
    const cust = expectOk(await api.get(`/customers/${c}`));
    expect(cust.receivable).toBe(12_000);
    const stmt = expectOk(await api.get(`/customers/${c}/statement?period=all`));
    expect(stmt.rows.map((r: { increase: number; decrease: number }) => [r.increase, r.decrease])).toEqual([
      [20_000, 0],
      [0, 8_000],
    ]);
    expect(stmt.closing).toBe(12_000);
  });
});

describe('Scenario E — FIFO with a cost change', () => {
  it('10 @ $5 then 10 @ $7, sell 12 → COGS $64, 8 left at $7 = $56', async () => {
    const p = await newProduct('SCN-E', 1_000);
    await buyAndReceive(p, 10, 500);
    await buyAndReceive(p, 10, 700);
    const s = expectOk(await sell({ items: [{ productId: p, qty: 12 }], payments: [{ method: 'CASH', amount: 12_000 }] }), 201).sale;
    expect(s.cogsTotal).toBe(10 * 500 + 2 * 700);
    expect(await stock(p)).toBe(8);
    expect(await valuation(p)).toBe(5_600);
  });
});

describe('Scenario F — concurrent checkout of the last item', () => {
  it('allows exactly one sale, no negative stock and no duplicate ledger entries', async () => {
    const p = await newProduct('SCN-F', 1_000);
    await buyAndReceive(p, 1, 500);
    const jeBefore = await JournalEntry.countDocuments({ sourceType: 'SALE' });
    const body = { items: [{ productId: p, qty: 1 }], payments: [{ method: 'CASH', amount: 1_000 }] };
    const results = await Promise.all([sell(body), sell(body), sell(body)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    const failed = results.filter((r) => r.status === 409);
    for (const f of failed) expect(f.body.error.message).toMatch(/Insufficient stock/);
    expect(await stock(p)).toBe(0);
    expect((await InventoryBalance.findOne({ productId: p }).lean())!.qtyAvailable).toBe(0);
    expect(await JournalEntry.countDocuments({ sourceType: 'SALE' })).toBe(jeBefore + 1);
  });

  it('duplicate checkout and payment submissions are recorded once', async () => {
    const p = await newProduct('SCN-F2', 1_000);
    await buyAndReceive(p, 5, 500);
    const c = expectOk(await api.post('/customers', { name: 'Scenario F Garage', creditLimit: 100_000 }), 201)._id;
    const idem = key();
    const body = { customerId: c, items: [{ productId: p, qty: 2 }], payments: [] };
    const [a, b] = await Promise.all([sell(body, idem), sell(body, idem)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(await Sale.countDocuments({ idempotencyKey: idem })).toBe(1);
    expect(await stock(p)).toBe(3);
    const payKey = key();
    const pay = { customerId: c, amount: 500, method: 'CASH' };
    await Promise.all([api.post('/customer-payments', pay, { 'Idempotency-Key': payKey }), api.post('/customer-payments', pay, { 'Idempotency-Key': payKey })]);
    expect(expectOk(await api.get(`/customers/${c}`)).receivable).toBe(2_000 - 500);
  });

  it('simultaneous stock adjustments never drive stock negative', async () => {
    const p = await newProduct('SCN-F3', 1_000);
    await buyAndReceive(p, 3, 500);
    const adj = () => api.post('/inventory/adjustments', { productId: p, qtyChange: -2, reason: 'DAMAGE', notes: 'concurrency test', approve: true });
    const res = await Promise.all([adj(), adj()]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await stock(p)).toBe(1);
  });
});

describe('Scenario G — partial return of 2 out of 5', () => {
  it('limits quantity, refunds at original price, reverses revenue and COGS, quarantines uninspected stock, and never double-processes', async () => {
    const p = await newProduct('SCN-G', 1_000);
    await buyAndReceive(p, 5, 600);
    const s = expectOk(await sell({ items: [{ productId: p, qty: 5 }], payments: [{ method: 'CASH', amount: 5_000 }] }), 201).sale;
    // A later price change must not affect the refund.
    expectOk(await api.patch(`/products/${p}`, { sellingPrice: 1_500, priceChangeReason: 'scenario G' }));
    const before = await plAll();
    const idem = key();
    const body = { reason: 'Customer changed mind', refundMethod: 'CASH', lines: [{ saleItemId: s.items[0]._id, qty: 2, condition: 'PENDING_INSPECTION' }] };
    const [r1, r2] = await Promise.all([api.post(`/sales/${s._id}/returns`, body, { 'Idempotency-Key': idem }), api.post(`/sales/${s._id}/returns`, body, { 'Idempotency-Key': idem })]);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    const ret = (r1.status === 201 ? r1 : r2).body.data.ret;
    expect(ret.totalAmount).toBe(2_000);
    expect(ret.refundAmount).toBe(2_000);
    expect(ret.lines[0].cost).toBe(1_200);
    expect(await stock(p)).toBe(0); // quarantined, not sellable
    const after = await plAll();
    expect(after.returns - before.returns).toBe(2_000);
    expect(before.cogs - after.cogs).toBe(1_200);
    expect((await api.post(`/sales/${s._id}/returns`, { ...body, lines: [{ ...body.lines[0], qty: 4 }] })).status).toBe(422);
    expectOk(await api.post(`/returns/${ret._id}/inspect`, { saleItemId: s.items[0]._id, decision: 'RESTOCK' }));
    expect(await stock(p)).toBe(2);
    expect(await valuation(p)).toBe(1_200);
  });
});

describe('Scenario H — transaction failure during checkout', () => {
  it('leaves no partial sale, stock change or ledger entry, returns a safe error, and the retry succeeds once', async () => {
    const p = await newProduct('SCN-H', 1_000);
    await buyAndReceive(p, 4, 500);
    const snap = async () => ({ stock: await stock(p), sales: await Sale.countDocuments(), je: await JournalEntry.countDocuments(), mv: await Movement.countDocuments() });
    const before = await snap();
    const idem = key();
    const body = { items: [{ productId: p, qty: 2 }], payments: [{ method: 'CASH', amount: 2_000 }] };
    // Fail the write of the sale document — after stock was allocated and journals posted inside the transaction.
    const original = Sale.create.bind(Sale);
    (Sale as unknown as { create: unknown }).create = async () => {
      throw new Error('Simulated database failure');
    };
    let failed;
    try {
      failed = await sell(body, idem);
    } finally {
      (Sale as unknown as { create: unknown }).create = original;
    }
    expect(failed.status).toBe(500);
    expect(failed.body.error.message).toBe('Something went wrong. The operation was not completed.');
    expect(JSON.stringify(failed.body)).not.toMatch(/Simulated|stack|\.ts/);
    expect(await snap()).toEqual(before);
    expect(expectOk(await api.get('/finance/trial-balance')).balanced).toBe(true);

    const retry = expectOk(await sell(body, idem), 201);
    expect(retry.replayed).toBe(false);
    expect(expectOk(await sell(body, idem)).replayed).toBe(true);
    expect(await stock(p)).toBe(2);
    expect(await Sale.countDocuments()).toBe(before.sales + 1);
  });
});

describe('Integrity after all scenarios', () => {
  it('every reconciliation check passes', async () => {
    const rec = expectOk(await api.get('/finance/reconciliation'));
    expect(rec.checks.filter((c: { ok: boolean }) => !c.ok)).toEqual([]);
  });
});
