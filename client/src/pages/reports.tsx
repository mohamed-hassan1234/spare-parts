import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Bot, Lightbulb, Sparkles, TrendingUp } from 'lucide-react';
import { post } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { cn, date, money, num, pct, titleCase } from '@/lib/format';
import { DataTable, EmptyState, ErrorState, ExportMenu, LoadingBlock, PageHeader, PeriodFilter, periodQuery, SearchInput, StatCard, type Column, type PeriodValue } from '@/components/common';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Select, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { MoneyAreaChart, MoneyBarChart, MoneyPieChart } from '@/components/charts';
import { ProfitLossStatement } from './finance';
import { methodLabel } from './purchases';

/** Client-side sort + search over a report table (the server computed every number). */
function useTable<T>(rows: T[] | undefined, searchKeys: (keyof T)[], initialSort?: string) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState(initialSort);
  let out = rows ?? [];
  if (search) {
    const s = search.toLowerCase();
    out = out.filter((r) =>
      searchKeys.some((k) =>
        String(r[k] ?? '')
          .toLowerCase()
          .includes(s),
      ),
    );
  }
  if (sort) {
    const desc = sort.startsWith('-');
    const k = sort.replace(/^-/, '') as keyof T;
    out = [...out].sort((a, b) => {
      const x = a[k] as unknown as number | string;
      const y = b[k] as unknown as number | string;
      return (x > y ? 1 : x < y ? -1 : 0) * (desc ? -1 : 1);
    });
  }
  return { rows: out, search, setSearch, sort, setSort };
}

function ReportTable({
  title,
  rows,
  columns,
  searchKeys,
  initialSort,
  exportPath,
  exportQuery,
}: {
  title: string;
  rows?: any[];
  columns: Column<any>[];
  searchKeys: string[];
  initialSort?: string;
  exportPath?: string;
  exportQuery?: Record<string, string | undefined>;
}) {
  const t = useTable<any>(rows, searchKeys, initialSort);
  return (
    <Card>
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>{title}</CardTitle>
        <div className="flex gap-2">
          <SearchInput value={t.search} onChange={t.setSearch} placeholder="Filter rows…" className="sm:w-56" />
          {exportPath && <ExportMenu path={exportPath} query={exportQuery} />}
        </div>
      </div>
      <DataTable
        rows={t.rows as any}
        columns={columns as any}
        sort={t.sort}
        onSort={t.setSort}
        rowKey={(r: any, i) => String(r.id ?? r._id ?? r.productId ?? r.supplierId ?? r.method ?? r.category ?? i)}
        empty={<EmptyState title="No data for this period" />}
      />
    </Card>
  );
}

