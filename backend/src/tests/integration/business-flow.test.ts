import { beforeAll, describe, expect, it } from 'vitest';
import { expectOk, key, loginAsAdmin, useTestDb, type Api } from '../helpers.js';
import { InventoryBalance, Movement } from '../../modules/inventory/inventory.models.js';
import { Sale } from '../../modules/sales/sales.models.js';
import { JournalEntry } from '../../modules/ledger/ledger.models.js';
import { AuditLog } from '../../modules/system/system.models.js';

/**
 * End-to-end business workflow through the HTTP API with exact financial assertions.
 * Tax is 0% (default). All amounts are cents.
 */
const t = useTestDb();
let api: Api;
const ids: Record<string, string> = {};

const stockOf = async (productId: string) => (await InventoryBalance.findOne({ productId }).lean())?.qtyOnHand ?? 0;

beforeAll(async () => {
  api = await loginAsAdmin(t.app);
});

describe('catalog', () => {
  it('creates products and rejects duplicates and invalid prices', async () => {
    const cat = expectOk(await api.post('/categories', { name: 'Brake Systems' }), 201);
    const brand = expectOk(await api.post('/brands', { name: 'Test Brand' }), 201);
    const base = { categoryId: cat._id, brandId: brand._id };
    ids.A = expectOk(
      await api.post('/products', {
        ...base,
        sku: 'pad-a',
        name: 'Brake Pad A',
        sellingPrice: 1000,
        minimumSellingPrice: 800,
        barcode: '1111222233334',
        oemPartNumbers: ['04465-02220'],
        reorderPoint: 2,
      }),
      201,
    )._id;
    ids.B = expectOk(await api.post('/products', { ...base, sku: 'DISC-B', name: 'Brake Disc B', sellingPrice: 5000, minimumSellingPrice: 4000, warrantyMonths: 12 }), 201)._id;
    expect((await api.post('/products', { ...base, sku: 'PAD-A', name: 'Dup', sellingPrice: 1 })).status).toBe(409);
    expect((await api.post('/products', { sku: 'NEG', name: 'Negative', sellingPrice: -5 })).status).toBe(400);
    expect((await api.post('/products', { sku: 'FLT', name: 'Float price', sellingPrice: 10.5 })).status).toBe(400);
    expect((await api.post('/products', { sku: 'MIN', name: 'Min above price', sellingPrice: 100, minimumSellingPrice: 200 })).status).toBe(422);
  });

  it('searches by SKU, OEM number and barcode; unknown barcode is 404', async () => {
    expect(expectOk(await api.get('/products?search=04465-02220')).items[0].sku).toBe('PAD-A');
    expect(expectOk(await api.get('/products/lookup?code=1111222233334')).sku).toBe('PAD-A');
    expect((await api.get('/products/lookup?code=9999999999')).status).toBe(404);
  });

  it('records price changes in history without touching past data', async () => {
    expectOk(await api.patch(`/products/${ids.B}`, { sellingPrice: 5200, priceChangeReason: 'test' }));
    expectOk(await api.patch(`/products/${ids.B}`, { sellingPrice: 5000, priceChangeReason: 'revert' }));
    const h = expectOk(await api.get(`/products/${ids.B}/history`));
    expect(h.prices).toHaveLength(2);
  });

  it('stores vehicle compatibility with its source', async () => {
    const v = expectOk(await api.post('/vehicles', { make: 'Toyota', model: 'Corolla', yearFrom: 2014, yearTo: 2018, engineSize: '1.8L' }), 201);
    expectOk(await api.post('/compatibility', { productId: ids.A, vehicleId: v._id, source: 'MANUFACTURER_CATALOG', verified: true }), 201);
    const fit = expectOk(await api.get('/vehicles/parts?make=Toyota&year=2016'));
    expect(fit.items.map((p: { sku: string }) => p.sku)).toEqual(['PAD-A']);
    expect(expectOk(await api.get('/vehicles/parts?make=Toyota&year=2020')).items).toHaveLength(0);
  });
});

