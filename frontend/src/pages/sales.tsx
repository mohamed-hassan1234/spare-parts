import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CreditCard, FileText, Printer, Receipt, RotateCcw, ShieldCheck } from 'lucide-react';
import { fileUrl, newIdempotencyKey, post } from '@/lib/api';
import { useAction, useApi, useDebounced, usePage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { cn, date, dateTime, money, refId, titleCase } from '@/lib/format';
import { DataTable, EmptyState, ErrorState, LoadingBlock, MoneyInput, PageHeader, Pagination, SearchInput, StatCard, useListState, type Column } from '@/components/common';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
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
  Textarea,
} from '@/components/ui';
import { methodLabel } from './purchases';

const invalidations = ['/sales', '/customers', '/finance', '/reports', '/customer-payments', '/returns', '/inventory', '/products', '/warranty-claims'];

function SalesList({ title, description, invoiceMode }: { title: string; description: string; invoiceMode?: boolean }) {
  const nav = useNavigate();
  const { can } = useAuth();
  const ls = useListState({ sort: '-date' });
  const search = useDebounced(ls.search);
  const list = usePage('/sales', { page: ls.page, limit: ls.limit, sort: ls.sort, search, ...ls.filters });
  const cols: Column<any>[] = [
    { key: 'no', header: 'Invoice', sort: 'invoiceNo', cell: (s) => <span className="font-medium text-primary">{s.invoiceNo}</span> },
    { key: 'd', header: 'Date', sort: 'date', cell: (s) => dateTime(s.date) },
    { key: 'c', header: 'Customer', cell: (s) => s.customerName },
    { key: 'i', header: 'Items', cell: (s) => <span className="text-xs text-muted-foreground">{s.items?.map((i: any) => `${i.sku} × ${i.qty}`).join(', ')}</span> },
    { key: 't', header: 'Total', align: 'right', sort: 'total', cell: (s) => money(s.total) },
    { key: 'b', header: 'Balance', align: 'right', cell: (s) => <span className={s.balanceDue > 0 ? 'font-medium text-warning' : ''}>{money(s.balanceDue)}</span> },
    { key: 'gp', header: 'Gross profit', align: 'right', cell: (s) => money(s.grossProfit) },
    { key: 'ps', header: 'Payment', cell: (s) => <StatusBadge status={s.paymentStatus} /> },
    { key: 'st', header: 'Status', cell: (s) => (s.status !== 'COMPLETED' ? <StatusBadge status={s.status} /> : null) },
  ];
  if (invoiceMode)
    cols.push({
      key: 'pr',
      header: 'Print',
      cell: (s) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" asChild aria-label={`A4 invoice ${s.invoiceNo}`}>
            <a href={fileUrl(`/sales/${s._id}/invoice`, { format: 'a4' })} target="_blank" rel="noreferrer">
              <FileText />
            </a>
          </Button>
          <Button variant="ghost" size="icon" asChild aria-label={`Receipt ${s.invoiceNo}`}>
            <a href={fileUrl(`/sales/${s._id}/invoice`, { format: 'thermal' })} target="_blank" rel="noreferrer">
              <Printer />
            </a>
          </Button>
        </div>
      ),
    });
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          can('sales:create') && (
            <Button size="sm" asChild>
              <Link to="/pos">New sale</Link>
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:flex-wrap">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Invoice, customer…" />
          <Select aria-label="Payment status" className="md:w-40" value={ls.filters.paymentStatus ?? ''} onChange={(e) => ls.setFilter('paymentStatus', e.target.value)}>
            <option value="">All payments</option>
            <option value="PAID">Paid</option>
            <option value="PARTIAL">Partially paid</option>
            <option value="UNPAID">Unpaid</option>
          </Select>
          <Select aria-label="Status" className="md:w-44" value={ls.filters.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            <option value="COMPLETED">Completed</option>
            <option value="PARTIALLY_RETURNED">Partially returned</option>
            <option value="RETURNED">Returned</option>
          </Select>
          <Input type="date" aria-label="From date" className="md:w-40" value={ls.filters.from ?? ''} onChange={(e) => ls.setFilter('from', e.target.value)} />
          <Input type="date" aria-label="To date" className="md:w-40" value={ls.filters.to ?? ''} onChange={(e) => ls.setFilter('to', e.target.value)} />
        </div>
        <DataTable
          columns={cols}
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          retry={list.refetch}
          sort={ls.sort}
          onSort={ls.setSort}
          onRowClick={(s) => nav(`/sales/${s._id}`)}
          empty={<EmptyState icon={Receipt} title="No sales found" />}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} limit={ls.limit} onLimit={ls.setLimit} />
      </Card>
    </div>
  );
}

