import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CreditCard, Pencil, Plus, Printer, Users } from 'lucide-react';
import { get, newIdempotencyKey, post, type Page } from '@/lib/api';
import { useAction, useApi, useDebounced, usePage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date, dateTime, money, refId, refName, titleCase } from '@/lib/format';
import { AsyncPicker, DataTable, EmptyState, ErrorState, LoadingBlock, MoneyInput, PageHeader, Pagination, SearchInput, StatCard, useListState } from '@/components/common';
import { Button, Card, Checkbox, Dialog, DialogContent, DialogFooter, Field, Input, Select, StatusBadge, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui';
import { methodLabel, PartyDialog, StatementCard } from './purchases';

const searchCustomers = (search: string) => get<Page<any>>('/customers', { search, limit: 15 }).then((r) => r.items);

export function CustomersPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const ls = useListState({ sort: 'name' });
  const list = usePage('/customers', { page: ls.page, limit: ls.limit, sort: ls.sort, search: useDebounced(ls.search), ...ls.filters });
  const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader
        title="Customers"
        description="Cash and credit customers with live balances from the ledger."
        actions={
          can('customers:write') && (
            <Button size="sm" onClick={() => setEdit({})}>
              <Plus /> New customer
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Name, code, phone…" />
          <Select aria-label="Status" className="sm:w-36" value={ls.filters.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="BLOCKED">Blocked</option>
          </Select>
          <Checkbox label="Only with balance owed" checked={ls.filters.withBalance === 'true'} onChange={(e) => ls.setFilter('withBalance', e.target.checked ? 'true' : '')} />
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          sort={ls.sort}
          onSort={ls.setSort}
          onRowClick={(c) => nav(`/customers/${c._id}`)}
          empty={<EmptyState icon={Users} title="No customers found" />}
          columns={[
            { key: 'c', header: 'Code', cell: (c) => c.code },
            { key: 'n', header: 'Name', sort: 'name', cell: (c) => <span className="font-medium">{c.name}</span> },
            { key: 't', header: 'Type', cell: (c) => titleCase(c.type) },
            { key: 'p', header: 'Phone', cell: (c) => c.phone ?? '' },
            { key: 'l', header: 'Credit limit', align: 'right', cell: (c) => (c.creditLimit ? money(c.creditLimit) : 'Cash only') },
            { key: 'r', header: 'Owes', align: 'right', cell: (c) => <span className={c.receivable > 0 ? 'font-medium text-warning' : ''}>{money(c.receivable)}</span> },
            { key: 'sc', header: 'Store credit', align: 'right', cell: (c) => (c.storeCredit ? money(c.storeCredit) : '') },
            { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} limit={ls.limit} onLimit={ls.setLimit} />
      </Card>
      {edit && <PartyDialog kind="customer" entity={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi(`/customers/${id}`);
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const c = q.data;
  return (
    <div>
      <PageHeader
        title={c.name}
        back="/customers"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {c.code} · {titleCase(c.type)} <StatusBadge status={c.status} /> {[c.phone, c.email].filter(Boolean).join(' · ')}
          </span>
        }
        actions={
          <>
            {can('customers:write') && (
              <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {can('customers:pay') && c.receivable > 0 && (
              <Button size="sm" variant="success" onClick={() => setPay(true)}>
                <CreditCard /> Receive payment
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Outstanding debt" value={money(c.receivable)} tone={c.receivable > 0 ? 'warning' : 'success'} />
        <StatCard label="Overdue" value={money(c.overdue)} tone={c.overdue > 0 ? 'destructive' : 'default'} />
        <StatCard label="Credit limit" value={c.creditLimit ? money(c.creditLimit) : 'Cash only'} hint={c.creditLimit ? `Available ${money(c.availableCredit)}` : undefined} />
        <StatCard label="Store credit" value={money(c.storeCredit)} />
        <StatCard label="Total purchases" value={money(c.totalSpending)} hint={`${c.invoiceCount} invoices`} />
        <StatCard label="Last transaction" value={date(c.lastTransaction)} hint={`Terms ${c.paymentTermsDays} days`} />
      </div>
      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Invoices ({c.sales.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments ({c.payments.length})</TabsTrigger>
          <TabsTrigger value="returns">Returns ({c.returns.length})</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
        </TabsList>
        <TabsContent value="sales">
          <Card>
            <DataTable
              rows={c.sales}
              empty={<EmptyState title="No invoices" />}
              columns={[
                {
                  key: 'n',
                  header: 'Invoice',
                  cell: (s) => (
                    <Link className="font-medium text-primary hover:underline" to={`/sales/${s._id}`}>
                      {s.invoiceNo}
                    </Link>
                  ),
                },
                { key: 'd', header: 'Date', cell: (s) => date(s.date) },
                { key: 't', header: 'Total', align: 'right', cell: (s) => money(s.total) },
                { key: 'p', header: 'Paid', align: 'right', cell: (s) => money(s.amountPaid) },
                { key: 'r', header: 'Returned', align: 'right', cell: (s) => (s.returnedAmount ? money(s.returnedAmount) : '') },
                { key: 'b', header: 'Balance', align: 'right', cell: (s) => <span className={s.balanceDue > 0 ? 'font-medium text-warning' : ''}>{money(s.balanceDue)}</span> },
                { key: 'du', header: 'Due', cell: (s) => (s.balanceDue > 0 ? <span className={s.dueDate && new Date(s.dueDate) < new Date() ? 'text-destructive' : ''}>{date(s.dueDate)}</span> : '') },
                { key: 'ps', header: 'Status', cell: (s) => <StatusBadge status={s.paymentStatus} /> },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="payments">
          <Card>
            <DataTable
              rows={c.payments}
              empty={<EmptyState title="No payments" />}
              columns={[
                { key: 'n', header: 'Receipt', cell: (p) => p.paymentNo },
                { key: 'd', header: 'Date', cell: (p) => dateTime(p.date) },
                { key: 'm', header: 'Method', cell: (p) => `${methodLabel(p.method)}${p.kind === 'REFUND' ? ' (refund)' : ''}` },
                {
                  key: 'al',
                  header: 'Applied to',
                  cell: (p) => p.allocations.map((a: any) => `${a.invoiceNo}: ${money(a.amount)}`).join(', ') + (p.toCredit ? ` · store credit ${money(p.toCredit)}` : ''),
                },
                { key: 'a', header: 'Amount', align: 'right', cell: (p) => money(p.amount) },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="returns">
          <Card>
            <DataTable
              rows={c.returns}
              empty={<EmptyState title="No returns" />}
              columns={[
                { key: 'n', header: 'Return', cell: (r) => r.returnNo },
                { key: 'i', header: 'Invoice', cell: (r) => r.invoiceNo },
                { key: 'd', header: 'Date', cell: (r) => date(r.date) },
                { key: 'a', header: 'Value', align: 'right', cell: (r) => money(r.totalAmount) },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="statement">
          <StatementCard path={`/customers/${c._id}/statement`} partyLabel="owed by customer" />
        </TabsContent>
      </Tabs>
      {edit && <PartyDialog kind="customer" entity={c} onClose={() => setEdit(false)} />}
      {pay && <CustomerPaymentDialog customer={c} onClose={() => setPay(false)} />}
    </div>
  );
}

export function CustomerPaymentDialog({ customer, onClose }: { customer?: any; onClose: () => void }) {
  const [cust, setCust] = useState<any>(customer ?? null);
  const [amount, setAmount] = useState<number | null>(customer?.receivable ?? null);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [allowCredit, setAllowCredit] = useState(false);
  const key = useMemo(() => newIdempotencyKey('cpay'), []);
  const act = useAction((b: object) => post('/customer-payments', b, key), {
    success: (r: any) => (r.replayed ? 'Payment already recorded (duplicate ignored)' : `Payment ${r.payment.paymentNo} recorded`),
    invalidate: ['/customers', '/sales', '/finance', '/reports', '/customer-payments'],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Receive customer payment" description="Applied to the customer's oldest open invoices first.">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!cust) return toast.error('Choose a customer');
            if (!amount || amount <= 0) return toast.error('Enter an amount');
            act.mutate({ customerId: cust._id, amount, method, reference: reference || undefined, allowCredit });
          }}
        >
          {!customer && (
            <Field label="Customer" required>
              <AsyncPicker
                load={searchCustomers}
                value={cust}
                onChange={(c) => (setCust(c), c && setAmount(c.receivable || null))}
                render={(c) => (
                  <span>
                    {c.name} <span className="text-muted-foreground">· owes {money(c.receivable)}</span>
                  </span>
                )}
              />
            </Field>
          )}
          {cust && <p className="text-sm text-muted-foreground">Currently owes {money(cust.receivable)}.</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" required>
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Method">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="CASH">Cash</option>
                <option value="MOBILE_MONEY">Mobile money</option>
                <option value="BANK_TRANSFER">Bank transfer</option>
              </Select>
            </Field>
          </div>
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Checkbox label="Keep any overpayment as store credit" checked={allowCredit} onChange={(e) => setAllowCredit(e.target.checked)} />
          <DialogFooter>
            <Button type="submit" loading={act.isPending}>
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CustomerStatementsPage() {
  const [cust, setCust] = useState<any>(null);
  return (
    <div>
      <PageHeader
        title="Customer statements"
        description="Accounts receivable ledger with running balance. Export or print for the customer."
        actions={
          cust && (
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer /> Print
            </Button>
          )
        }
      />
      <Card className="mb-4 p-4 no-print">
        <Field label="Customer">
          <AsyncPicker
            load={searchCustomers}
            value={cust}
            onChange={setCust}
            render={(c) => (
              <span>
                {c.name} <span className="text-muted-foreground">· owes {money(c.receivable)}</span>
              </span>
            )}
            placeholder="Search customer…"
          />
        </Field>
      </Card>
      {cust ? (
        <div className="print-area">
          <h2 className="mb-2 text-lg font-semibold">{cust.name}</h2>
          <StatementCard path={`/customers/${cust._id}/statement`} partyLabel="owed by customer" />
        </div>
      ) : (
        <Card>
          <EmptyState icon={Users} title="Choose a customer to view their statement" />
        </Card>
      )}
    </div>
  );
}

export function CustomerPaymentsPage() {
  const { can } = useAuth();
  const ls = useListState({ sort: '-date' });
  const list = usePage('/customer-payments', { page: ls.page, limit: ls.limit, search: useDebounced(ls.search), ...ls.filters });
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader
        title="Customer payments"
        description="Money received from customers, and refunds paid out."
        actions={
          can('customers:pay') && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus /> Receive payment
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Receipt number, reference…" />
          <Select aria-label="Method" className="sm:w-44" value={ls.filters.method ?? ''} onChange={(e) => ls.setFilter('method', e.target.value)}>
            <option value="">All methods</option>
            <option value="CASH">Cash</option>
            <option value="MOBILE_MONEY">Mobile money</option>
            <option value="BANK_TRANSFER">Bank transfer</option>
            <option value="STORE_CREDIT">Store credit</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          empty={<EmptyState icon={CreditCard} title="No payments" />}
          columns={[
            { key: 'n', header: 'Receipt', cell: (p) => <span className="font-medium">{p.paymentNo}</span> },
            { key: 'd', header: 'Date', cell: (p) => dateTime(p.date) },
            {
              key: 'c',
              header: 'Customer',
              cell: (p) =>
                p.customerId ? (
                  <Link className="text-primary hover:underline" to={`/customers/${refId(p.customerId)}`}>
                    {refName(p.customerId)}
                  </Link>
                ) : (
                  'Walk-in'
                ),
            },
            { key: 'm', header: 'Method', cell: (p) => methodLabel(p.method) },
            { key: 'k', header: 'Type', cell: (p) => (p.kind === 'REFUND' ? <StatusBadge status="RETURNED" /> : 'Payment') },
            { key: 'al', header: 'Invoices', cell: (p) => p.allocations.map((a: any) => a.invoiceNo).join(', ') },
            { key: 'ref', header: 'Reference', cell: (p) => p.reference ?? '' },
            {
              key: 'a',
              header: 'Amount',
              align: 'right',
              cell: (p) => (
                <span className={p.kind === 'REFUND' ? 'text-destructive' : ''}>
                  {p.kind === 'REFUND' ? '−' : ''}
                  {money(p.amount)}
                </span>
              ),
            },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
      {open && <CustomerPaymentDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