describe('purchasing with landed cost and partial receipts', () => {
  it('allocates freight by value and receives partially, then fully', async () => {
    ids.S = expectOk(await api.post('/suppliers', { name: 'Test Supplier', paymentTermsDays: 30 }), 201)._id;
    const p = expectOk(
      await api.post('/purchases', {
        supplierId: ids.S,
        supplierInvoiceNo: 'SUP-1',
        purchaseDate: new Date().toISOString(),
        freightCost: 1000,
        allocationMethod: 'VALUE',
        submit: true,
        items: [
          { productId: ids.A, qtyOrdered: 10, unitPrice: 400 },
          { productId: ids.B, qtyOrdered: 2, unitPrice: 3000 },
        ],
      }),
      201,
    );
    ids.P1 = p._id;
    expect(p.total).toBe(11_000);
    const [la, lb] = p.items;
    expect(la.landedCost).toBe(4400);
    expect(lb.landedCost).toBe(6600);

    const r1 = expectOk(await api.post(`/purchases/${p._id}/receive`, { lines: [{ itemId: la._id, qty: 4 }] }, { 'Idempotency-Key': 'recv-1-aaaaaaaa' }), 201);
    expect(r1.purchase.status).toBe('PARTIALLY_RECEIVED');
    expect(r1.receipt.totalCost).toBe(1760);
    // retry of the same receipt must not double the stock
    const replay = expectOk(await api.post(`/purchases/${p._id}/receive`, { lines: [{ itemId: la._id, qty: 4 }] }, { 'Idempotency-Key': 'recv-1-aaaaaaaa' }));
    expect(replay.replayed).toBe(true);
    expect(await stockOf(ids.A)).toBe(4);

    expect((await api.post(`/purchases/${p._id}/receive`, { lines: [{ itemId: la._id, qty: 7 }] })).status).toBe(422);
    const r2 = expectOk(
      await api.post(`/purchases/${p._id}/receive`, {
        lines: [
          { itemId: la._id, qty: 6 },
          { itemId: lb._id, qty: 2 },
        ],
      }),
      201,
    );
    expect(r2.receipt.totalCost).toBe(2640 + 6600);
    expect(r2.purchase.status).toBe('RECEIVED');
    expectOk(await api.post(`/purchases/${p._id}/post`));
    expect((await api.post(`/purchases/${p._id}/post`)).status).toBe(409);

    const p2 = expectOk(await api.post('/purchases', { supplierId: ids.S, purchaseDate: new Date().toISOString(), submit: true, items: [{ productId: ids.A, qtyOrdered: 5, unitPrice: 500 }] }), 201);
    expectOk(await api.post(`/purchases/${p2._id}/receive`, { lines: [{ itemId: p2.items[0]._id, qty: 5 }] }), 201);
    expect(await stockOf(ids.A)).toBe(15);
    const val = expectOk(await api.get('/inventory/valuation'));
    expect(val.totalValue).toBe(4400 + 6600 + 2500);
  });

  it('cancels only purchases without receipts', async () => {
    const p = expectOk(await api.post('/purchases', { supplierId: ids.S, purchaseDate: new Date().toISOString(), items: [{ productId: ids.A, qtyOrdered: 1, unitPrice: 1 }] }), 201);
    expect(p.status).toBe('DRAFT');
    expect(expectOk(await api.post(`/purchases/${p._id}/cancel`, { reason: 'not needed' })).status).toBe('CANCELLED');
    expect((await api.post(`/purchases/${ids.P1}/cancel`, { reason: 'too late' })).status).toBe(422);
  });

  it('pays the supplier and refuses overpayment', async () => {
    expectOk(await api.post(`/purchases/${ids.P1}/payments`, { amount: 5000, method: 'BANK_TRANSFER' }), 201);
    expect((await api.post(`/purchases/${ids.P1}/payments`, { amount: 6001, method: 'CASH' })).status).toBe(422);
    const sup = expectOk(await api.get(`/suppliers/${ids.S}`));
    expect(sup.payable).toBe(11_000 + 2500 - 5000);
  });
});

