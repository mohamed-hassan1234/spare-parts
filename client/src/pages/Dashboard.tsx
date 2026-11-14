import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Banknote,
  Boxes,
  Building2,
  CalendarDays,
  CircleDollarSign,
  Landmark,
  PackageX,
  Receipt,
  ShoppingCart,
  Smartphone,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
} from 'lucide-react';
import { useApi } from '@/lib/hooks';
import { date, money, num, pct, refName } from '@/lib/format';
import { ACCOUNTS } from '@autoparts/shared';
import { PageHeader, PeriodFilter, periodQuery, StatCard, ErrorState, EmptyState, type PeriodValue } from '@/components/common';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatusBadge, Table, TBody, TD, TH, THead, TR } from '@/components/ui';
import { MoneyAreaChart, MoneyBarChart, MoneyPieChart } from '@/components/charts';

export function DashboardPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: 'thisMonth' });
  const q = periodQuery(period);
  const ov = useApi('/dashboard/overview', q);
  const charts = useApi('/dashboard/charts', q);
  const profit = useApi<any[]>('/dashboard/profit-chart');
  const act = useApi('/dashboard/activity');
  const d = ov.data;
  const acct = (code: string) => d?.cashAccounts?.find((a: { code: string }) => a.code === code)?.balance ?? 0;
  const l = ov.isLoading;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={
          d ? (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" /> Reporting period: <strong className="font-medium text-foreground">{d.period.label}</strong> ({date(d.period.from)} –{' '}
              {date(new Date(new Date(d.period.to).getTime() - 1))}, {d.period.timezone})
            </span>
          ) : (
            'Live figures from posted transactions and the ledger'
          )
        }
        actions={<PeriodFilter value={period} onChange={setPeriod} />}
      />
      {ov.error ? (
        <Card>
          <ErrorState error={ov.error} retry={() => ov.refetch()} />
        </Card>
      ) : (
        <>
          <section aria-label="Sales and profit" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard loading={l} label="Today's revenue" value={money(d?.todaySales)} icon={CircleDollarSign} to="/sales" />
            <StatCard loading={l} label="Yesterday's revenue" value={money(d?.yesterdaySales)} icon={CircleDollarSign} />
            <StatCard loading={l} label="Monthly revenue" value={money(d?.monthSales)} icon={TrendingUp} />
            <StatCard loading={l} label="Net sales (period)" value={money(d?.revenue)} hint={`${num(d?.salesCount)} invoices`} icon={Receipt} to="/reports/sales" />
            <StatCard loading={l} label="Purchases (period)" value={money(d?.purchasesTotal)} hint="Goods received at landed cost" icon={ShoppingCart} to="/purchases/receipts" />
            <StatCard loading={l} label="Operating expenses" value={money(d?.operatingExpenses)} icon={TrendingDown} tone="warning" to="/expenses" />
            <StatCard
              loading={l}
              label="Gross profit"
              value={money(d?.grossProfit)}
              hint={`Margin ${pct(d?.grossMarginPct)} · COGS ${money(d?.cogs)}`}
              icon={TrendingUp}
              tone="success"
              to="/finance/profit-loss"
            />
            <StatCard
              loading={l}
              label="Net profit"
              value={money(d?.netProfit)}
              icon={d?.netProfit < 0 ? TrendingDown : TrendingUp}
              tone={d?.netProfit < 0 ? 'destructive' : 'success'}
              to="/finance/profit-loss"
            />
            <StatCard loading={l} label="Inventory valuation" value={money(d?.inventoryValue)} hint="Σ remaining FIFO cost" icon={Boxes} to="/reports/inventory" />
            <StatCard loading={l} label="Products in catalogue" value={num(d?.totalProducts)} icon={Boxes} to="/inventory" />
            <StatCard loading={l} label="Low stock" value={num(d?.lowStock)} icon={AlertTriangle} tone={d?.lowStock ? 'warning' : 'default'} to="/inventory/low-stock" />
            <StatCard loading={l} label="Out of stock" value={num(d?.outOfStock)} icon={PackageX} tone={d?.outOfStock ? 'destructive' : 'default'} to="/inventory/low-stock" />
          </section>
          <section aria-label="Balances" className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <StatCard loading={l} label="Customer receivables" value={money(d?.receivables)} icon={Wallet} tone={d?.receivables ? 'warning' : 'default'} to="/finance/receivables" />
            <StatCard loading={l} label="Supplier payables" value={money(d?.payables)} icon={Truck} tone={d?.payables ? 'warning' : 'default'} to="/finance/payables" />
            <StatCard loading={l} label="Cash balance" value={money(acct(ACCOUNTS.CASH))} icon={Banknote} to="/finance/cash" />
            <StatCard loading={l} label="Bank balance" value={money(acct(ACCOUNTS.BANK))} icon={Landmark} to="/finance/cash" />
            <StatCard loading={l} label="Mobile money" value={money(acct(ACCOUNTS.MOBILE_MONEY))} icon={Smartphone} to="/finance/cash" />
            <StatCard loading={l} label="Customers / suppliers" value={`${num(d?.totalCustomers)} / ${num(d?.totalSuppliers)}`} icon={Users} to="/customers" />
          </section>
        </>
      )}

      <div className="mt-5 grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Sales trend</CardTitle>
            <CardDescription>Net sales and gross profit by {charts.data?.unit ?? 'day'}</CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyAreaChart
              data={charts.data?.series ?? []}
              series={[
                { key: 'netSales', label: 'Net sales' },
                { key: 'grossProfit', label: 'Gross profit' },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Sales by category</CardTitle>
            <CardDescription>Net sales in the period</CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyPieChart data={charts.data?.salesByCategory ?? []} nameKey="name" valueKey="netSales" />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Profit trend</CardTitle>
            <CardDescription>Gross profit, expenses and net profit — last 12 months</CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyBarChart
              data={profit.data ?? []}
              series={[
                { key: 'grossProfit', label: 'Gross profit' },
                { key: 'expenses', label: 'Expenses' },
                { key: 'netProfit', label: 'Net profit' },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Expenses</CardTitle>
            <CardDescription>Operating expenses by {charts.data?.unit ?? 'day'}</CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyBarChart data={(charts.data?.series ?? []).filter((r: any) => r.expenses)} series={[{ key: 'expenses', label: 'Expenses' }]} />
          </CardContent>
        </Card>
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Top products</CardTitle>
            <CardDescription>By net sales in the period</CardDescription>
          </CardHeader>
          <CardContent>
            <MoneyBarChart
              layout="vertical"
              xKey="name"
              height={300}
              data={[...(charts.data?.topProducts ?? [])].sort((a: any, b: any) => b.netSales - a.netSales).slice(0, 8)}
              series={[
                { key: 'netSales', label: 'Net sales' },
                { key: 'grossProfit', label: 'Gross profit' },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Inventory alerts</CardTitle>
            <CardDescription>Out of stock and below reorder point</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {act.data?.lowStock?.length ? (
              act.data.lowStock.map((p: any) => (
                <Link key={p.productId} to={`/products/${p.productId}`} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/50">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{p.sku}</span> · {p.name}
                  </span>
                  <span className="shrink-0 text-right text-xs">
                    <StatusBadge status={p.status} />
                    <span className="ml-2 tabular">
                      {p.available}/{p.reorderPoint}
                    </span>
                  </span>
                </Link>
              ))
            ) : (
              <EmptyState title="Stock levels are healthy" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <RecentCard
          title="Recent sales"
          to="/sales"
          rows={act.data?.sales}
          cols={[
            [
              'Invoice',
              (r) => (
                <Link className="font-medium text-primary hover:underline" to={`/sales/${r._id}`}>
                  {r.invoiceNo}
                </Link>
              ),
            ],
            ['Customer', (r) => r.customerName],
            ['Total', (r) => money(r.total), true],
          ]}
        />
        <RecentCard
          title="Recent purchases"
          to="/purchases/receipts"
          rows={act.data?.purchases}
          cols={[
            [
              'GRN',
              (r) => (
                <Link className="font-medium text-primary hover:underline" to={`/purchases/${r.purchaseId}`}>
                  {r.receiptNo}
                </Link>
              ),
            ],
            ['Supplier', (r) => refName(r.supplierId)],
            ['Cost', (r) => money(r.totalCost), true],
          ]}
        />
        <RecentCard
          title="Recent payments"
          to="/customer-payments"
          rows={[...(act.data?.payments ?? []).map((p: any) => ({ ...p, dir: 'in' })), ...(act.data?.supplierPayments ?? []).map((p: any) => ({ ...p, dir: 'out' }))]
            .sort((a, b) => +new Date(b.date) - +new Date(a.date))
            .slice(0, 8)}
          cols={[
            ['Ref', (r) => <span className="font-medium">{r.paymentNo}</span>],
            ['Party', (r) => (r.dir === 'in' ? refName(r.customerId) || 'Walk-in' : refName(r.supplierId)) + (r.kind === 'REFUND' ? ' (refund)' : '')],
            [
              'Amount',
              (r) => (
                <span className={r.dir === 'in' && r.kind !== 'REFUND' ? 'text-success' : 'text-destructive'}>
                  {r.dir === 'in' && r.kind !== 'REFUND' ? '+' : '−'}
                  {money(r.amount)}
                </span>
              ),
              true,
            ],
          ]}
        />
      </div>
      <p className="mt-6 flex items-center gap-1 text-xs text-muted-foreground">
        <Building2 className="size-3" /> All figures are computed by the server from posted transactions and the double-entry ledger.
      </p>
    </div>
  );
}

function RecentCard({ title, to, rows, cols }: { title: string; to: string; rows?: any[]; cols: [string, (r: any) => React.ReactNode, boolean?][] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <Link to={to} className="text-sm text-primary hover:underline">
          View all
        </Link>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        {!rows?.length ? (
          <EmptyState title="No activity yet" />
        ) : (
          <Table>
            <THead>
              <TR>
                {cols.map(([h, , r]) => (
                  <TH key={h} className={r ? 'text-right' : ''}>
                    {h}
                  </TH>
                ))}
              </TR>
            </THead>
            <TBody>
              {rows.slice(0, 6).map((r, i) => (
                <TR key={r._id ?? i}>
                  {cols.map(([h, f, right]) => (
                    <TD key={h} className={right ? 'text-right tabular' : 'max-w-40 truncate'}>
                      {f(r)}
                    </TD>
                  ))}
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