export const SalesPage = () => <SalesList title="Sales history" description="Every completed sale with its revenue, COGS and payment state." />;
export const InvoicesPage = () => <SalesList invoiceMode title="Invoices" description="Issued invoices. PDFs are generated from the stored invoice, so reprints always match the original." />;

/* ============================== Sale detail ============================== */
export function SaleDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi(`/sales/${id}`);
  const [pay, setPay] = useState(false);
  const [ret, setRet] = useState(false);
  const [warranty, setWarranty] = useState<any>(null);
  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const s = q.data;
  const returnable = s.items.some((i: any) => i.qtyReturned < i.qty);
  return (
    <div>
      <PageHeader
        title={`Invoice ${s.invoiceNo}`}
        back="/sales"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {dateTime(s.date)} ·{' '}
            {s.customerId ? (
              <Link className="text-primary hover:underline" to={`/customers/${refId(s.customerId)}`}>
                {s.customerName}
              </Link>
            ) : (
              s.customerName
            )}{' '}
            <StatusBadge status={s.paymentStatus} /> {s.status !== 'COMPLETED' && <StatusBadge status={s.status} />}
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <a href={fileUrl(`/sales/${s._id}/invoice`, { format: 'thermal' })} target="_blank" rel="noreferrer">
                <Printer /> Receipt
              </a>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={fileUrl(`/sales/${s._id}/invoice`, { format: 'a4' })} target="_blank" rel="noreferrer">
                <FileText /> A4 invoice (PDF)
              </a>
            </Button>
            {s.balanceDue > 0 && s.customerId && can('customers:pay') && (
              <Button size="sm" variant="success" onClick={() => setPay(true)}>
                <CreditCard /> Receive payment
              </Button>
            )}
            {returnable && can('sales:return') && (
              <Button size="sm" variant="outline" onClick={() => setRet(true)}>
                <RotateCcw /> Return items
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total" value={money(s.total)} hint={s.taxTotal ? `incl. tax ${money(s.taxTotal)}` : undefined} />
        <StatCard label="Paid" value={money(s.amountPaid)} />
        <StatCard label="Returned" value={money(s.returnedAmount)} hint={s.refundedAmount ? `Refunded ${money(s.refundedAmount)}` : undefined} />
        <StatCard label="Balance due" value={money(s.balanceDue)} tone={s.balanceDue > 0 ? 'warning' : 'success'} hint={s.dueDate ? `Due ${date(s.dueDate)}` : undefined} />
        <StatCard label="Cost of goods (FIFO)" value={money(s.cogsTotal)} />
        <StatCard label="Gross profit" value={money(s.grossProfit)} tone="success" hint={s.netSales ? `${((s.grossProfit / s.netSales) * 100).toFixed(1)}% margin` : undefined} />
      </div>
      <Card className="mb-4">
        <Table>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH className="text-right">Qty</TH>
              <TH className="text-right">Unit price</TH>
              <TH className="text-right">Discount</TH>
              <TH className="text-right">Line total</TH>
              <TH className="text-right">COGS</TH>
              <TH className="text-right">Returned</TH>
              <TH>Warranty</TH>
            </TR>
          </THead>
          <TBody>
            {s.items.map((i: any) => (
              <TR key={i._id}>
                <TD>
                  <Link to={`/products/${refId(i.productId)}`} className="font-medium text-primary hover:underline">
                    {i.sku}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {i.name} {i.brand && `· ${i.brand}`}
                  </div>
                </TD>
                <TD className="text-right tabular">{i.qty}</TD>
                <TD className="text-right tabular">{money(i.unitPrice)}</TD>
                <TD className="text-right tabular">{money(i.discount + i.cartDiscountShare)}</TD>
                <TD className="text-right tabular">{money(i.lineTotal)}</TD>
                <TD className="text-right tabular text-muted-foreground" title={i.allocations.map((a: any) => `${a.qty} @ ${money(Math.round(a.cost / a.qty))}`).join(', ')}>
                  {money(i.cogs)}
                </TD>
                <TD className="text-right tabular">{i.qtyReturned || ''}</TD>
                <TD>
                  {i.warrantyMonths ? (
                    <span className="flex items-center gap-2">
                      <Badge variant="outline">{i.warrantyMonths} mo</Badge>
                      {can('warranty:write') && (
                        <Button variant="ghost" size="sm" onClick={() => setWarranty(i)}>
                          <ShieldCheck /> Claim
                        </Button>
                      )}
                    </span>
                  ) : (
                    '—'
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Payments & refunds</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <DataTable
              rows={s.payments}
              empty={<EmptyState title="No payments" />}
              columns={[
                { key: 'n', header: 'Receipt', cell: (p) => p.paymentNo },
                { key: 'd', header: 'Date', cell: (p) => dateTime(p.date) },
                { key: 'm', header: 'Method', cell: (p) => `${methodLabel(p.method)}${p.kind === 'REFUND' ? ' (refund)' : ''}` },
                {
                  key: 'a',
                  header: 'Amount',
                  align: 'right',
                  cell: (p) => <span className={p.kind === 'REFUND' ? 'text-destructive' : ''}>{money(p.allocations?.find((a: any) => a.saleId === s._id)?.amount ?? p.amount)}</span>,
                },
              ]}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Returns</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <DataTable
              rows={s.returns}
              empty={<EmptyState title="No returns" />}
              columns={[
                { key: 'n', header: 'Return', cell: (r) => r.returnNo },
                { key: 'd', header: 'Date', cell: (r) => dateTime(r.date) },
                { key: 'l', header: 'Items', cell: (r) => r.lines.map((l: any) => `${l.sku} × ${l.qty} (${titleCase(l.condition)})`).join(', ') },
                { key: 'a', header: 'Amount', align: 'right', cell: (r) => money(r.totalAmount) },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      {s.notes && <p className="mt-4 text-sm text-muted-foreground">Notes: {s.notes}</p>}
      <p className="mt-2 text-xs text-muted-foreground">Recorded by {s.createdByName ?? '—'}.</p>
      {pay && <SalePaymentDialog sale={s} onClose={() => setPay(false)} />}
      {ret && <ReturnDialog sale={s} onClose={() => setRet(false)} />}
      {warranty && <WarrantyClaimDialog sale={s} item={warranty} onClose={() => setWarranty(null)} />}
    </div>
  );
}

function SalePaymentDialog({ sale, onClose }: { sale: any; onClose: () => void }) {
  const [amount, setAmount] = useState<number | null>(sale.balanceDue);
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const key = useMemo(() => newIdempotencyKey('cpay'), []);
  const act = useAction((b: object) => post(`/sales/${sale._id}/payments`, b, key), { success: 'Payment recorded', invalidate: invalidations, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Receive payment — ${sale.invoiceNo}`} description={`Balance due ${money(sale.balanceDue)}`}>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!amount || amount <= 0) return toast.error('Enter an amount');
            if (amount > sale.balanceDue) return toast.error('Amount exceeds the balance due');
            act.mutate({ amount, method, reference: reference || undefined });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" required>
              <MoneyInput value={amount} onChange={setAmount} autoFocus />
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

function ReturnDialog({ sale, onClose }: { sale: any; onClose: () => void }) {
  const items = sale.items.filter((i: any) => i.qtyReturned < i.qty);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cond, setCond] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState('CASH');
  const key = useMemo(() => newIdempotencyKey('ret'), []);
  const act = useAction((b: object) => post(`/sales/${sale._id}/returns`, b, key), {
    success: (r: any) => (r.replayed ? 'Return already processed (duplicate ignored)' : `Return ${r.ret.returnNo} recorded${r.ret.refundAmount ? ` — refund ${money(r.ret.refundAmount)}` : ''}`),
    invalidate: invalidations,
    onSuccess: onClose,
  });
  const estimate = items.reduce((s: number, i: any) => {
    const n = Number(qty[i._id] ?? 0);
    return s + (n > 0 ? Math.round(((i.lineTotal - i.returnedTotal) * n) / (i.qty - i.qtyReturned)) : 0);
  }, 0);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Return items — ${sale.invoiceNo}`}
        description="Refunds use the original invoice price. Good items go back to stock at their original cost; damaged items are written off; uninspected items are quarantined."
        wide
      >
        <Table>
          <THead>
            <TR>
              <TH>Item</TH>
              <TH className="text-right">Returnable</TH>
              <TH className="w-24 text-right">Qty</TH>
              <TH className="w-48">Condition</TH>
            </TR>
          </THead>
          <TBody>
            {items.map((i: any) => (
              <TR key={i._id}>
                <TD>
                  {i.sku} — {i.name}
                  <div className="text-xs text-muted-foreground">Paid {money(Math.round(i.lineTotal / i.qty))} each</div>
                </TD>
                <TD className="text-right tabular">{i.qty - i.qtyReturned}</TD>
                <TD>
                  <Input
                    type="number"
                    min={0}
                    max={i.qty - i.qtyReturned}
                    aria-label={`Return qty ${i.sku}`}
                    className="text-right"
                    value={qty[i._id] ?? ''}
                    onChange={(e) => setQty((q) => ({ ...q, [i._id]: e.target.value }))}
                  />
                </TD>
                <TD>
                  <Select aria-label={`Condition ${i.sku}`} value={cond[i._id] ?? 'PENDING_INSPECTION'} onChange={(e) => setCond((c) => ({ ...c, [i._id]: e.target.value }))}>
                    <option value="PENDING_INSPECTION">Needs inspection</option>
                    <option value="GOOD">Good — restock</option>
                    <option value="DAMAGED">Damaged — write off</option>
                  </Select>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Reason" required>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Wrong fitment, defective…" />
          </Field>
          <Field label="Refund any excess paid via" hint="If the customer owes nothing after the return, the excess is refunded this way.">
            <Select value={refundMethod} onChange={(e) => setRefundMethod(e.target.value)}>
              <option value="CASH">Cash</option>
              <option value="MOBILE_MONEY">Mobile money</option>
              <option value="BANK_TRANSFER">Bank transfer</option>
              {sale.customerId && <option value="STORE_CREDIT">Store credit</option>}
            </Select>
          </Field>
        </div>
        <p className="text-sm">
          Estimated return value: <strong className="tabular">{money(estimate)}</strong> <span className="text-xs text-muted-foreground">(final amount calculated by the server)</span>
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={act.isPending}
            onClick={() => {
              const lines = items
                .map((i: any) => ({ saleItemId: i._id, qty: Number(qty[i._id] ?? 0), condition: cond[i._id] ?? 'PENDING_INSPECTION', max: i.qty - i.qtyReturned }))
                .filter((l: any) => l.qty > 0);
              if (!lines.length) return toast.error('Enter a quantity to return');
              if (lines.some((l: any) => !Number.isInteger(l.qty) || l.qty > l.max)) return toast.error('Return quantity exceeds what can be returned');
              if (reason.trim().length < 3) return toast.error('Enter a reason');
              act.mutate({ reason, refundMethod, lines: lines.map(({ max: _m, ...l }: any) => l) });
            }}
          >
            <RotateCcw /> Process return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WarrantyClaimDialog({ sale, item, onClose }: { sale: any; item: any; onClose: () => void }) {
  const [issue, setIssue] = useState('');
  const act = useAction((b: object) => post('/warranty-claims', b), { success: (r: any) => `Warranty claim ${r.claimNo} opened`, invalidate: ['/warranty-claims'], onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Open warranty claim" description={`${item.sku} — ${item.name} on ${sale.invoiceNo} (${item.warrantyMonths} months from ${date(sale.date)})`}>
        <Field label="Problem reported" required>
          <Textarea value={issue} onChange={(e) => setIssue(e.target.value)} autoFocus />
        </Field>
        <DialogFooter>
          <Button loading={act.isPending} onClick={() => (issue.trim().length < 3 ? toast.error('Describe the issue') : act.mutate({ saleId: sale._id, saleItemId: item._id, issue }))}>
            Open claim
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================= Returns list ============================= */
export function ReturnsPage() {
  const { can } = useAuth();
  const ls = useListState({ sort: '-date' });
  const list = usePage('/returns', { page: ls.page, limit: ls.limit, search: useDebounced(ls.search), ...ls.filters });
  const [inspect, setInspect] = useState<{ ret: any; line: any } | null>(null);
  return (
    <div>
      <PageHeader title="Customer returns" description="Returns always reference the original invoice. Items awaiting inspection never return to sellable stock until approved." />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Return or invoice number…" />
          <Checkbox label="Only awaiting inspection" checked={ls.filters.pending === 'true'} onChange={(e) => ls.setFilter('pending', e.target.checked ? 'true' : '')} />
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          empty={<EmptyState icon={RotateCcw} title="No returns" />}
          columns={[
            { key: 'n', header: 'Return', cell: (r) => <span className="font-medium">{r.returnNo}</span> },
            { key: 'd', header: 'Date', cell: (r) => dateTime(r.date) },
            {
              key: 'i',
              header: 'Invoice',
              cell: (r) => (
                <Link className="text-primary hover:underline" to={`/sales/${refId(r.saleId)}`}>
                  {r.invoiceNo}
                </Link>
              ),
            },
            {
              key: 'l',
              header: 'Items',
              cell: (r) => (
                <ul className="space-y-1">
                  {r.lines.map((l: any) => (
                    <li key={l.saleItemId} className="flex flex-wrap items-center gap-2 text-sm">
                      {l.sku} × {l.qty}
                      <Badge variant={l.condition === 'GOOD' ? 'success' : l.condition === 'DAMAGED' ? 'destructive' : 'warning'}>{titleCase(l.condition)}</Badge>
                      {l.inspection?.decision && <Badge variant="outline">{titleCase(l.inspection.decision)}</Badge>}
                      {l.condition === 'PENDING_INSPECTION' && !l.inspection?.decision && can('sales:return') && (
                        <Button size="sm" variant="outline" onClick={() => setInspect({ ret: r, line: l })}>
                          Inspect
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              ),
            },
            { key: 'r', header: 'Reason', cell: (r) => r.reason },
            { key: 'a', header: 'Value', align: 'right', cell: (r) => money(r.totalAmount) },
            { key: 'rf', header: 'Refunded', align: 'right', cell: (r) => (r.refundAmount ? `${money(r.refundAmount)} (${methodLabel(r.refundMethod)})` : '—') },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
      {inspect && <InspectDialog {...inspect} onClose={() => setInspect(null)} />}
    </div>
  );
}

function InspectDialog({ ret, line, onClose }: { ret: any; line: any; onClose: () => void }) {
  const [decision, setDecision] = useState<'RESTOCK' | 'WRITE_OFF'>('RESTOCK');
  const [notes, setNotes] = useState('');
  const act = useAction((b: object) => post(`/returns/${ret._id}/inspect`, b), { success: 'Inspection recorded', invalidate: invalidations, onSuccess: onClose });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Inspect ${line.sku} × ${line.qty}`}
        description={`From ${ret.returnNo}. Restocking puts it back into sellable stock at its original cost (${money(line.cost)}); write-off records an inventory loss.`}
      >
        <div className="grid grid-cols-2 gap-2">
          {(['RESTOCK', 'WRITE_OFF'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDecision(d)}
              className={cn('rounded-lg border p-3 text-left text-sm cursor-pointer', decision === d && 'border-primary bg-primary/5 ring-1 ring-primary')}
            >
              <strong>{d === 'RESTOCK' ? 'Restock' : 'Write off'}</strong>
              <p className="text-xs text-muted-foreground">{d === 'RESTOCK' ? 'Item is in sellable condition' : 'Item is damaged or unusable'}</p>
            </button>
          ))}
        </div>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button loading={act.isPending} onClick={() => act.mutate({ saleItemId: line.saleItemId, decision, notes: notes || undefined })}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
