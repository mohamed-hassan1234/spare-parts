import { Fragment, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeftRight, CheckCircle2, ChevronDown, ChevronRight, Landmark, Paperclip, Plus, RefreshCw, Repeat, Undo2, XCircle } from 'lucide-react';
import { ACCOUNTS } from '@autoparts/shared';
import { api, newIdempotencyKey, patch, post } from '@/lib/api';
import { useAction, useApi, useDebounced, usePage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { cn, date, dateTime, money, refId, refName, titleCase, todayInput } from '@/lib/format';
import {
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  ExportMenu,
  KeyValue,
  LoadingBlock,
  MoneyInput,
  PageHeader,
  Pagination,
  PeriodFilter,
  periodQuery,
  SearchInput,
  StatCard,
  useListState,
  type PeriodValue,
} from '@/components/common';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';
import { MoneyBarChart, MoneyPieChart } from '@/components/charts';
import { methodLabel } from './purchases';

const CASH_ACCOUNTS = [
  [ACCOUNTS.CASH, 'Cash on hand'],
  [ACCOUNTS.BANK, 'Bank account'],
  [ACCOUNTS.MOBILE_MONEY, 'Mobile money'],
] as const;

/* ========================== Financial dashboard ========================== */
export function FinanceDashboardPage() {
  const cash = useApi('/finance/cash');
  const bs = useApi('/finance/balance-sheet');
  const pl = useApi('/reports/profit-loss', { period: 'thisMonth' });
  const rec = useApi('/finance/reconciliation');
  return (
    <div>
      <PageHeader
        title="Financial dashboard"
        description="Balances straight from the double-entry ledger."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/reports/financial">Financial statements</Link>
          </Button>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cash.data?.accounts.map((a: any) => (
          <StatCard key={a.code} label={a.name} value={money(a.balance)} icon={Landmark} to="/finance/cash" />
        ))}
        <StatCard label="Total cash & bank" value={money(cash.data?.total)} loading={cash.isLoading} tone="success" />
        <StatCard label="Net sales (this month)" value={money(pl.data?.netSales)} loading={pl.isLoading} />
        <StatCard label="Gross profit (this month)" value={money(pl.data?.grossProfit)} loading={pl.isLoading} tone="success" />
        <StatCard label="Operating expenses (this month)" value={money(pl.data?.totalOperatingExpenses)} loading={pl.isLoading} tone="warning" to="/expenses" />
        <StatCard label="Net profit (this month)" value={money(pl.data?.netProfit)} loading={pl.isLoading} tone={pl.data?.netProfit < 0 ? 'destructive' : 'success'} to="/finance/profit-loss" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Balance sheet (today)</CardTitle>
            <CardDescription>
              {bs.data && (bs.data.balanced ? <span className="text-success">Assets = Liabilities + Equity ✓</span> : <span className="text-destructive">Out of balance — investigate</span>)}
            </CardDescription>
          </CardHeader>
          <CardContent>{bs.isLoading ? <LoadingBlock /> : bs.error ? <ErrorState error={bs.error} /> : <BalanceSheet bs={bs.data} />}</CardContent>
        </Card>
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Integrity & reconciliation checks</CardTitle>
              <CardDescription>Independent checks of the ledger against stock, invoices and purchases.</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => rec.refetch()} loading={rec.isFetching}>
              <RefreshCw /> Run
            </Button>
          </CardHeader>
          <CardContent className="grid gap-2">
            {rec.error && <ErrorState error={rec.error} />}
            {rec.data?.checks.map((c: any) => (
              <div key={c.name} className="flex items-start gap-2 text-sm">
                {c.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                <div>
                  <p>{c.name}</p>
                  {(c.expected !== undefined || c.detail) && (
                    <p className="text-xs text-muted-foreground">
                      {c.expected !== undefined && `expected ${money(c.expected)} · actual ${money(c.actual)}`} {c.detail}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {rec.data && <p className="mt-2 text-xs text-muted-foreground">Checked {dateTime(rec.data.checkedAt)}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function BalanceSheet({ bs }: { bs: any }) {
  const section = (title: string, rows: any[], total: number) => (
    <div className="mb-4">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {rows.map((r) => (
        <div key={r.code} className="flex justify-between border-b border-dashed py-1 text-sm">
          <span>
            <span className="mr-2 font-mono text-xs text-muted-foreground">{r.code}</span>
            {r.name}
          </span>
          <span className="tabular">{money(r.amount)}</span>
        </div>
      ))}
      <div className="flex justify-between py-1 text-sm font-semibold">
        <span>Total {title.toLowerCase()}</span>
        <span className="tabular">{money(total)}</span>
      </div>
    </div>
  );
  return (
    <div>
      {section('Assets', bs.assets, bs.totalAssets)}
      {section('Liabilities', bs.liabilities, bs.totalLiabilities)}
      {section('Equity', [...bs.equity, { code: '—', name: 'Current period earnings', amount: bs.currentEarnings }], bs.totalEquity)}
      <div className="flex justify-between border-t pt-2 text-sm font-semibold">
        <span>Liabilities + equity</span>
        <span className="tabular">{money(bs.totalLiabilities + bs.totalEquity)}</span>
      </div>
    </div>
  );
}

/* ================================ Expenses ================================ */
export function ExpensesPage() {
  const { can } = useAuth();
  const ls = useListState({ sort: '-date', filters: { status: 'POSTED' } });
  const list = usePage('/expenses', { page: ls.page, limit: ls.limit, sort: ls.sort, search: useDebounced(ls.search), ...ls.filters });
  const cats = useApi<any[]>('/expense-categories');
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<any>(null);
  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Operating expenses reduce profit. Capital purchases, owner withdrawals and loan repayments are recorded separately and never counted as operating expenses."
        actions={
          can('expenses:write') && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus /> Record expense
            </Button>
          )
        }
      />
      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">Expenses</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="recurring">Recurring</TabsTrigger>
        </TabsList>
        <TabsContent value="list">
          <Card>
            <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:flex-wrap">
              <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Description, number, reference…" />
              <Select aria-label="Category" className="md:w-48" value={ls.filters.categoryId ?? ''} onChange={(e) => ls.setFilter('categoryId', e.target.value)}>
                <option value="">All categories</option>
                {cats.data?.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Kind" className="md:w-48" value={ls.filters.kind ?? ''} onChange={(e) => ls.setFilter('kind', e.target.value)}>
                <option value="">All kinds</option>
                {['OPERATING', 'CAPITAL_EXPENDITURE', 'OWNER_DRAWING', 'LOAN_REPAYMENT'].map((k) => (
                  <option key={k} value={k}>
                    {titleCase(k)}
                  </option>
                ))}
              </Select>
              <Select aria-label="Status" className="md:w-32" value={ls.filters.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)}>
                <option value="">All</option>
                <option value="POSTED">Posted</option>
                <option value="VOIDED">Voided</option>
              </Select>
              <Input type="date" aria-label="From" className="md:w-40" value={ls.filters.from ?? ''} onChange={(e) => ls.setFilter('from', e.target.value)} />
              <Input type="date" aria-label="To" className="md:w-40" value={ls.filters.to ?? ''} onChange={(e) => ls.setFilter('to', e.target.value)} />
            </div>
            <DataTable
              rows={list.data?.items}
              loading={list.isFetching}
              error={list.error}
              sort={ls.sort}
              onSort={ls.setSort}
              onRowClick={setView}
              empty={<EmptyState title="No expenses found" />}
              columns={[
                { key: 'n', header: 'No.', cell: (e) => <span className="font-medium">{e.expenseNo}</span> },
                { key: 'd', header: 'Date', sort: 'date', cell: (e) => date(e.date) },
                { key: 'c', header: 'Category', cell: (e) => refName(e.categoryId) },
                { key: 'k', header: 'Kind', cell: (e) => <Badge variant={e.kind === 'OPERATING' ? 'default' : 'secondary'}>{titleCase(e.kind)}</Badge> },
                {
                  key: 'ds',
                  header: 'Description',
                  cell: (e) => (
                    <span className="inline-flex items-center gap-1">
                      {e.description} {e.attachmentFile && <Paperclip className="size-3 text-muted-foreground" aria-label="Has attachment" />}
                    </span>
                  ),
                },
                { key: 'm', header: 'Paid from', cell: (e) => methodLabel(e.method) },
                {
                  key: 'a',
                  header: 'Amount',
                  align: 'right',
                  sort: 'amount',
                  cell: (e) => <span className={e.status === 'VOIDED' ? 'line-through text-muted-foreground' : ''}>{money(e.amount)}</span>,
                },
                { key: 's', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
              ]}
            />
            <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} limit={ls.limit} onLimit={ls.setLimit} />
          </Card>
        </TabsContent>
        <TabsContent value="categories">
          <ExpenseCategories cats={cats.data ?? []} />
        </TabsContent>
        <TabsContent value="recurring">
          <RecurringExpenses cats={cats.data ?? []} />
        </TabsContent>
      </Tabs>
      {open && <ExpenseDialog cats={cats.data ?? []} onClose={() => setOpen(false)} />}
      {view && <ExpenseDetailDialog expense={view} onClose={() => setView(null)} />}
    </div>
  );
}

function ExpenseDialog({ cats, onClose }: { cats: any[]; onClose: () => void }) {
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [dt, setDt] = useState(todayInput());
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const key = useMemo(() => newIdempotencyKey('exp'), []);
  const cat = cats.find((c) => c._id === categoryId);
  const act = useAction(
    async (b: object) => {
      const e = await post('/expenses', b, key);
      const f = fileRef.current?.files?.[0];
      if (f) {
        const fd = new FormData();
        fd.append('file', f);
        try {
          await api(`/expenses/${e._id}/attachment`, { method: 'POST', body: fd });
        } catch (err) {
          toast.error(`Expense saved, but the attachment failed: ${(err as Error).message}`);
        }
      }
      return e;
    },
    { success: (e: any) => `Expense ${e.expenseNo} recorded`, invalidate: ['/expenses', '/finance', '/reports'], onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Record expense">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!categoryId) return toast.error('Choose a category');
            if (!amount || amount <= 0) return toast.error('Enter an amount');
            if (description.trim().length < 2) return toast.error('Enter a description');
            act.mutate({ categoryId, description, amount, date: new Date(dt + 'T12:00:00Z').toISOString(), method, reference: reference || undefined, notes: notes || undefined });
          }}
        >
          <Field
            label="Category"
            required
            className="sm:col-span-2"
            hint={cat ? `Recorded as ${titleCase(cat.kind)}${cat.kind === 'OPERATING' ? ' (reduces profit)' : ' (not an operating expense)'}` : undefined}
          >
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} aria-label="Expense category">
              <option value="">Choose…</option>
              {['OPERATING', 'CAPITAL_EXPENDITURE', 'OWNER_DRAWING', 'LOAN_REPAYMENT'].map((k) => (
                <optgroup key={k} label={titleCase(k)}>
                  {cats
                    .filter((c) => c.kind === k && c.isActive !== false)
                    .map((c) => (
                      <option key={c._id} value={c._id}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </Field>
          <Field label="Description" required className="sm:col-span-2">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Amount" required>
            <MoneyInput value={amount} onChange={setAmount} aria-label="Expense amount" />
          </Field>
          <Field label="Date" required>
            <Input type="date" value={dt} onChange={(e) => setDt(e.target.value)} />
          </Field>
          <Field label="Paid from" required>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="BANK_TRANSFER">Bank</option>
              <option value="MOBILE_MONEY">Mobile money</option>
            </Select>
          </Field>
          <Field label="Reference">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Supporting document" hint="PDF, PNG or JPEG up to 5 MB" className="sm:col-span-2">
            <Input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" loading={act.isPending}>
              Save expense
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExpenseDetailDialog({ expense, onClose }: { expense: any; onClose: () => void }) {
  const { can } = useAuth();
  const [voiding, setVoiding] = useState(false);
  const [desc, setDesc] = useState(expense.description);
  const fileRef = useRef<HTMLInputElement>(null);
  const inv = ['/expenses', '/finance', '/reports'];
  const voidIt = useAction((reason: string) => post(`/expenses/${expense._id}/void`, { reason }), { success: 'Expense voided with a reversing entry', invalidate: inv, onSuccess: onClose });
  const save = useAction(() => patch(`/expenses/${expense._id}`, { description: desc }), { success: 'Description updated', invalidate: inv });
  const attach = useAction(
    (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api(`/expenses/${expense._id}/attachment`, { method: 'POST', body: fd });
    },
    { success: 'Attachment uploaded', invalidate: inv, onSuccess: onClose },
  );
  const editable = can('expenses:write') && expense.status === 'POSTED';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Expense ${expense.expenseNo}`} description="Amounts cannot be edited. To correct an amount, void and re-enter — both entries stay in the ledger.">
        <KeyValue
          items={[
            ['Date', date(expense.date)],
            ['Category', refName(expense.categoryId)],
            ['Kind', titleCase(expense.kind)],
            ['Amount', money(expense.amount)],
            ['Paid from', methodLabel(expense.method)],
            ['Reference', expense.reference],
            ['Status', <StatusBadge key="s" status={expense.status} />],
            ['Void reason', expense.voidReason],
          ]}
        />
        {expense.attachmentFile ? (
          <a className="inline-flex items-center gap-1 text-sm text-primary hover:underline" href={`/api/v1/expenses/${expense._id}/attachment`} target="_blank" rel="noreferrer">
            <Paperclip className="size-4" /> View supporting document
          </a>
        ) : (
          editable && (
            <div className="flex items-center gap-2">
              <input ref={fileRef} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && attach.mutate(e.target.files[0])} />
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} loading={attach.isPending}>
                <Paperclip /> Attach document
              </Button>
            </div>
          )
        )}
        {editable && (
          <Field label="Description">
            <div className="flex gap-2">
              <Input value={desc} onChange={(e) => setDesc(e.target.value)} />
              <Button variant="outline" onClick={() => save.mutate()} loading={save.isPending} disabled={desc === expense.description}>
                Save
              </Button>
            </div>
          </Field>
        )}
        <DialogFooter>
          {editable && (
            <Button variant="destructive" onClick={() => setVoiding(true)}>
              Void expense
            </Button>
          )}
        </DialogFooter>
        <ConfirmDialog
          open={voiding}
          onOpenChange={setVoiding}
          title={`Void ${expense.expenseNo}?`}
          description="A reversing journal entry is posted. The original stays in the audit trail."
          requireReason
          destructive
          confirmLabel="Void"
          loading={voidIt.isPending}
          onConfirm={(r) => voidIt.mutate(r)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ExpenseCategories({ cats }: { cats: any[] }) {
  const { can } = useAuth();
  const [name, setName] = useState('');
  const [kind, setKind] = useState('OPERATING');
  const add = useAction(() => post('/expense-categories', { name, kind }), { success: 'Category added', invalidate: ['/expense-categories'], onSuccess: () => setName('') });
  const toggle = useAction((c: any) => patch(`/expense-categories/${c._id}`, { isActive: !c.isActive }), { success: 'Category updated', invalidate: ['/expense-categories'] });
  return (
    <Card>
      {can('expenses:write') && (
        <form
          className="flex flex-col gap-2 border-b p-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length >= 2) add.mutate();
          }}
        >
          <Input placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New category name" className="sm:w-64" />
          <Select value={kind} onChange={(e) => setKind(e.target.value)} className="sm:w-56" aria-label="Kind">
            {['OPERATING', 'CAPITAL_EXPENDITURE', 'OWNER_DRAWING', 'LOAN_REPAYMENT'].map((k) => (
              <option key={k} value={k}>
                {titleCase(k)}
              </option>
            ))}
          </Select>
          <Button type="submit" loading={add.isPending}>
            Add
          </Button>
        </form>
      )}
      <DataTable
        rows={cats}
        columns={[
          { key: 'n', header: 'Name', cell: (c) => c.name },
          { key: 'k', header: 'Kind', cell: (c) => titleCase(c.kind) },
          { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.isActive === false ? 'INACTIVE' : 'ACTIVE'} /> },
          {
            key: 'a',
            header: '',
            align: 'right',
            cell: (c) =>
              can('expenses:write') && (
                <Button variant="ghost" size="sm" onClick={() => toggle.mutate(c)}>
                  {c.isActive === false ? 'Activate' : 'Deactivate'}
                </Button>
              ),
          },
        ]}
      />
    </Card>
  );
}

function RecurringExpenses({ cats }: { cats: any[] }) {
  const { can } = useAuth();
  const q = useApi<any[]>('/recurring-expenses');
  const [st, setSt] = useState({ name: '', categoryId: '', amount: null as number | null, method: 'BANK_TRANSFER', dayOfMonth: '1' });
  const add = useAction(() => post('/recurring-expenses', { ...st, dayOfMonth: Number(st.dayOfMonth) }), {
    success: 'Template saved',
    invalidate: ['/recurring-expenses'],
    onSuccess: () => setSt({ ...st, name: '', amount: null }),
  });
  const record = useAction((id: string) => post(`/recurring-expenses/${id}/record`), { success: 'Recorded for this month', invalidate: ['/recurring-expenses', '/expenses', '/finance', '/reports'] });
  return (
    <Card>
      {can('expenses:write') && (
        <form
          className="grid gap-2 border-b p-3 sm:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (!st.name || !st.categoryId || !st.amount) return toast.error('Name, category and amount are required');
            add.mutate();
          }}
        >
          <Input placeholder="Name (e.g. Shop rent)" value={st.name} onChange={(e) => setSt({ ...st, name: e.target.value })} className="sm:col-span-2" aria-label="Template name" />
          <Select value={st.categoryId} onChange={(e) => setSt({ ...st, categoryId: e.target.value })} aria-label="Category">
            <option value="">Category…</option>
            {cats.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
          <MoneyInput value={st.amount} onChange={(c) => setSt({ ...st, amount: c })} aria-label="Amount" />
          <Select value={st.method} onChange={(e) => setSt({ ...st, method: e.target.value })} aria-label="Paid from">
            <option value="CASH">Cash</option>
            <option value="BANK_TRANSFER">Bank</option>
            <option value="MOBILE_MONEY">Mobile money</option>
          </Select>
          <Button type="submit" loading={add.isPending}>
            <Repeat /> Add template
          </Button>
        </form>
      )}
      <DataTable
        rows={q.data}
        loading={q.isLoading}
        empty={<EmptyState icon={Repeat} title="No recurring expenses" description="Templates let you record rent, salaries and bills once per month with one click." />}
        columns={[
          { key: 'n', header: 'Name', cell: (t) => t.name },
          { key: 'c', header: 'Category', cell: (t) => refName(t.categoryId) || cats.find((c) => c._id === refId(t.categoryId))?.name },
          { key: 'a', header: 'Amount', align: 'right', cell: (t) => money(t.amount) },
          { key: 'd', header: 'Day', cell: (t) => t.dayOfMonth },
          { key: 'l', header: 'Last recorded', cell: (t) => t.lastRecordedPeriod ?? 'Never' },
          {
            key: 'x',
            header: '',
            align: 'right',
            cell: (t) =>
              can('expenses:write') && (
                <Button size="sm" variant="outline" onClick={() => record.mutate(t._id)} loading={record.isPending && record.variables === t._id}>
                  Record this month
                </Button>
              ),
          },
        ]}
      />
    </Card>
  );
}

/* ============================ Debts (aging) ============================ */
function AgingPage({ kind }: { kind: 'receivables' | 'payables' }) {
  const q = useApi(`/reports/${kind}`);
  const isAR = kind === 'receivables';
  const buckets = [
    ['current', 'Not yet due'],
    ['d1_30', '1–30 days'],
    ['d31_60', '31–60 days'],
    ['d61_90', '61–90 days'],
    ['d90_plus', '90+ days'],
  ] as const;
  return (
    <div>
      <PageHeader
        title={isAR ? 'Customer debts' : 'Supplier debts'}
        description={isAR ? 'What customers owe you, aged by due date. Balances can only change through sales, payments and returns.' : 'What you owe suppliers, aged by due date.'}
        actions={<ExportMenu path={`/reports/${kind}`} />}
      />
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.error ? (
        <ErrorState error={q.error} retry={q.refetch} />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-6">
            <StatCard label={isAR ? 'Total receivable' : 'Total payable'} value={money(q.data.totals.total)} tone="warning" />
            {buckets.map(([k, l]) => (
              <StatCard key={k} label={l} value={money(q.data.totals[k])} tone={k === 'current' ? 'default' : k === 'd90_plus' ? 'destructive' : 'warning'} />
            ))}
          </div>
          <p className={cn('mb-3 text-sm', q.data.reconciled ? 'text-success' : 'text-destructive')}>
            {q.data.reconciled ? '✓' : '✗'} Ledger balance {money(q.data.ledgerTotal)} {q.data.reconciled ? 'matches' : 'does NOT match'} the open {isAR ? 'invoice' : 'purchase'} balances.
            {isAR && q.data.storeCredits ? ` Store credit held for customers: ${money(q.data.storeCredits)}.` : ''}
          </p>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>By {isAR ? 'customer' : 'supplier'}</CardTitle>
            </CardHeader>
            <DataTable
              rows={q.data.rows}
              rowKey={(r) => String(r.customerId ?? r.supplierId)}
              empty={<EmptyState title={isAR ? 'No customer owes money' : 'Nothing owed to suppliers'} />}
              columns={[
                {
                  key: 'n',
                  header: 'Name',
                  cell: (r) => (
                    <Link className="font-medium text-primary hover:underline" to={isAR ? `/customers/${r.customerId}` : `/suppliers/${r.supplierId}`}>
                      {r.name}
                    </Link>
                  ),
                },
                { key: 'p', header: 'Phone', cell: (r) => r.phone ?? '' },
                ...buckets.map(([k, l]) => ({ key: k, header: l, align: 'right' as const, cell: (r: any) => (r[k] ? money(r[k]) : '') })),
                { key: 't', header: 'Total', align: 'right', cell: (r) => <strong>{money(r.total)}</strong> },
              ]}
            />
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Open {isAR ? 'invoices' : 'purchases'}</CardTitle>
            </CardHeader>
            <DataTable
              rows={isAR ? q.data.invoices : q.data.purchases}
              rowKey={(r) => String(r.saleId ?? r.purchaseId)}
              empty={<EmptyState title="None" />}
              columns={[
                {
                  key: 'n',
                  header: isAR ? 'Invoice' : 'Purchase',
                  cell: (r) => (
                    <Link className="font-medium text-primary hover:underline" to={isAR ? `/sales/${r.saleId}` : `/purchases/${r.purchaseId}`}>
                      {r.invoiceNo ?? r.purchaseNo}
                    </Link>
                  ),
                },
                { key: 'p', header: isAR ? 'Customer' : 'Supplier', cell: (r) => r.customer ?? r.supplier },
                { key: 'd', header: 'Date', cell: (r) => date(r.date) },
                { key: 'du', header: 'Due', cell: (r) => <span className={r.bucket !== 'current' ? 'text-destructive' : ''}>{date(r.dueDate)}</span> },
                { key: 't', header: 'Total', align: 'right', cell: (r) => money(r.total) },
                { key: 'b', header: 'Outstanding', align: 'right', cell: (r) => <strong>{money(r.balanceDue ?? r.outstanding)}</strong> },
                { key: 'bk', header: 'Age', cell: (r) => <Badge variant={r.bucket === 'current' ? 'secondary' : 'destructive'}>{buckets.find(([k]) => k === r.bucket)?.[1] ?? r.bucket}</Badge> },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  );
}
export const ReceivablesPage = () => <AgingPage kind="receivables" />;
export const PayablesPage = () => <AgingPage kind="payables" />;

/* ============================= Cash accounts ============================= */
const TX_TYPES = [
  ['CAPITAL_INJECTION', 'Owner capital injection'],
  ['OPENING_CASH', 'Opening balance'],
  ['LOAN_RECEIVED', 'Loan received'],
  ['TRANSFER', 'Transfer between accounts'],
  ['OTHER_INCOME', 'Other income'],
  ['OTHER_EXPENSE', 'Other (non-operating) expense'],
] as const;

export function CashAccountsPage() {
  const { can } = useAuth();
  const cash = useApi('/finance/cash');
  const [account, setAccount] = useState<string>(ACCOUNTS.CASH);
  const [period, setPeriod] = useState<PeriodValue>({ period: 'thisMonth' });
  const stmt = useApi(`/finance/cash-statement/${account}`, periodQuery(period));
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader
        title="Cash accounts"
        description="Cash on hand, bank and mobile money. Balances are the sum of every posted movement."
        actions={
          can('finance:write') && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <ArrowLeftRight /> Capital / transfer / other
            </Button>
          )
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {cash.data?.accounts.map((a: any) => (
          <button key={a.code} type="button" onClick={() => setAccount(a.code)} className="text-left cursor-pointer">
            <StatCard
              label={a.name}
              value={money(a.balance)}
              icon={Landmark}
              tone={a.balance < 0 ? 'destructive' : account === a.code ? 'success' : 'default'}
              hint={account === a.code ? 'Showing statement' : 'Click for statement'}
            />
          </button>
        ))}
        <StatCard label="Total" value={money(cash.data?.total)} loading={cash.isLoading} />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Select aria-label="Account" value={account} onChange={(e) => setAccount(e.target.value)} className="w-48">
              {CASH_ACCOUNTS.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </Select>
            <PeriodFilter value={period} onChange={setPeriod} />
          </div>
          {stmt.data && (
            <span className="text-sm">
              Opening <strong className="tabular">{money(stmt.data.opening)}</strong> → closing <strong className="tabular">{money(stmt.data.closing)}</strong>
            </span>
          )}
        </div>
        <DataTable
          rows={stmt.data?.rows}
          rowKey={(r, i) => `${r.entryNo}-${i}`}
          loading={stmt.isFetching}
          error={stmt.error}
          empty={<EmptyState title="No movements in this period" />}
          columns={[
            { key: 'd', header: 'Date', cell: (r) => dateTime(r.date) },
            { key: 'e', header: 'Entry', cell: (r) => <span className="font-mono text-xs">{r.entryNo}</span> },
            { key: 'r', header: 'Reference', cell: (r) => r.sourceRef },
            { key: 'm', header: 'Description', cell: (r) => r.memo },
            { key: 'i', header: 'In', align: 'right', cell: (r) => (r.inflow ? <span className="text-success">{money(r.inflow)}</span> : '') },
            { key: 'o', header: 'Out', align: 'right', cell: (r) => (r.outflow ? <span className="text-destructive">{money(r.outflow)}</span> : '') },
            { key: 'b', header: 'Balance', align: 'right', cell: (r) => <strong>{money(r.balance)}</strong> },
          ]}
        />
      </Card>
      {open && <CashTxDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function CashTxDialog({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<string>('CAPITAL_INJECTION');
  const [account, setAccount] = useState<string>(ACCOUNTS.CASH);
  const [fromAccount, setFrom] = useState<string>(ACCOUNTS.BANK);
  const [amount, setAmount] = useState<number | null>(null);
  const [memo, setMemo] = useState('');
  const [dt, setDt] = useState(todayInput());
  const act = useAction((b: object) => post('/finance/transactions', b), { success: 'Transaction posted', invalidate: ['/finance', '/reports'], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Record cash transaction" description="Owner capital, loans and transfers are balance-sheet movements — they never count as sales or expenses.">
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!amount || amount <= 0) return toast.error('Enter an amount');
            if (memo.trim().length < 3) return toast.error('Enter a description');
            if (type === 'TRANSFER' && account === fromAccount) return toast.error('Choose two different accounts');
            act.mutate({ type, amount, account, fromAccount: type === 'TRANSFER' ? fromAccount : undefined, memo, date: new Date(dt + 'T12:00:00Z').toISOString() });
          }}
        >
          <Field label="Type" className="sm:col-span-2">
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {TX_TYPES.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          {type === 'TRANSFER' && (
            <Field label="From account">
              <Select value={fromAccount} onChange={(e) => setFrom(e.target.value)}>
                {CASH_ACCOUNTS.map(([c, l]) => (
                  <option key={c} value={c}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={type === 'TRANSFER' ? 'To account' : type === 'OTHER_EXPENSE' ? 'Paid from' : 'Into account'}>
            <Select value={account} onChange={(e) => setAccount(e.target.value)}>
              {CASH_ACCOUNTS.map(([c, l]) => (
                <option key={c} value={c}>
                  {l}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount" required>
            <MoneyInput value={amount} onChange={setAmount} />
          </Field>
          <Field label="Date">
            <Input type="date" value={dt} onChange={(e) => setDt(e.target.value)} />
          </Field>
          <Field label="Description" required className="sm:col-span-2">
            <Input value={memo} onChange={(e) => setMemo(e.target.value)} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" loading={act.isPending}>
              Post
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ============================= General ledger ============================= */
export function GeneralLedgerPage() {
  const { can } = useAuth();
  const accounts = useApi<any[]>('/finance/accounts');
  const ls = useListState({ sort: '-date' });
  const journal = usePage('/finance/journal', { page: ls.page, limit: ls.limit, search: useDebounced(ls.search), ...ls.filters });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acct, setAcct] = useState<string>(ACCOUNTS.CASH);
  const [period, setPeriod] = useState<PeriodValue>({ period: 'thisMonth' });
  const ledger = useApi(`/finance/ledger/${acct}`, periodQuery(period));
  const [reverse, setReverse] = useState<any>(null);
  const rev = useAction((v: { id: string; reason: string }) => post(`/finance/journal/${v.id}/reverse`, { reason: v.reason }), {
    success: 'Reversal posted',
    invalidate: ['/finance', '/reports'],
    onSuccess: () => setReverse(null),
  });
  const nameOf = (code: string) => accounts.data?.find((a) => a.code === code)?.name ?? code;
  const toggle = (id: string) => setExpanded((s) => (s.has(id) ? (s.delete(id), new Set(s)) : new Set(s.add(id))));
  return (
    <div>
      <PageHeader
        title="General ledger"
        description="Every posted transaction as balanced double-entry journal entries. Entries are immutable; corrections are reversals."
        actions={<ExportMenu path="/reports/general-ledger" query={{ period: 'all' }} />}
      />
      <Tabs defaultValue="journal">
        <TabsList>
          <TabsTrigger value="journal">Journal</TabsTrigger>
          <TabsTrigger value="account">Account ledger</TabsTrigger>
          <TabsTrigger value="coa">Chart of accounts</TabsTrigger>
        </TabsList>
        <TabsContent value="journal">
          <Card>
            <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:flex-wrap">
              <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Entry no., memo, reference…" />
              <Select aria-label="Account" className="md:w-56" value={ls.filters.account ?? ''} onChange={(e) => ls.setFilter('account', e.target.value)}>
                <option value="">All accounts</option>
                {accounts.data?.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
              </Select>
              <Select aria-label="Source" className="md:w-48" value={ls.filters.sourceType ?? ''} onChange={(e) => ls.setFilter('sourceType', e.target.value)}>
                <option value="">All sources</option>
                {[
                  'SALE',
                  'CUSTOMER_PAYMENT',
                  'CUSTOMER_RETURN',
                  'PURCHASE_RECEIPT',
                  'SUPPLIER_PAYMENT',
                  'SUPPLIER_RETURN',
                  'STOCK_ADJUSTMENT',
                  'RETURN_INSPECTION',
                  'EXPENSE',
                  'CAPITAL',
                  'TRANSFER',
                  'OPENING_BALANCE',
                  'MANUAL',
                  'REVERSAL',
                ].map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
              <Input type="date" aria-label="From" className="md:w-40" value={ls.filters.from ?? ''} onChange={(e) => ls.setFilter('from', e.target.value)} />
              <Input type="date" aria-label="To" className="md:w-40" value={ls.filters.to ?? ''} onChange={(e) => ls.setFilter('to', e.target.value)} />
            </div>
            {journal.error ? (
              <ErrorState error={journal.error} />
            ) : !journal.data ? (
              <LoadingBlock />
            ) : journal.data.items.length === 0 ? (
              <EmptyState title="No journal entries" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH className="w-8" />
                    <TH>Entry</TH>
                    <TH>Date</TH>
                    <TH>Source</TH>
                    <TH>Memo</TH>
                    <TH className="text-right">Debit</TH>
                    <TH className="text-right">Credit</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {journal.data.items.map((j: any) => (
                    <Fragment key={j._id}>
                      <TR className="cursor-pointer" onClick={() => toggle(j._id)}>
                        <TD>{expanded.has(j._id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</TD>
                        <TD className="font-mono text-xs">{j.entryNo}</TD>
                        <TD>{dateTime(j.date)}</TD>
                        <TD>
                          <Badge variant="secondary">{titleCase(j.sourceType)}</Badge> <span className="text-xs">{j.sourceRef}</span>
                        </TD>
                        <TD className="max-w-80 truncate">
                          {j.memo} {j.reversedBy && <Badge variant="warning">Reversed</Badge>}
                        </TD>
                        <TD className="text-right tabular">{money(j.totalDebit)}</TD>
                        <TD className="text-right tabular">{money(j.totalCredit)}</TD>
                        <TD onClick={(e) => e.stopPropagation()}>
                          {can('finance:write') && ['MANUAL', 'CAPITAL', 'TRANSFER', 'OPENING_BALANCE'].includes(j.sourceType) && !j.reversedBy && !j.reversalOf && (
                            <Button variant="ghost" size="sm" onClick={() => setReverse(j)}>
                              <Undo2 /> Reverse
                            </Button>
                          )}
                        </TD>
                      </TR>
                      {expanded.has(j._id) &&
                        j.lines.map((l: any, i: number) => (
                          <TR key={i} className="bg-muted/30 text-xs">
                            <TD />
                            <TD colSpan={2} className={l.credit ? 'pl-10' : ''}>
                              <span className="font-mono">{l.accountCode}</span> {nameOf(l.accountCode)}
                            </TD>
                            <TD colSpan={2} className="text-muted-foreground">
                              {l.partyType && `${titleCase(l.partyType)} `}
                              {l.memo}
                            </TD>
                            <TD className="text-right tabular">{l.debit ? money(l.debit) : ''}</TD>
                            <TD className="text-right tabular">{l.credit ? money(l.credit) : ''}</TD>
                            <TD />
                          </TR>
                        ))}
                    </Fragment>
                  ))}
                </TBody>
              </Table>
            )}
            <Pagination page={ls.page} pages={journal.data?.pages ?? 1} total={journal.data?.total ?? 0} onPage={ls.setPage} limit={ls.limit} onLimit={ls.setLimit} />
          </Card>
        </TabsContent>
        <TabsContent value="account">
          <Card>
            <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Select aria-label="Ledger account" className="w-64" value={acct} onChange={(e) => setAcct(e.target.value)}>
                  {accounts.data?.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} {a.name}
                    </option>
                  ))}
                </Select>
                <PeriodFilter value={period} onChange={setPeriod} />
              </div>
              {ledger.data && (
                <span className="text-sm">
                  Opening <strong>{money(ledger.data.opening)}</strong> → closing <strong>{money(ledger.data.closing)}</strong> ({ledger.data.account.normal.toLowerCase()} balance)
                </span>
              )}
            </div>
            <DataTable
              rows={ledger.data?.rows}
              rowKey={(r, i) => `${r.entryNo}-${i}`}
              loading={ledger.isFetching}
              error={ledger.error}
              empty={<EmptyState title="No entries in this period" />}
              columns={[
                { key: 'd', header: 'Date', cell: (r) => dateTime(r.date) },
                { key: 'e', header: 'Entry', cell: (r) => <span className="font-mono text-xs">{r.entryNo}</span> },
                { key: 's', header: 'Source', cell: (r) => `${titleCase(r.sourceType)} ${r.sourceRef ?? ''}` },
                { key: 'm', header: 'Memo', cell: (r) => r.memo },
                { key: 'dr', header: 'Debit', align: 'right', cell: (r) => ((r.debit ?? r.inflow) ? money(r.debit ?? r.inflow) : '') },
                { key: 'cr', header: 'Credit', align: 'right', cell: (r) => ((r.credit ?? r.outflow) ? money(r.credit ?? r.outflow) : '') },
                { key: 'b', header: 'Balance', align: 'right', cell: (r) => <strong>{money(r.balance)}</strong> },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="coa">
          <Card>
            <DataTable
              rows={accounts.data}
              rowKey={(a) => a.code}
              loading={accounts.isLoading}
              columns={[
                { key: 'c', header: 'Code', cell: (a) => <span className="font-mono">{a.code}</span> },
                { key: 'n', header: 'Account', cell: (a) => a.name },
                { key: 't', header: 'Type', cell: (a) => titleCase(a.type) },
                { key: 'td', header: 'Total debits', align: 'right', cell: (a) => money(a.totalDebit) },
                { key: 'tc', header: 'Total credits', align: 'right', cell: (a) => money(a.totalCredit) },
                { key: 'b', header: 'Balance', align: 'right', cell: (a) => <strong>{a.debit ? `${money(a.debit)} Dr` : a.credit ? `${money(a.credit)} Cr` : money(0)}</strong> },
              ]}
            />
          </Card>
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={!!reverse}
        onOpenChange={(o) => !o && setReverse(null)}
        title={`Reverse ${reverse?.entryNo}?`}
        description="Posts an equal and opposite entry. The original entry is kept."
        requireReason
        destructive
        confirmLabel="Post reversal"
        loading={rev.isPending}
        onConfirm={(reason) => rev.mutate({ id: reverse._id, reason })}
      />
    </div>
  );
}

/* ============================== Profit & loss ============================== */
export function ProfitLossPage() {
  const [period, setPeriod] = useState<PeriodValue>({ period: 'thisMonth' });
  const q = useApi('/reports/profit-loss', periodQuery(period));
  return (
    <div>
      <PageHeader
        title="Profit and loss"
        description={q.data ? `${q.data.period.label}: ${date(q.data.period.from)} – ${date(new Date(new Date(q.data.period.to).getTime() - 1))}` : 'Income statement from the ledger'}
        actions={
          <>
            <PeriodFilter value={period} onChange={setPeriod} />
            <ExportMenu path="/reports/profit-loss" query={periodQuery(period)} />
          </>
        }
      />
      {q.isLoading ? <LoadingBlock /> : q.error ? <ErrorState error={q.error} retry={q.refetch} /> : <ProfitLossStatement pl={q.data} />}
    </div>
  );
}

export function ProfitLossStatement({ pl }: { pl: any }) {
  const row = (label: string, v: number, opts: { bold?: boolean; neg?: boolean; indent?: boolean; hint?: string } = {}) => (
    <div className={cn('flex justify-between border-b border-dashed py-2 text-sm', opts.bold && 'border-solid font-semibold', opts.indent && 'pl-6 text-muted-foreground')}>
      <span>
        {label}
        {opts.hint && <span className="ml-2 text-xs text-muted-foreground">{opts.hint}</span>}
      </span>
      <span className={cn('tabular', v < 0 && 'text-destructive')}>{opts.neg && v ? `(${money(v)})` : money(v)}</span>
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <Card className="p-5">
        {row('Gross sales', pl.grossSales)}
        {row('Less: discounts', pl.discounts, { neg: true, indent: true })}
        {row('Less: returns', pl.returns, { neg: true, indent: true })}
        {row('Net sales', pl.netSales, { bold: true })}
        {row('Cost of goods sold (FIFO)', pl.cogs, { neg: true })}
        {row('Gross profit', pl.grossProfit, { bold: true, hint: `${pl.grossMarginPct}% margin` })}
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operating expenses</p>
        {pl.expensesByCategory.map((e: any) => (
          <Fragment key={e.category}>{row(e.category, e.amount, { neg: true, indent: true })}</Fragment>
        ))}
        {pl.inventoryLoss ? row('Inventory shrinkage & damage', pl.inventoryLoss, { neg: true, indent: true }) : null}
        {row('Total operating expenses', pl.totalOperatingExpenses + (pl.inventoryLoss ?? 0), { neg: true })}
        {row('Operating profit', pl.operatingProfit, { bold: true, hint: `${pl.operatingMarginPct}% margin` })}
        {pl.otherIncome ? row('Other income', pl.otherIncome) : null}
        {pl.otherExpenses ? row('Other expenses', pl.otherExpenses, { neg: true }) : null}
        <div className={cn('mt-2 flex justify-between rounded-md px-3 py-3 text-base font-bold', pl.netProfit < 0 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success')}>
          <span>Net profit</span>
          <span className="tabular">{money(pl.netProfit)}</span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">Owner withdrawals, capital purchases and loan repayments are excluded from expenses by design.</p>
      </Card>
      <div className="grid content-start gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Expense breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyPieChart data={pl.expensesByCategory} nameKey="category" valueKey="amount" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <MoneyBarChart
              data={[
                { period: 'Net sales', value: pl.netSales },
                { period: 'COGS', value: pl.cogs },
                { period: 'Gross profit', value: pl.grossProfit },
                { period: 'Expenses', value: pl.totalOperatingExpenses },
                { period: 'Net profit', value: pl.netProfit },
              ]}
              series={[{ key: 'value', label: 'Amount' }]}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