/* =============================== Sales =============================== */
export function SalesReportsPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: 'thisMonth' });
  const [unit, setUnit] = useState('day');
  const q = periodQuery(period);
  const r = useApi('/reports/sales', { ...q, unit });
  const d = r.data;
  const profitCols: Column<any>[] = [
    { key: 'n', header: 'Name', sort: 'name', cell: (x) => x.name },
    { key: 'q', header: 'Qty', sort: 'qty', align: 'right', cell: (x) => num(x.qty) },
    { key: 's', header: 'Net sales', sort: 'netSales', align: 'right', cell: (x) => money(x.netSales) },
    { key: 'c', header: 'COGS', sort: 'cogs', align: 'right', cell: (x) => money(x.cogs) },
    { key: 'g', header: 'Gross profit', sort: 'grossProfit', align: 'right', cell: (x) => <strong>{money(x.grossProfit)}</strong> },
    { key: 'm', header: 'Margin', sort: 'marginPct', align: 'right', cell: (x) => pct(x.marginPct) },
  ];
  return (
    <div>
      <PageHeader
        title="Sales reports"
        description={d ? `${d.period.label} · ${date(d.period.from)} – ${date(new Date(new Date(d.period.to).getTime() - 1))}` : undefined}
        actions={
          <>
            <PeriodFilter value={period} onChange={setPeriod} />
            <Select aria-label="Group by" className="w-32" value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="day">Daily</option>
              <option value="week">Weekly</option>
              <option value="month">Monthly</option>
              <option value="year">Annual</option>
            </Select>
          </>
        }
      />
      {r.isLoading ? (
        <LoadingBlock />
      ) : r.error ? (
        <ErrorState error={r.error} retry={r.refetch} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard label="Net sales" value={money(d.summary.netSales)} hint={`${d.summary.invoices} invoices`} />
            <StatCard label="Average sale" value={money(d.summary.averageSale)} />
            <StatCard label="COGS" value={money(d.summary.cogs)} />
            <StatCard label="Gross profit" value={money(d.summary.grossProfit)} hint={`${pct(d.summary.grossMarginPct)} margin`} tone="success" />
            <StatCard label="Returns & discounts" value={money(d.summary.returns + d.summary.discounts)} hint={`${d.summary.returnCount} returns`} tone="warning" />
            <StatCard label="Unpaid on these invoices" value={money(d.summary.outstanding)} tone={d.summary.outstanding ? 'warning' : 'default'} />
          </div>
          <Card className="mb-4">
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>{titleCase(unit === 'day' ? 'daily' : unit === 'year' ? 'annual' : `${unit}ly`)} sales</CardTitle>
                <CardDescription>Net sales and gross profit</CardDescription>
              </div>
              <ExportMenu path="/reports/sales" query={{ ...q, unit, view: 'series' } as any} />
            </CardHeader>
            <CardContent>
              <MoneyAreaChart
                data={d.series}
                series={[
                  { key: 'netSales', label: 'Net sales' },
                  { key: 'grossProfit', label: 'Gross profit' },
                ]}
              />
            </CardContent>
          </Card>
          <Tabs defaultValue="product">
            <TabsList>
              <TabsTrigger value="product">Product profitability</TabsTrigger>
              <TabsTrigger value="category">Category profitability</TabsTrigger>
              <TabsTrigger value="customer">Customers</TabsTrigger>
              <TabsTrigger value="method">Payment methods</TabsTrigger>
            </TabsList>
            <TabsContent value="product">
              <ReportTable
                title="By product"
                rows={d.byProduct}
                columns={profitCols}
                searchKeys={['name']}
                initialSort="-netSales"
                exportPath="/reports/sales"
                exportQuery={{ ...q, view: 'product' } as any}
              />
            </TabsContent>
            <TabsContent value="category">
              <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
                <ReportTable
                  title="By category"
                  rows={d.byCategory}
                  columns={profitCols.filter((c) => c.key !== 'q')}
                  searchKeys={['name']}
                  initialSort="-netSales"
                  exportPath="/reports/sales"
                  exportQuery={{ ...q, view: 'category' } as any}
                />
                <Card>
                  <CardContent className="pt-5">
                    <MoneyPieChart data={d.byCategory} nameKey="name" valueKey="netSales" />
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
            <TabsContent value="customer">
              <ReportTable
                title="Customer purchasing"
                rows={d.byCustomer}
                searchKeys={['customer']}
                initialSort="-total"
                exportPath="/reports/sales"
                exportQuery={{ ...q, view: 'customer' } as any}
                columns={[
                  {
                    key: 'c',
                    header: 'Customer',
                    sort: 'customer',
                    cell: (x) =>
                      x._id ? (
                        <Link className="text-primary hover:underline" to={`/customers/${x._id}`}>
                          {x.customer}
                        </Link>
                      ) : (
                        (x.customer ?? 'Walk-in customers')
                      ),
                  },
                  { key: 'i', header: 'Invoices', sort: 'invoices', align: 'right', cell: (x) => x.invoices },
                  { key: 't', header: 'Total', sort: 'total', align: 'right', cell: (x) => money(x.total) },
                  { key: 'b', header: 'Unpaid', sort: 'balanceDue', align: 'right', cell: (x) => money(x.balanceDue) },
                ]}
              />
            </TabsContent>
            <TabsContent value="method">
              <ReportTable
                title="Payments received by method"
                rows={d.byPaymentMethod}
                searchKeys={['method']}
                exportPath="/reports/sales"
                exportQuery={{ ...q, view: 'method' } as any}
                columns={[
                  { key: 'm', header: 'Method', cell: (x) => methodLabel(x.method) },
                  { key: 'c', header: 'Payments', align: 'right', sort: 'count', cell: (x) => x.count },
                  { key: 'a', header: 'Amount', align: 'right', sort: 'amount', cell: (x) => money(x.amount) },
                ]}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

/* ============================== Purchases ============================== */
export function PurchaseReportsPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: 'thisYear' });
  const q = periodQuery(period);
  const r = useApi('/reports/purchases', { ...q, unit: 'month' });
  const d = r.data;
  return (
    <div>
      <PageHeader
        title="Purchase reports"
        description="Goods received at landed cost, supplier performance and cost trends."
        actions={
          <>
            <PeriodFilter value={period} onChange={setPeriod} />
            <ExportMenu path="/reports/purchases" query={q} />
          </>
        }
      />
      {r.isLoading ? (
        <LoadingBlock />
      ) : r.error ? (
        <ErrorState error={r.error} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <StatCard label="Received (landed cost)" value={money(d.totalReceived)} />
            <StatCard label="Paid to suppliers" value={money(d.totalPaid)} />
            <StatCard label="Outstanding payables" value={money(d.outstanding)} tone="warning" to="/finance/payables" />
          </div>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Purchases by month</CardTitle>
              </CardHeader>
              <CardContent>
                <MoneyBarChart data={d.costTrend} series={[{ key: 'amount', label: 'Received' }]} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Top suppliers</CardTitle>
              </CardHeader>
              <CardContent>
                <MoneyBarChart layout="vertical" xKey="supplier" data={d.bySupplier.slice(0, 8)} series={[{ key: 'amount', label: 'Received' }]} />
              </CardContent>
            </Card>
          </div>
          <div className="grid gap-4">
            <ReportTable
              title="Supplier performance"
              rows={d.bySupplier}
              searchKeys={['supplier']}
              initialSort="-amount"
              columns={[
                {
                  key: 's',
                  header: 'Supplier',
                  sort: 'supplier',
                  cell: (x) => (
                    <Link className="text-primary hover:underline" to={`/suppliers/${x.supplierId}`}>
                      {x.supplier}
                    </Link>
                  ),
                },
                { key: 'r', header: 'Receipts', sort: 'receipts', align: 'right', cell: (x) => x.receipts },
                { key: 'a', header: 'Received value', sort: 'amount', align: 'right', cell: (x) => money(x.amount) },
              ]}
            />
            <ReportTable
              title="Purchase history by product"
              rows={d.byProduct}
              searchKeys={['product']}
              initialSort="-cost"
              columns={[
                {
                  key: 'p',
                  header: 'Product',
                  sort: 'product',
                  cell: (x) => (
                    <Link className="text-primary hover:underline" to={`/products/${x.productId}`}>
                      {x.product}
                    </Link>
                  ),
                },
                { key: 'q', header: 'Qty', sort: 'qty', align: 'right', cell: (x) => num(x.qty) },
                { key: 'c', header: 'Landed cost', sort: 'cost', align: 'right', cell: (x) => money(x.cost) },
                { key: 'u', header: 'Avg unit cost', sort: 'avgUnitCost', align: 'right', cell: (x) => money(x.avgUnitCost) },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}

/* ============================== Inventory ============================== */
export function InventoryReportsPage() {
  const r = useApi('/reports/inventory');
  const d = r.data;
  const rowCols: Column<any>[] = [
    {
      key: 's',
      header: 'SKU',
      sort: 'sku',
      cell: (x) => (
        <Link className="text-primary hover:underline" to={`/products/${x.productId}`}>
          {x.sku}
        </Link>
      ),
    },
    { key: 'n', header: 'Product', sort: 'name', cell: (x) => x.name },
    { key: 'c', header: 'Category', sort: 'category', cell: (x) => x.category },
    { key: 'o', header: 'On hand', sort: 'onHand', align: 'right', cell: (x) => num(x.onHand) },
    { key: 'u', header: 'Avg cost', sort: 'avgUnitCost', align: 'right', cell: (x) => money(x.avgUnitCost) },
    { key: 'v', header: 'Value', sort: 'value', align: 'right', cell: (x) => money(x.value) },
    { key: 'a', header: 'Oldest (days)', sort: 'oldestStockDays', align: 'right', cell: (x) => x.oldestStockDays ?? '—' },
    { key: 'l', header: 'Last sale (days)', sort: 'daysSinceLastSale', align: 'right', cell: (x) => x.daysSinceLastSale ?? 'Never' },
    { key: 'q', header: 'Sold 90d', sort: 'sold90', align: 'right', cell: (x) => x.sold90 },
  ];
  return (
    <div>
      <PageHeader title="Inventory reports" description="Valuation from remaining FIFO cost layers, aging, turnover and stock movement speed." actions={<ExportMenu path="/inventory/valuation" />} />
      {r.isLoading ? (
        <LoadingBlock />
      ) : r.error ? (
        <ErrorState error={r.error} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Inventory value" value={money(d.totalValue)} />
            <StatCard label="Units on hand" value={num(d.totalUnits)} />
            <StatCard label="Turnover (12 months)" value={d.turnover === null ? '—' : `${d.turnover}×`} hint="COGS ÷ current inventory value" />
            <StatCard label="Dead stock" value={num(d.deadStock.length)} hint={`No sale in ${d.deadStockDays}+ days`} tone={d.deadStock.length ? 'warning' : 'default'} />
            <StatCard label="Out of stock" value={num(d.outOfStock.length)} tone={d.outOfStock.length ? 'destructive' : 'default'} to="/inventory/low-stock" />
          </div>
          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Inventory aging</CardTitle>
                <CardDescription>Remaining cost by age of the FIFO layer</CardDescription>
              </CardHeader>
              <CardContent>
                <MoneyBarChart
                  data={[
                    { period: '0–30 days', value: d.aging.d0_30 },
                    { period: '31–90 days', value: d.aging.d31_90 },
                    { period: '91–180 days', value: d.aging.d91_180 },
                    { period: '180+ days', value: d.aging.d180_plus },
                  ]}
                  series={[{ key: 'value', label: 'Value' }]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Value by category</CardTitle>
              </CardHeader>
              <CardContent>
                <MoneyPieChart data={d.byCategory} nameKey="category" valueKey="value" />
              </CardContent>
            </Card>
          </div>
          <Tabs defaultValue="valuation">
            <TabsList>
              <TabsTrigger value="valuation">Valuation</TabsTrigger>
              <TabsTrigger value="fast">Fast moving</TabsTrigger>
              <TabsTrigger value="slow">Slow moving</TabsTrigger>
              <TabsTrigger value="dead">Dead stock ({d.deadStock.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="valuation">
              <ReportTable title="Valuation by product" rows={d.rows} columns={rowCols} searchKeys={['sku', 'name', 'category']} initialSort="-value" exportPath="/inventory/valuation" />
            </TabsContent>
            <TabsContent value="fast">
              <ReportTable title="Fast moving (sold in 90 days)" rows={d.fastMoving} columns={rowCols} searchKeys={['sku', 'name']} initialSort="-sold90" />
            </TabsContent>
            <TabsContent value="slow">
              <ReportTable title="Slow moving (lowest 90-day sales with stock)" rows={d.slowMoving} columns={rowCols} searchKeys={['sku', 'name']} initialSort="sold90" />
            </TabsContent>
            <TabsContent value="dead">
              <ReportTable title={`Dead stock (no sale in ${d.deadStockDays}+ days)`} rows={d.deadStock} columns={rowCols} searchKeys={['sku', 'name']} initialSort="-value" />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

/* =========================== Financial reports =========================== */
export function FinancialReportsPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: 'thisMonth' });
  const q = periodQuery(period);
  const pl = useApi('/reports/profit-loss', q);
  const cf = useApi('/reports/cash-flow', q);
  const tb = useApi('/finance/trial-balance');
  const exp = useApi('/reports/expenses', q);
  const ar = useApi('/reports/receivables');
  const ap = useApi('/reports/payables');
  return (
    <div>
      <PageHeader title="Financial reports" description="Statements generated from the double-entry ledger." actions={<PeriodFilter value={period} onChange={setPeriod} />} />
      <Tabs defaultValue="pl">
        <TabsList>
          <TabsTrigger value="pl">Profit & loss</TabsTrigger>
          <TabsTrigger value="cf">Cash flow</TabsTrigger>
          <TabsTrigger value="tb">Trial balance</TabsTrigger>
          <TabsTrigger value="exp">Expenses</TabsTrigger>
          <TabsTrigger value="debts">Debts</TabsTrigger>
        </TabsList>
        <TabsContent value="pl">
          <div className="mb-3 flex justify-end">
            <ExportMenu path="/reports/profit-loss" query={q} />
          </div>
          {pl.data ? <ProfitLossStatement pl={pl.data} /> : pl.error ? <ErrorState error={pl.error} /> : <LoadingBlock />}
        </TabsContent>
        <TabsContent value="cf">
          {cf.data ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
              <Card>
                <div className="flex items-center justify-between border-b p-3">
                  <CardTitle>Cash flow — {cf.data.period.label}</CardTitle>
                  <ExportMenu path="/reports/cash-flow" query={q} />
                </div>
                <CardContent className="pt-4">
                  <div className="flex justify-between border-b py-2 text-sm font-semibold">
                    <span>Opening cash & bank</span>
                    <span className="tabular">{money(cf.data.openingBalance)}</span>
                  </div>
                  {cf.data.lines.map((l: any) => (
                    <div key={l.sourceType} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 border-b border-dashed py-2 text-sm">
                      <span>{l.label}</span>
                      <span className="tabular text-success">{l.inflow ? `+${money(l.inflow)}` : ''}</span>
                      <span className="tabular text-destructive">{l.outflow ? `−${money(l.outflow)}` : ''}</span>
                      <span className={cn('w-28 text-right tabular font-medium', l.net < 0 && 'text-destructive')}>{money(l.net)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-2 text-sm font-semibold">
                    <span>Net change</span>
                    <span className="tabular">{money(cf.data.netChange)}</span>
                  </div>
                  <div className="flex justify-between rounded-md bg-muted px-3 py-2 text-base font-bold">
                    <span>Closing cash & bank</span>
                    <span className="tabular">{money(cf.data.closingBalance)}</span>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Closing balances</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {cf.data.accounts.map((a: any) => (
                    <div key={a.code} className="flex justify-between text-sm">
                      <span>{a.name}</span>
                      <span className="tabular font-medium">{money(a.balance)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : cf.error ? (
            <ErrorState error={cf.error} />
          ) : (
            <LoadingBlock />
          )}
        </TabsContent>
        <TabsContent value="tb">
          <Card>
            <div className="flex items-center justify-between border-b p-3">
              <CardTitle>Trial balance (as of now) {tb.data && (tb.data.balanced ? <Badge variant="success">Balanced</Badge> : <Badge variant="destructive">Out of balance</Badge>)}</CardTitle>
              <ExportMenu path="/reports/trial-balance" />
            </div>
            <DataTable
              rows={tb.data?.rows.filter((r: any) => r.totalDebit || r.totalCredit)}
              rowKey={(r) => r.code}
              loading={tb.isLoading}
              columns={[
                { key: 'c', header: 'Code', cell: (r) => <span className="font-mono">{r.code}</span> },
                { key: 'n', header: 'Account', cell: (r) => r.name },
                { key: 't', header: 'Type', cell: (r) => titleCase(r.type) },
                { key: 'd', header: 'Debit', align: 'right', cell: (r) => (r.debit ? money(r.debit) : '') },
                { key: 'cr', header: 'Credit', align: 'right', cell: (r) => (r.credit ? money(r.credit) : '') },
              ]}
            />
            {tb.data && (
              <div className="flex justify-end gap-10 border-t px-4 py-3 text-sm font-semibold">
                <span>Debits {money(tb.data.totalDebit)}</span>
                <span>Credits {money(tb.data.totalCredit)}</span>
              </div>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="exp">
          {exp.data ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <ReportTable
                title="Expenses by category"
                rows={exp.data.byCategory}
                searchKeys={['category']}
                initialSort="-amount"
                exportPath="/reports/expenses"
                exportQuery={q as any}
                columns={[
                  { key: 'c', header: 'Category', sort: 'category', cell: (x) => x.category },
                  { key: 'k', header: 'Kind', cell: (x) => titleCase(x.kind) },
                  { key: 'n', header: 'Entries', sort: 'count', align: 'right', cell: (x) => x.count },
                  { key: 'a', header: 'Amount', sort: 'amount', align: 'right', cell: (x) => money(x.amount) },
                ]}
              />
              <Card>
                <CardHeader>
                  <CardTitle>By month and kind</CardTitle>
                </CardHeader>
                <CardContent>
                  <MoneyBarChart
                    stacked
                    data={exp.data.byMonth}
                    series={['OPERATING', 'CAPITAL_EXPENDITURE', 'OWNER_DRAWING', 'LOAN_REPAYMENT']
                      .filter((k) => exp.data.byMonth.some((m: any) => m[k]))
                      .map((k) => ({ key: k, label: titleCase(k) }))}
                  />
                </CardContent>
              </Card>
            </div>
          ) : (
            <LoadingBlock />
          )}
        </TabsContent>
        <TabsContent value="debts">
          <div className="grid gap-4 md:grid-cols-2">
            {[
              ['Customer debts (receivable)', ar, '/reports/receivables', '/finance/receivables'],
              ['Supplier debts (payable)', ap, '/reports/payables', '/finance/payables'],
            ].map(([title, d, path, to]: any) => (
              <Card key={path}>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>{title}</CardTitle>
                  <ExportMenu path={path} />
                </CardHeader>
                <CardContent className="grid gap-1 text-sm">
                  {d.data &&
                    (
                      [
                        ['current', 'Not yet due'],
                        ['d1_30', '1–30 days overdue'],
                        ['d31_60', '31–60 days'],
                        ['d61_90', '61–90 days'],
                        ['d90_plus', '90+ days'],
                      ] as const
                    ).map(([k, l]) => (
                      <div key={k} className="flex justify-between border-b border-dashed py-1">
                        <span>{l}</span>
                        <span className="tabular">{money(d.data.totals[k])}</span>
                      </div>
                    ))}
                  {d.data && (
                    <div className="flex justify-between pt-2 font-semibold">
                      <span>Total</span>
                      <span className="tabular">{money(d.data.totals.total)}</span>
                    </div>
                  )}
                  <Link to={to} className="mt-2 text-primary hover:underline">
                    Open detailed aging →
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ============================== AI insights ============================== */
export function AiInsightsPage() {
  const status = useApi<{ enabled: boolean; model: string | null }>('/ai/status');
  const [period, setPeriod] = useState<'thisMonth' | 'prevMonth'>('thisMonth');
  const gen = useAction((p: string) => post('/ai/monthly-report', { period: p }));
  const r = gen.data;
  const f = r?.facts;
  return (
    <div>
      <PageHeader
        title="AI business insights"
        description="Every figure below is computed by the server from the ledger. The AI (when configured) only writes the narrative and can never change inventory, payments or the books."
        actions={
          <>
            <Select aria-label="Period" className="w-40" value={period} onChange={(e) => setPeriod(e.target.value as 'thisMonth')}>
              <option value="thisMonth">This month</option>
              <option value="prevMonth">Previous month</option>
            </Select>
            <Button onClick={() => gen.mutate(period)} loading={gen.isPending}>
              <Sparkles /> Generate report
            </Button>
          </>
        }
      />
      <Card className="mb-4 flex items-center gap-3 p-4 text-sm">
        <Bot className="size-5 text-primary" />
        {status.data?.enabled ? (
          <span>
            AI narrative is enabled (model <code>{status.data.model}</code>). Only aggregated figures and product names are sent — no customer personal data.
          </span>
        ) : (
          <span>
            No AI provider configured (set <code>ANTHROPIC_API_KEY</code> on the server to enable). Reports use deterministic rule-based insights; the ERP works fully without AI.
          </span>
        )}
      </Card>
      {!r ? (
        <Card>
          <EmptyState
            icon={Lightbulb}
            title="Generate a monthly report"
            description="Summaries, sales trends, slow-moving stock, restocking suggestions, expense anomalies and high-profit products."
          />
        </Card>
      ) : (
        <div className="grid gap-4">
          {r.note && (
            <p className="flex items-center gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm">
              <AlertTriangle className="size-4" /> {r.note}
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <StatCard label="Net sales" value={money(f.totals.netSales)} hint={`Previous ${money(f.previous.netSales)}`} />
            <StatCard label="Gross profit" value={money(f.totals.grossProfit)} hint={`${pct(f.totals.grossMarginPct)} margin`} />
            <StatCard label="Operating expenses" value={money(f.totals.operatingExpenses)} hint={`Previous ${money(f.previous.operatingExpenses)}`} />
            <StatCard label="Net profit" value={money(f.totals.netProfit)} tone={f.totals.netProfit < 0 ? 'destructive' : 'success'} />
            <StatCard label="Inventory value" value={money(f.inventoryValue)} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="size-4" /> {f.period.label} summary <Badge variant="outline">{r.source === 'ai' ? `AI · ${r.model}` : 'Rule-based'}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm leading-relaxed">
              <p>{r.narrative.executiveSummary}</p>
              <p>
                <strong>Sales trend: </strong>
                {r.narrative.salesTrend}
              </p>
              <p>
                <strong>Debts: </strong>
                {r.narrative.debtSummary}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Suggested actions</CardTitle>
              <CardDescription>Suggestions only — nothing is changed automatically.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {r.narrative.suggestedActions.length === 0 && <p className="text-sm text-muted-foreground">No actions suggested.</p>}
              {r.narrative.suggestedActions.map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                  <Badge variant={a.kind === 'recommendation' ? 'default' : a.kind === 'prediction' ? 'warning' : 'secondary'}>{a.kind}</Badge>
                  <div>
                    <p className="font-medium">{a.action}</p>
                    <p className="text-muted-foreground">{a.reason}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
          <div className="grid gap-4 lg:grid-cols-3">
            <FactList title="High-profit products" rows={f.topProfit} render={(p: any) => [p.product, `${money(p.grossProfit)} · ${pct(p.marginPct)}`]} />
            <FactList title="Slow-moving stock" rows={f.slowMoving} render={(p: any) => [p.product, `${p.onHand} units · ${money(p.value)}`]} />
            <FactList
              title="Expense anomalies (≥25% change)"
              rows={f.expenseChanges}
              render={(e: any) => [e.category, `${money(e.current)} (${e.changePct === null ? 'new' : `${e.changePct > 0 ? '+' : ''}${e.changePct}%`})`]}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function FactList({ title, rows, render }: { title: string; rows: any[]; render: (r: any) => [string, string] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-1 text-sm">
        {rows.length === 0 && <p className="text-muted-foreground">None</p>}
        {rows.map((r, i) => {
          const [a, b] = render(r);
          return (
            <div key={i} className="flex justify-between gap-2 border-b border-dashed py-1">
              <span className="truncate">{a}</span>
              <span className="shrink-0 tabular text-muted-foreground">{b}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