describe('POS checkout', () => {
  it('sells across FIFO layers with exact COGS', async () => {
    const out = expectOk(await api.post('/sales', { items: [{ productId: ids.A, qty: 12 }], payments: [{ method: 'CASH', amount: 12_000 }] }, { 'Idempotency-Key': 'sale-fifo-0001' }), 201);
    ids.SALE1 = out.sale._id;
    expect(out.sale.total).toBe(12_000);
    expect(out.sale.cogsTotal).toBe(1760 + 2640 + 1000);
    expect(out.sale.grossProfit).toBe(12_000 - 5400);
    expect(out.sale.paymentStatus).toBe('PAID');
    expect(out.sale.items[0].allocations).toHaveLength(3);
    expect(await stockOf(ids.A)).toBe(3);
  });

  it('is idempotent: retrying the same checkout does not duplicate the sale', async () => {
    const again = await api.post('/sales', { items: [{ productId: ids.A, qty: 12 }], payments: [{ method: 'CASH', amount: 12_000 }] }, { 'Idempotency-Key': 'sale-fifo-0001' });
    expect(again.status).toBe(200);
    expect(again.body.data.replayed).toBe(true);
    expect(await Sale.countDocuments()).toBe(1);
    expect(await stockOf(ids.A)).toBe(3);
  });

  it('requires an idempotency key', async () => {
    expect((await api.post('/sales', { items: [{ productId: ids.A, qty: 1 }], payments: [] })).status).toBe(400);
  });

  it('never oversells: two simultaneous sales of the last 3 units', async () => {
    const body = { items: [{ productId: ids.A, qty: 3 }], payments: [{ method: 'CASH', amount: 3000 }] };
    const [r1, r2] = await Promise.all([api.post('/sales', body, { 'Idempotency-Key': key() }), api.post('/sales', body, { 'Idempotency-Key': key() })]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await stockOf(ids.A)).toBe(0);
    const bal = await InventoryBalance.findOne({ productId: ids.A }).lean();
    expect(bal!.qtyAvailable).toBe(0);
  });

  it('rejects selling a product with no stock', async () => {
    const r = await api.post('/sales', { items: [{ productId: ids.A, qty: 1 }], payments: [{ method: 'CASH', amount: 1000 }] }, { 'Idempotency-Key': key() });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/Insufficient stock/);
  });

  it('rolls back completely when one line fails', async () => {
    const before = { b: await stockOf(ids.B), sales: await Sale.countDocuments(), je: await JournalEntry.countDocuments(), mv: await Movement.countDocuments() };
    const r = await api.post(
      '/sales',
      {
        items: [
          { productId: ids.B, qty: 1 },
          { productId: ids.A, qty: 1 },
        ],
        payments: [{ method: 'CASH', amount: 6000 }],
      },
      { 'Idempotency-Key': key() },
    );
    expect(r.status).toBe(409);
    expect(await stockOf(ids.B)).toBe(before.b);
    expect(await Sale.countDocuments()).toBe(before.sales);
    expect(await JournalEntry.countDocuments()).toBe(before.je);
    expect(await Movement.countDocuments()).toBe(before.mv);
  });

  it('enforces minimum price and walk-in full payment', async () => {
    expect((await api.post('/sales', { items: [{ productId: ids.B, qty: 1, discount: 4500 }], payments: [] }, { 'Idempotency-Key': key() })).status).toBe(422);
    expect((await api.post('/sales', { items: [{ productId: ids.B, qty: 1 }], payments: [{ method: 'CASH', amount: 100 }] }, { 'Idempotency-Key': key() })).status).toBe(422);
  });
});

