import { expect, test, type Page } from '@playwright/test';
import { login } from './fixtures';

/**
 * The 25-step owner workflow from the test plan, driven through the real UI against the
 * isolated E2E stack. Monetary expectations follow business scenarios A–D and G
 * (oil filter bought at $5, sold at $8; no tax, discounts or landed costs).
 */
test.describe.configure({ mode: 'serial' });

const SKU = 'E2E-OF-001';
const SUPPLIER = 'E2E Filters Supplier';
const CUSTOMER = 'E2E Credit Garage';
let page: Page;
let creditSaleUrl = '';

const apiGet = async (path: string) => {
  const r = await page.request.get(`/api/v1${path}`);
  expect(r.status(), `GET ${path}`).toBe(200);
  return (await r.json()).data;
};
const pl = () => apiGet('/reports/profit-loss?period=all');
const stat = (label: string) => page.getByRole('group', { name: label, exact: true });
const product = async () => (await apiGet(`/products?search=${SKU}`)).items[0];

async function pick(scope: ReturnType<Page['getByRole']> | Page, placeholder: string | RegExp, query: string, option: string | RegExp) {
  const box = scope.getByPlaceholder(placeholder);
  await box.fill(query);
  await page.getByRole('option', { name: option }).first().click();
}

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage();
});
test.afterAll(async () => {
  await page.close();
});

test('1. login as administrator', async () => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('2. create a supplier', async () => {
  await page.goto('/suppliers');
  await page.getByRole('button', { name: 'New supplier' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(SUPPLIER);
  await dlg.getByLabel('Phone').fill('+252 61 000 0000');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: SUPPLIER })).toBeVisible();
});

test('3. create a product', async () => {
  await page.goto('/products/new');
  await page.getByLabel('SKU').fill(SKU);
  await page.getByLabel('Product name').fill('E2E Oil Filter');
  await page.getByLabel('Manufacturer part number').fill('E2E-15208');
  await page.getByRole('textbox', { name: 'Selling price', exact: true }).fill('8.00');
  await page.getByLabel('Minimum selling price').fill('6.00');
  await page.getByLabel('Reorder point').fill('10');
  await page.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByRole('heading', { name: 'E2E Oil Filter' })).toBeVisible();
  // Duplicate SKU is rejected by the server.
  const dup = await page.request.post('/api/v1/products', { data: { sku: SKU.toLowerCase(), name: 'dup', sellingPrice: 100 }, headers: { 'X-CSRF-Token': await csrf() } });
  expect(dup.status()).toBe(409);
});

async function csrf() {
  const r = await page.request.get('/api/v1/auth/me');
  return (await r.json()).data.csrfToken as string;
}