describe('credit sales, payments and returns', () => {
  it('handles a credit sale followed by multiple payments', async () => {
    ids.C = expectOk(await api.post('/customers', { name: 'Garage X', creditLimit: 20_000 }), 201)._id;
    const s = expectOk(await api.post('/sales', { customerId: ids.C, items: [{ productId: ids.B, qty: 2 }], payments: [{ method: 'CASH', amount: 3000 }] }, { 'Idempotency-Key': key() }), 201).sale;
    ids.SALE2 = s._id;
    expect(s.balanceDue).toBe(7000);
    expect(s.paymentStatus).toBe('PARTIAL');
    expect(s.cogsTotal).toBe(6600);

    expectOk(await api.post(`/sales/${s._id}/payments`, { amount: 2000, method: 'MOBILE_MONEY' }), 201);
    let c = expectOk(await api.get(`/customers/${ids.C}`));
    expect(c.receivable).toBe(5000);

    const over = await api.post('/customer-payments', { customerId: ids.C, amount: 6000, method: 'CASH' });
    expect(over.status).toBe(422);
    expectOk(await api.post('/customer-payments', { customerId: ids.C, amount: 6000, method: 'CASH', allowCredit: true }, { 'Idempotency-Key': 'pay-credit-0001' }), 201);
    // retry is safe
    expectOk(await api.post('/customer-payments', { customerId: ids.C, amount: 6000, method: 'CASH', allowCredit: true }, { 'Idempotency-Key': 'pay-credit-0001' }));
    c = expectOk(await api.get(`/customers/${ids.C}`));
    expect(c.receivable).toBe(0);
    expect(c.storeCredit).toBe(1000);
    const sale = expectOk(await api.get(`/sales/${s._id}`));
    expect(sale.paymentStatus).toBe('PAID');
  });

  it('refuses credit beyond the limit', async () => {
    const lowLimit = expectOk(await api.post('/customers', { name: 'Small Credit', creditLimit: 100 }), 201)._id;
    expect((await api.post('/sales', { customerId: lowLimit, items: [{ productId: ids.B, qty: 1 }], payments: [] }, { 'Idempotency-Key': key() })).status).toBe(422);
  });

  it('partial return of a good item restocks at original cost and credits the customer', async () => {
    const sale = expectOk(await api.get(`/sales/${ids.SALE2}`));
    const r = expectOk(
      await api.post(`/sales/${ids.SALE2}/returns`, { reason: 'Wrong fitment', refundMethod: 'STORE_CREDIT', lines: [{ saleItemId: sale.items[0]._id, qty: 1, condition: 'GOOD' }] }),
      201,
    ).ret;
    expect(r.totalAmount).toBe(5000);
    expect(r.refundAmount).toBe(5000);
    expect(r.lines[0].cost).toBe(3300);
    expect(await stockOf(ids.B)).toBe(1);
    const c = expectOk(await api.get(`/customers/${ids.C}`));
    expect(c.storeCredit).toBe(6000);
    expect((await api.post(`/sales/${ids.SALE2}/returns`, { reason: 'too many', lines: [{ saleItemId: sale.items[0]._id, qty: 2, condition: 'GOOD' }] })).status).toBe(422);
  });

  it('damaged returns never increase sellable stock; returns after batch exhaustion create a new layer', async () => {
    const sale = expectOk(await api.get(`/sales/${ids.SALE1}`));
    const itemId = sale.items[0]._id;
    const dmg = expectOk(await api.post(`/sales/${ids.SALE1}/returns`, { reason: 'Cracked', refundMethod: 'CASH', lines: [{ saleItemId: itemId, qty: 2, condition: 'DAMAGED' }] }), 201).ret;
    expect(dmg.totalAmount).toBe(2000);
    expect(dmg.lines[0].cost).toBe(900);
    expect(await stockOf(ids.A)).toBe(0);

    const good = expectOk(await api.post(`/sales/${ids.SALE1}/returns`, { reason: 'Unused', refundMethod: 'CASH', lines: [{ saleItemId: itemId, qty: 1, condition: 'GOOD' }] }), 201).ret;
    expect(good.lines[0].cost).toBe(450);
    expect(await stockOf(ids.A)).toBe(1);

    const pending = expectOk(
      await api.post(`/sales/${ids.SALE1}/returns`, { reason: 'Check', refundMethod: 'CASH', lines: [{ saleItemId: itemId, qty: 1, condition: 'PENDING_INSPECTION' }] }),
      201,
    ).ret;
    expect(await stockOf(ids.A)).toBe(1);
    expectOk(await api.post(`/returns/${pending._id}/inspect`, { saleItemId: itemId, decision: 'RESTOCK' }));
    expect(await stockOf(ids.A)).toBe(2);
    expect((await api.post(`/returns/${pending._id}/inspect`, { saleItemId: itemId, decision: 'RESTOCK' })).status).toBe(409);
    const s1 = expectOk(await api.get(`/sales/${ids.SALE1}`));
    expect(s1.status).toBe('PARTIALLY_RETURNED');
    expect(s1.refundedAmount).toBe(4000);
  });
});

describe('inventory adjustments', () => {
  it('rejects adjustments without reason or that would go negative', async () => {
    expect((await api.post('/inventory/adjustments', { productId: ids.A, qtyChange: -1, reason: 'DAMAGE', notes: '' })).status).toBe(400);
    expect((await api.post('/inventory/adjustments', { productId: ids.A, qtyChange: -10, reason: 'THEFT_OR_LOSS', notes: 'missing', approve: true })).status).toBe(422);
    expect(await stockOf(ids.A)).toBe(2);
    expect((await api.post('/inventory/adjustments', { productId: ids.A, qtyChange: 1, reason: 'FOUND', notes: 'no cost' })).status).toBe(422);
  });

  it('pending adjustment changes nothing until approved', async () => {
    const adj = expectOk(await api.post('/inventory/adjustments', { productId: ids.A, qtyChange: 1, reason: 'FOUND', notes: 'found in back room', unitCost: 450 }), 201);
    expect(adj.status).toBe('PENDING');
    expect(await stockOf(ids.A)).toBe(2);
    expectOk(await api.post(`/inventory/adjustments/${adj._id}/reject`, { reason: 'duplicate count' }));
    expect(await stockOf(ids.A)).toBe(2);
  });
});