test('4. register product compatibility', async () => {
  await page.goto('/vehicles');
  await page.getByRole('button', { name: 'Register vehicle' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Make').fill('Nissan');
  await dlg.getByLabel('Model').fill('Sunny E2E');
  await dlg.getByLabel('Year from').fill('2012');
  await dlg.getByLabel('Year to').fill('2019');
  await dlg.getByLabel('Engine size').fill('1.5L');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Sunny E2E').first()).toBeVisible();
  await page
    .getByRole('row', { name: /Sunny E2E/ })
    .getByRole('button', { name: 'Link part' })
    .click();
  const link = page.getByRole('dialog');
  await pick(link as never, 'Search products…', SKU, new RegExp(SKU));
  await link.getByLabel('This fitment has been verified').check();
  await link.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Compatibility recorded')).toBeVisible();
  const fit = await apiGet('/vehicles/parts?make=Nissan&year=2015');
  expect(fit.items.map((p: { sku: string }) => p.sku)).toContain(SKU);
});

test('5–6. create a purchase and receive inventory (Scenario A)', async () => {
  await page.goto('/purchases/new');
  await pick(page, 'Add product by name, SKU or part number…', SKU, new RegExp(SKU));
  await page.getByLabel(`Quantity ${SKU}`).fill('100');
  await page.getByLabel(`Unit price ${SKU}`).fill('5.00');
  await pick(page, 'Search suppliers…', 'E2E Filters', new RegExp(SUPPLIER));
  await page.getByLabel('Supplier invoice number').fill('E2E-INV-1');
  await page.getByRole('button', { name: 'Place order' }).click();
  await expect(page.getByRole('heading', { name: /Purchase PO-/ })).toBeVisible();
  await page.getByRole('button', { name: 'Receive goods' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm receipt' }).click();
  await expect(page.getByText(/Received GRN-/)).toBeVisible();
  await expect(stat('Outstanding (payable)')).toContainText('$500.00');
  await expect(stat('Received value')).toContainText('$500.00');
});

test('7. check stock: 100 units, FIFO value $500', async () => {
  const p = await product();
  expect(p.qtyOnHand).toBe(100);
  await page.goto(`/products/${p._id}`);
  await expect(stat('On hand')).toContainText('100');
  await expect(stat('Inventory value (FIFO)')).toContainText('$500.00');
  const val = await apiGet('/inventory/valuation');
  expect(val.totalValue).toBe(50_000);
});

let invoiceHref = '';
test('8–10. POS: sell 30 units for cash (Scenario B)', async () => {
  await page.goto('/pos');
  await page.getByLabel('Search products').fill(SKU);
  await page.getByRole('button', { name: /E2E Oil Filter/ }).click();
  await page.getByLabel(`Quantity ${SKU}`).fill('30');
  await expect(page.getByTestId('pos-total')).toHaveText('$240.00');
  await page.getByRole('button', { name: 'Exact amount' }).click();
  await expect(page.getByTestId('pos-balance')).toHaveText('Fully paid');
  await page.getByRole('button', { name: /Complete sale/ }).click();
  const dlg = page.getByRole('dialog', { name: 'Sale completed' });
  await expect(dlg).toBeVisible();
  await expect(dlg.getByText('$240.00').first()).toBeVisible();
  invoiceHref = (await dlg.getByRole('link', { name: 'A4 invoice' }).getAttribute('href')) ?? '';
  expect(invoiceHref).toMatch(/\/invoice\?format=a4/);
});

test('11–12. generate the invoice and print the receipt (PDF)', async () => {
  const a4 = await page.request.get(invoiceHref);
  expect(a4.status()).toBe(200);
  expect(a4.headers()['content-type']).toBe('application/pdf');
  const receipt = await page.request.get(invoiceHref.replace('a4', 'thermal'));
  expect(receipt.headers()['content-type']).toBe('application/pdf');
  expect((await receipt.body()).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('dialog').getByRole('button', { name: 'New sale' }).click();
});

test('13–16. verify reduced stock, revenue, COGS and gross profit', async () => {
  const p = await product();
  expect(p.qtyOnHand).toBe(70);
  expect((await apiGet('/inventory/valuation')).totalValue).toBe(35_000);
  const r = await pl();
  expect(r.netSales).toBe(24_000);
  expect(r.cogs).toBe(15_000);
  expect(r.grossProfit).toBe(9_000);
  await page.goto('/finance/profit-loss');
  await page.getByLabel('Reporting period').selectOption('all');
  await expect(page.getByText('$240.00').first()).toBeVisible(); // net sales
  await expect(page.getByText('$90.00').first()).toBeVisible(); // gross profit
});

test('17–18. add an operating expense and verify net profit (Scenario C)', async () => {
  await page.goto('/expenses');
  await page.getByRole('button', { name: 'Record expense' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Expense category').selectOption({ label: 'Shop Rent' });
  await dlg.getByLabel('Description').fill('E2E rent');
  await dlg.getByLabel('Expense amount').fill('20.00');
  await dlg.getByRole('button', { name: 'Save expense' }).click();
  await expect(page.getByText(/Expense EXP-\d+ recorded/)).toBeVisible();
  const r = await pl();
  expect(r.grossProfit).toBe(9_000);
  expect(r.operatingProfit).toBe(7_000);
  expect(r.netProfit).toBe(7_000);
});

test('19. register a credit sale of $200 (Scenario D)', async () => {
  await page.goto('/customers');
  await page.getByRole('button', { name: 'New customer' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(CUSTOMER);
  await dlg.getByLabel('Credit limit').fill('1000.00');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: CUSTOMER })).toBeVisible();

  await page.goto('/pos');
  await pick(page, 'Walk-in customer — search to select…', 'E2E Credit', new RegExp(CUSTOMER));
  await page.getByLabel('Search products').fill(SKU);
  await page.getByRole('button', { name: /E2E Oil Filter/ }).click();
  await page.getByLabel(`Quantity ${SKU}`).fill('25');
  await expect(page.getByTestId('pos-total')).toHaveText('$200.00');
  await expect(page.getByTestId('pos-balance')).toContainText('credit sale');
  await page.getByRole('button', { name: /Complete sale/ }).click();
  const done = page.getByRole('dialog', { name: 'Sale completed' });
  await expect(done.getByText('Balance due').locator('..').getByText('$200.00')).toBeVisible();
  await done.getByRole('link', { name: 'View sale' }).click();
  await expect(page).toHaveURL(/\/sales\/[a-f0-9]{24}/);
  creditSaleUrl = page.url();
});

test('20–21. receive a partial payment of $80 and verify remaining debt $120', async () => {
  await page.getByRole('button', { name: 'Receive payment' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Amount').fill('80.00');
  await dlg.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText('Payment recorded')).toBeVisible();
  await expect(stat('Balance due')).toContainText('$120.00');
  const c = (await apiGet(`/customers?search=${encodeURIComponent(CUSTOMER)}`)).items[0];
  expect(c.receivable).toBe(12_000);
  const stmt = await apiGet(`/customers/${c._id}/statement?period=all`);
  expect(stmt.closing).toBe(12_000);
  expect(stmt.rows.map((r: { type: string }) => r.type)).toEqual(['SALE', 'CUSTOMER_PAYMENT']);
});

test('22–23. process a partial return and verify stock and accounting corrections (Scenario G)', async () => {
  await page.goto(creditSaleUrl);
  await page.getByRole('button', { name: 'Return items' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel(`Return qty ${SKU}`).fill('2');
  await dlg.getByLabel(`Condition ${SKU}`).selectOption('GOOD');
  await dlg.getByLabel('Reason').fill('E2E wrong fitment');
  await dlg.getByRole('button', { name: 'Process return' }).click();
  await expect(page.getByText(/Return RET-\d+ recorded/)).toBeVisible();

  expect((await product()).qtyOnHand).toBe(47); // 100 − 30 − 25 + 2
  const r = await pl();
  expect(r.returns).toBe(1_600); // 2 × $8 at the original invoice price
  expect(r.netSales).toBe(24_000 + 20_000 - 1_600);
  expect(r.cogs).toBe(15_000 + 12_500 - 1_000); // returned at original FIFO cost
  const c = (await apiGet(`/customers?search=${encodeURIComponent(CUSTOMER)}`)).items[0];
  expect(c.receivable).toBe(12_000 - 1_600);
  // Over-return is refused by the server.
  const sale = await apiGet(`/sales/${creditSaleUrl.split('/').pop()}`);
  const over = await page.request.post(`/api/v1/sales/${sale._id}/returns`, {
    data: { reason: 'too many', lines: [{ saleItemId: sale.items[0]._id, qty: 24, condition: 'GOOD' }] },
    headers: { 'X-CSRF-Token': await csrf() },
  });
  expect(over.status()).toBe(422);

  const rec = await apiGet('/finance/reconciliation');
  expect(rec.checks.filter((x: { ok: boolean }) => !x.ok)).toEqual([]);
  await page.goto('/finance');
  await expect(page.getByText('Assets = Liabilities + Equity ✓')).toBeVisible();
});

test('24. export a financial report', async () => {
  await page.goto('/finance/profit-loss');
  await page.getByRole('button', { name: 'Export' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: 'CSV' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const xlsx = await page.request.get('/api/v1/reports/profit-loss?period=all&format=xlsx');
  expect(xlsx.status()).toBe(200);
  expect(xlsx.headers()['content-type']).toContain('spreadsheetml');
});

test('25. logout and verify the session is invalidated', async () => {
  const cookies = await page.context().cookies();
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
  expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
  // Re-using the old session cookie must not work either.
  const ctx = await page.context().browser()!.newContext();
  await ctx.addCookies(cookies);
  const replay = await ctx.request.get(`${new URL(page.url()).origin}/api/v1/auth/me`);
  expect(replay.status()).toBe(401);
  await ctx.close();
  await page.goto('/sales');
  await expect(page).toHaveURL(/\/login/);
});