describe('expenses and financial statements', () => {
  it('records and voids expenses with reversals', async () => {
    const cats = expectOk(await api.get('/expense-categories'));
    const rent = cats.find((c: { name: string }) => c.name === 'Shop Rent');
    const drawing = cats.find((c: { name: string }) => c.name === 'Owner Withdrawal');
    expectOk(await api.post('/expenses', { categoryId: rent._id, description: 'Rent', amount: 1500, date: new Date().toISOString(), method: 'CASH' }), 201);
    expectOk(await api.post('/expenses', { categoryId: drawing._id, description: 'Owner draw', amount: 700, date: new Date().toISOString(), method: 'CASH' }), 201);
    const wrong = expectOk(await api.post('/expenses', { categoryId: rent._id, description: 'Typo', amount: 99_999, date: new Date().toISOString(), method: 'CASH' }), 201);
    expect((await api.patch(`/expenses/${wrong._id}`, { amount: 1 })).body.data.amount).toBe(99_999); // amount is not editable
    expectOk(await api.post(`/expenses/${wrong._id}/void`, { reason: 'typo' }));
    expect((await api.post(`/expenses/${wrong._id}/void`, { reason: 'again' })).status).toBe(409);
  });

  it('produces an exact P&L from posted transactions', async () => {
    const pl = expectOk(await api.get('/reports/profit-loss?period=all'));
    expect(pl.grossSales).toBe(12_000 + 3000 + 10_000);
    expect(pl.returns).toBe(5000 + 2000 + 1000 + 1000);
    expect(pl.netSales).toBe(16_000);
    expect(pl.cogs).toBe(5400 + 1500 + 6600 - (3300 + 900 + 450 + 450));
    expect(pl.grossProfit).toBe(7600);
    expect(pl.inventoryLoss).toBe(900);
    expect(pl.operatingExpenses).toBe(1500); // drawing excluded, voided expense reversed
    expect(pl.netProfit).toBe(7600 - 1500 - 900);
  });

  it('inventory value equals the FIFO layers and the ledger', async () => {
    const val = expectOk(await api.get('/inventory/valuation'));
    expect(val.totalValue).toBe(450 + 450 + 3300);
  });

  it('all reconciliation checks pass and the books balance', async () => {
    const rec = expectOk(await api.get('/finance/reconciliation'));
    const failed = rec.checks.filter((c: { ok: boolean }) => !c.ok);
    expect(failed).toEqual([]);
    const tb = expectOk(await api.get('/finance/trial-balance'));
    expect(tb.balanced).toBe(true);
    const bs = expectOk(await api.get('/finance/balance-sheet'));
    expect(bs.balanced).toBe(true);
    const dash = expectOk(await api.get('/dashboard/overview?period=all'));
    expect(dash.revenue).toBe(16_000);
    expect(dash.netProfit).toBe(5200);
    expect(dash.inventoryValue).toBe(4200);
    expect(dash.receivables).toBe(0);
  });

  it('journal entries are immutable', async () => {
    await expect(JournalEntry.updateOne({}, { $set: { memo: 'hack' } })).rejects.toThrow(/immutable/);
    await expect(Movement.updateOne({}, { $set: { qty: 1000 } })).rejects.toThrow(/immutable/);
  });

  it('exports reports as CSV, XLSX and PDF', async () => {
    const csv = await api.get('/reports/sales?period=all&format=csv&view=product');
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    const xlsx = await api.get('/reports/profit-loss?period=all&format=xlsx');
    expect(xlsx.status).toBe(200);
    const pdf = await api.get(`/sales/${ids.SALE1}/invoice?format=thermal`).buffer(true);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });

  it('audits sensitive actions', async () => {
    for (const action of ['sale.create', 'purchase.receive', 'sale.return', 'expense.void', 'product.update']) {
      expect(await AuditLog.exists({ action })).toBeTruthy();
    }
  });
});
