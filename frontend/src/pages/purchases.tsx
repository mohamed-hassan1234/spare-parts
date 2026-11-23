import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Ban, CheckCheck, CreditCard, PackageCheck, Pencil, Plus, Send, Trash2, Truck } from 'lucide-react';
import { get, newIdempotencyKey, patch, post, type Page } from '@/lib/api';
import { errorMessage, useAction, useApi, useDebounced, usePage, invalidatePrefixes } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { date, dateTime, money, refId, refName, titleCase, todayInput } from '@/lib/format';
import {
  AsyncPicker,
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
  Button,
  Card,
  CardContent,
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
import { searchProducts, type Product } from './catalog';

const METHODS = [
  ['CASH', 'Cash'],
  ['BANK_TRANSFER', 'Bank transfer'],
  ['MOBILE_MONEY', 'Mobile money'],
] as const;
export const methodLabel = (m: string) => ({ CASH: 'Cash', BANK_TRANSFER: 'Bank transfer', MOBILE_MONEY: 'Mobile money', STORE_CREDIT: 'Store credit' })[m] ?? m;

export const searchSuppliers = (search: string) => get<Page<any>>('/suppliers', { search, limit: 15, status: 'ACTIVE' }).then((r) => r.items);

/* ============================== Purchases ============================== */
export function PurchasesPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const ls = useListState({ sort: '-purchaseDate' });
  const search = useDebounced(ls.search);
  const list = usePage('/purchases', { page: ls.page, limit: ls.limit, sort: ls.sort, search, ...ls.filters });
  return (
    <div>
      <PageHeader
        title="Purchases"
        description="Purchase orders from draft to received and posted."
        actions={
          can('purchases:write') && (
            <Button size="sm" asChild>
              <Link to="/purchases/new">
                <Plus /> New purchase
              </Link>
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="PO number, supplier invoice…" />
          <Select aria-label="Status" className="sm:w-48" value={ls.filters.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {['DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'POSTED', 'CANCELLED'].map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          retry={list.refetch}
          sort={ls.sort}
          onSort={ls.setSort}
          onRowClick={(p) => nav(`/purchases/${p._id}`)}
          empty={<EmptyState icon={Truck} title="No purchases yet" />}
          columns={[
            { key: 'no', header: 'PO', sort: 'purchaseNo', cell: (p) => <span className="font-medium text-primary">{p.purchaseNo}</span> },
            { key: 'd', header: 'Date', sort: 'purchaseDate', cell: (p) => date(p.purchaseDate) },
            { key: 's', header: 'Supplier', cell: (p) => refName(p.supplierId) },
            { key: 'inv', header: 'Supplier invoice', cell: (p) => p.supplierInvoiceNo ?? '—' },
            { key: 't', header: 'Total', align: 'right', sort: 'total', cell: (p) => money(p.total) },
            { key: 'r', header: 'Received', align: 'right', cell: (p) => money(p.receivedValue) },
            { key: 'pd', header: 'Paid', align: 'right', cell: (p) => money(p.amountPaid) },
            { key: 'st', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} limit={ls.limit} onLimit={ls.setLimit} />
      </Card>
    </div>
  );
}

/* ============================ Purchase form ============================ */
interface Line {
  product: Product;
  qty: string;
  unitPrice: number | null;
  discount: number | null;
}

export function PurchaseFormPage() {
  const { id } = useParams();
  const existing = useApi(id ? `/purchases/${id}` : null);
  if (id && existing.isLoading) return <LoadingBlock rows={8} />;
  if (id && existing.error) return <ErrorState error={existing.error} />;
  return <PurchaseForm key={id ?? 'new'} purchase={existing.data} />;
}

function PurchaseForm({ purchase }: { purchase?: any }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [supplier, setSupplier] = useState<any>(purchase?.supplierId && typeof purchase.supplierId === 'object' ? purchase.supplierId : null);
  const [invoiceNo, setInvoiceNo] = useState(purchase?.supplierInvoiceNo ?? '');
  const [purchaseDate, setDate] = useState(purchase ? String(purchase.purchaseDate).slice(0, 10) : todayInput());
  const [freight, setFreight] = useState<number | null>(purchase?.freightCost ?? 0);
  const [customs, setCustoms] = useState<number | null>(purchase?.customsCost ?? 0);
  const [other, setOther] = useState<number | null>(purchase?.otherCost ?? 0);
  const [method, setMethod] = useState(purchase?.allocationMethod ?? 'VALUE');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    (purchase?.items ?? []).map((i: any) => ({ product: { _id: refId(i.productId), sku: i.sku, name: i.name } as Product, qty: String(i.qtyOrdered), unitPrice: i.unitPrice, discount: i.discount })),
  );
  const [pick, setPick] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);

  const subtotal = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (l.unitPrice ?? 0) - (l.discount ?? 0), 0);
  const extra = (freight ?? 0) + (customs ?? 0) + (other ?? 0);

  const submit = async (submitOrder: boolean) => {
    if (!supplier) return toast.error('Choose a supplier');
    if (!lines.length) return toast.error('Add at least one product');
    for (const l of lines) {
      if (!Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0) return toast.error(`${l.product.sku}: quantity must be a positive whole number`);
      if (l.unitPrice === null) return toast.error(`${l.product.sku}: enter a unit price`);
    }
    const body = {
      supplierId: supplier._id,
      supplierInvoiceNo: invoiceNo || undefined,
      purchaseDate: new Date(purchaseDate + 'T12:00:00Z').toISOString(),
      freightCost: freight ?? 0,
      customsCost: customs ?? 0,
      otherCost: other ?? 0,
      allocationMethod: method,
      notes: notes || undefined,
      items: lines.map((l) => ({ productId: l.product._id, qtyOrdered: Number(l.qty), unitPrice: l.unitPrice!, discount: l.discount ?? 0 })),
    };
    setBusy(true);
    try {
      let saved;
      if (purchase) {
        saved = await patch(`/purchases/${purchase._id}`, body);
        if (submitOrder) saved = await post(`/purchases/${purchase._id}/order`);
      } else saved = await post('/purchases', { ...body, submit: submitOrder });
      invalidatePrefixes(qc, ['/purchases']);
      toast.success(submitOrder ? 'Purchase order placed' : 'Draft saved');
      nav(`/purchases/${saved._id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={purchase ? `Edit ${purchase.purchaseNo}` : 'New purchase'}
        back={purchase ? `/purchases/${purchase._id}` : '/purchases'}
        description="Landed costs (freight, customs, other) are allocated to lines by the server and included in each item's FIFO cost."
        actions={
          <>
            <Button variant="outline" onClick={() => submit(false)} loading={busy}>
              Save draft
            </Button>
            <Button onClick={() => submit(true)} loading={busy}>
              <Send /> Place order
            </Button>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Items</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <AsyncPicker
              load={searchProducts}
              value={pick}
              onChange={(p) => {
                if (p) {
                  if (lines.some((l) => l.product._id === p._id)) toast.info(`${p.sku} is already on this purchase`);
                  else setLines((ls) => [...ls, { product: p, qty: String(p.reorderQuantity || 1), unitPrice: p.lastPurchaseCost ?? null, discount: 0 }]);
                }
                setPick(null);
              }}
              render={(x) => `${x.sku} — ${x.name}`}
              placeholder="Add product by name, SKU or part number…"
            />
            {lines.length === 0 ? (
              <EmptyState title="No items yet" description="Search above to add products." />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Product</TH>
                    <TH className="w-24 text-right">Qty</TH>
                    <TH className="w-36 text-right">Unit price</TH>
                    <TH className="w-32 text-right">Discount</TH>
                    <TH className="text-right">Line</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {lines.map((l, i) => {
                    const upd = (p: Partial<Line>) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, ...p } : x)));
                    return (
                      <TR key={l.product._id}>
                        <TD>
                          <div className="font-medium">{l.product.sku}</div>
                          <div className="text-xs text-muted-foreground">{l.product.name}</div>
                        </TD>
                        <TD>
                          <Input aria-label={`Quantity ${l.product.sku}`} type="number" min={1} className="text-right" value={l.qty} onChange={(e) => upd({ qty: e.target.value })} />
                        </TD>
                        <TD>
                          <MoneyInput aria-label={`Unit price ${l.product.sku}`} value={l.unitPrice} onChange={(c) => upd({ unitPrice: c })} />
                        </TD>
                        <TD>
                          <MoneyInput aria-label={`Discount ${l.product.sku}`} value={l.discount} onChange={(c) => upd({ discount: c })} />
                        </TD>
                        <TD className="text-right tabular">{money((Number(l.qty) || 0) * (l.unitPrice ?? 0) - (l.discount ?? 0))}</TD>
                        <TD>
                          <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                            <Trash2 />
                          </Button>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Supplier & references</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field label="Supplier" required>
                <AsyncPicker load={searchSuppliers} value={supplier} onChange={setSupplier} render={(s) => `${s.code ?? ''} ${s.name}`} placeholder="Search suppliers…" />
              </Field>
              <Field label="Supplier invoice number">
                <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
              </Field>
              <Field label="Purchase date" required>
                <Input type="date" value={purchaseDate} onChange={(e) => setDate(e.target.value)} />
              </Field>
              <Field label="Notes">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Landed costs</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field label="Freight">
                <MoneyInput value={freight} onChange={setFreight} />
              </Field>
              <Field label="Customs / duties">
                <MoneyInput value={customs} onChange={setCustoms} />
              </Field>
              <Field label="Other costs">
                <MoneyInput value={other} onChange={setOther} />
              </Field>
              <Field label="Allocate by">
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  <option value="VALUE">Line value</option>
                  <option value="QUANTITY">Quantity</option>
                  <option value="WEIGHT">Weight</option>
                </Select>
              </Field>
              <div className="space-y-1 border-t pt-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Goods subtotal</span>
                  <span className="tabular">{money(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Landed costs</span>
                  <span className="tabular">{money(extra)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Estimated total</span>
                  <span className="tabular">{money(subtotal + extra)}</span>
                </div>
                <p className="text-xs text-muted-foreground">Final figures are calculated by the server.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ============================ Purchase detail ============================ */
export function PurchaseDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi(`/purchases/${id}`);
  const [receive, setReceive] = useState(false);
  const [pay, setPay] = useState(false);
  const [cancel, setCancel] = useState(false);
  const inv = ['/purchases', '/inventory', '/products', '/suppliers', '/finance', '/supplier-payments', '/purchase-receipts'];
  const order = useAction(() => post(`/purchases/${id}/order`), { success: 'Purchase ordered', invalidate: inv });
  const postIt = useAction(() => post(`/purchases/${id}/post`), { success: 'Purchase posted and closed', invalidate: inv });
  const cancelIt = useAction((reason: string) => post(`/purchases/${id}/cancel`, { reason }), { success: 'Purchase cancelled', invalidate: inv, onSuccess: () => setCancel(false) });
  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const p = q.data;
  const canReceive = ['ORDERED', 'PARTIALLY_RECEIVED'].includes(p.status) && can('purchases:receive');
  const canPay = p.outstanding > 0 && can('purchases:pay') && p.status !== 'CANCELLED';
  return (
    <div>
      <PageHeader
        title={`Purchase ${p.purchaseNo}`}
        back="/purchases"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={p.status} /> {refName(p.supplierId)} · {date(p.purchaseDate)} {p.supplierInvoiceNo && `· Supplier invoice ${p.supplierInvoiceNo}`}
          </span>
        }
        actions={
          <>
            {p.status === 'DRAFT' && can('purchases:write') && (
              <>
                <Button variant="outline" size="sm" asChild>
                  <Link to={`/purchases/${p._id}/edit`}>
                    <Pencil /> Edit
                  </Link>
                </Button>
                <Button size="sm" onClick={() => order.mutate()} loading={order.isPending}>
                  <Send /> Place order
                </Button>
              </>
            )}
            {canReceive && (
              <Button size="sm" onClick={() => setReceive(true)}>
                <PackageCheck /> Receive goods
              </Button>
            )}
            {p.status === 'RECEIVED' && can('purchases:write') && (
              <Button size="sm" variant="outline" onClick={() => postIt.mutate()} loading={postIt.isPending}>
                <CheckCheck /> Post & close
              </Button>
            )}
            {canPay && (
              <Button size="sm" variant="success" onClick={() => setPay(true)}>
                <CreditCard /> Record payment
              </Button>
            )}
            {['DRAFT', 'ORDERED'].includes(p.status) && can('purchases:write') && (
              <Button size="sm" variant="ghost" onClick={() => setCancel(true)}>
                <Ban /> Cancel
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Order total" value={money(p.total)} hint={`Goods ${money(p.subtotal)} + landed ${money(p.extraTotal)}`} />
        <StatCard label="Received value" value={money(p.receivedValue)} />
        <StatCard label="Returned" value={money(p.returnedValue)} />
        <StatCard label="Paid" value={money(p.amountPaid)} />
        <StatCard label="Outstanding (payable)" value={money(p.outstanding)} tone={p.outstanding > 0 ? 'warning' : 'success'} />
      </div>
      <Card className="mb-4">
        <Table>
          <THead>
            <TR>
              <TH>Product</TH>
              <TH className="text-right">Ordered</TH>
              <TH className="text-right">Received</TH>
              <TH className="text-right">Unit price</TH>
              <TH className="text-right">Discount</TH>
              <TH className="text-right">Allocated extra</TH>
              <TH className="text-right">Landed cost</TH>
              <TH className="text-right">Landed / unit</TH>
            </TR>
          </THead>
          <TBody>
            {p.items.map((i: any) => (
              <TR key={i._id}>
                <TD>
                  <Link to={`/products/${refId(i.productId)}`} className="font-medium text-primary hover:underline">
                    {i.sku}
                  </Link>
                  <div className="text-xs text-muted-foreground">{i.name}</div>
                </TD>
                <TD className="text-right tabular">{i.qtyOrdered}</TD>
                <TD className={`text-right tabular ${i.qtyReceived < i.qtyOrdered ? 'text-warning' : 'text-success'}`}>{i.qtyReceived}</TD>
                <TD className="text-right tabular">{money(i.unitPrice)}</TD>
                <TD className="text-right tabular">{money(i.discount)}</TD>
                <TD className="text-right tabular">{money(i.extraCost)}</TD>
                <TD className="text-right tabular">{money(i.landedCost)}</TD>
                <TD className="text-right tabular">{money(Math.round(i.landedCost / i.qtyOrdered))}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <Tabs defaultValue="receipts">
        <TabsList>
          <TabsTrigger value="receipts">Goods received ({p.receipts.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments ({p.payments.length})</TabsTrigger>
          <TabsTrigger value="returns">Supplier returns ({p.returns?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="info">Details</TabsTrigger>
        </TabsList>
        <TabsContent value="receipts">
          <Card>
            <DataTable
              rows={p.receipts}
              empty={<EmptyState title="Nothing received yet" />}
              columns={[
                { key: 'no', header: 'GRN', cell: (r) => <span className="font-medium">{r.receiptNo}</span> },
                { key: 'd', header: 'Date', cell: (r) => dateTime(r.date) },
                { key: 'l', header: 'Lines', cell: (r) => r.lines.map((l: any) => `${p.items.find((i: any) => i._id === l.itemId)?.sku ?? ''} × ${l.qty}`).join(', ') },
                { key: 'c', header: 'Cost', align: 'right', cell: (r) => money(r.totalCost) },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsTable rows={p.payments} />
        </TabsContent>
        <TabsContent value="returns">
          <Card>
            <DataTable
              rows={p.returns}
              empty={<EmptyState title="No supplier returns" />}
              columns={[
                { key: 'n', header: 'Return', cell: (r) => r.returnNo },
                { key: 'd', header: 'Date', cell: (r) => date(r.date ?? r.createdAt) },
                { key: 'v', header: 'Value', align: 'right', cell: (r) => money(r.totalCost) },
                { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="info">
          <Card>
            <CardContent className="pt-5">
              <KeyValue
                items={[
                  ['Supplier', refName(p.supplierId)],
                  ['Allocation method', titleCase(p.allocationMethod)],
                  ['Freight', money(p.freightCost)],
                  ['Customs', money(p.customsCost)],
                  ['Other costs', money(p.otherCost)],
                  ['Due date', date(p.dueDate)],
                  ['Ordered at', dateTime(p.orderedAt)],
                  ['Notes', p.notes],
                  ['Cancel reason', p.cancelReason],
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      {receive && <ReceiveDialog purchase={p} onClose={() => setReceive(false)} />}
      {pay && <SupplierPaymentDialog supplier={p.supplierId} purchase={p} onClose={() => setPay(false)} />}
      <ConfirmDialog
        open={cancel}
        onOpenChange={setCancel}
        title={`Cancel ${p.purchaseNo}?`}
        description="Only purchases with no receipts or payments can be cancelled."
        requireReason
        destructive
        confirmLabel="Cancel purchase"
        loading={cancelIt.isPending}
        onConfirm={(r) => cancelIt.mutate(r)}
      />
    </div>
  );
}

function PaymentsTable({ rows }: { rows?: any[] }) {
  return (
    <Card>
      <DataTable
        rows={rows}
        empty={<EmptyState title="No payments recorded" />}
        columns={[
          { key: 'no', header: 'Payment', cell: (r) => <span className="font-medium">{r.paymentNo}</span> },
          { key: 'd', header: 'Date', cell: (r) => dateTime(r.date) },
          { key: 'm', header: 'Method', cell: (r) => methodLabel(r.method) },
          { key: 'ref', header: 'Reference', cell: (r) => r.reference ?? '' },
          { key: 'a', header: 'Amount', align: 'right', cell: (r) => money(r.amount) },
        ]}
      />
    </Card>
  );
}

function ReceiveDialog({ purchase, onClose }: { purchase: any; onClose: () => void }) {
  const open = purchase.items.filter((i: any) => i.qtyReceived < i.qtyOrdered);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map((i: any) => [i._id, String(i.qtyOrdered - i.qtyReceived)])));
  const [notes, setNotes] = useState('');
  // One key per dialog: double-clicks and network retries cannot receive the same goods twice.
  const key = useMemo(() => newIdempotencyKey('recv'), []);
  const act = useAction((b: object) => post(`/purchases/${purchase._id}/receive`, b, key), {
    success: (r: any) => (r.replayed ? 'Already received (duplicate request ignored)' : `Received ${r.receipt.receiptNo}`),
    invalidate: ['/purchases', '/inventory', '/products', '/suppliers', '/finance', '/purchase-receipts'],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={`Receive goods — ${purchase.purchaseNo}`}
        description="Creates FIFO cost layers at landed cost, stock movements, and Dr Inventory / Cr Accounts Payable — all in one transaction."
        wide
      >
        <Table>
          <THead>
            <TR>
              <TH>Product</TH>
              <TH className="text-right">Ordered</TH>
              <TH className="text-right">Already received</TH>
              <TH className="w-32 text-right">Receive now</TH>
            </TR>
          </THead>
          <TBody>
            {open.map((i: any) => (
              <TR key={i._id}>
                <TD>
                  {i.sku} — {i.name}
                </TD>
                <TD className="text-right tabular">{i.qtyOrdered}</TD>
                <TD className="text-right tabular">{i.qtyReceived}</TD>
                <TD>
                  <Input
                    type="number"
                    min={0}
                    max={i.qtyOrdered - i.qtyReceived}
                    aria-label={`Receive ${i.sku}`}
                    className="text-right"
                    value={qty[i._id] ?? ''}
                    onChange={(e) => setQty((q) => ({ ...q, [i._id]: e.target.value }))}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={act.isPending}
            onClick={() => {
              const lines = Object.entries(qty)
                .map(([itemId, v]) => ({ itemId, qty: Number(v) }))
                .filter((l) => l.qty > 0);
              if (!lines.length) return toast.error('Enter a quantity to receive');
              if (lines.some((l) => !Number.isInteger(l.qty))) return toast.error('Quantities must be whole numbers');
              act.mutate({ lines, notes: notes || undefined });
            }}
          >
            <PackageCheck /> Confirm receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SupplierPaymentDialog({ supplier, purchase, onClose }: { supplier?: any; purchase?: any; onClose: () => void }) {
  const [sup, setSup] = useState<any>(supplier && typeof supplier === 'object' ? supplier : null);
  const [amount, setAmount] = useState<number | null>(purchase?.outstanding ?? null);
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const key = useMemo(() => newIdempotencyKey('spay'), []);
  const act = useAction((b: object) => (purchase ? post(`/purchases/${purchase._id}/payments`, b, key) : post('/supplier-payments', b, key)), {
    success: 'Supplier payment recorded',
    invalidate: ['/purchases', '/suppliers', '/finance', '/supplier-payments', '/reports'],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title="Pay supplier"
        description={purchase ? `Against ${purchase.purchaseNo} — outstanding ${money(purchase.outstanding)}` : 'Payments on account are allocated to the oldest unpaid purchases.'}
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sup && !purchase) return toast.error('Choose a supplier');
            if (!amount || amount <= 0) return toast.error('Enter an amount');
            const base = { amount, method, reference: reference || undefined, notes: notes || undefined };
            act.mutate(purchase ? base : { ...base, supplierId: sup._id });
          }}
        >
          {!purchase && (
            <Field label="Supplier" required>
              <AsyncPicker
                load={searchSuppliers}
                value={sup}
                onChange={setSup}
                render={(s) => (
                  <span>
                    {s.name} <span className="text-muted-foreground">· owed {money(s.payable)}</span>
                  </span>
                )}
              />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" required>
              <MoneyInput value={amount} onChange={setAmount} />
            </Field>
            <Field label="Paid from">
              <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                {METHODS.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Reference" hint="Transfer number, receipt number…">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
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

/* ============================ Receipts list ============================ */
export function ReceiptsPage() {
  const ls = useListState({ sort: '-date' });
  const list = usePage('/purchase-receipts', { page: ls.page, limit: ls.limit, search: useDebounced(ls.search) });
  return (
    <div>
      <PageHeader title="Purchase receipts" description="Goods received notes (GRN). Each receipt created FIFO layers and a payable." />
      <Card>
        <div className="border-b p-3">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="GRN number…" />
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          empty={<EmptyState icon={PackageCheck} title="No goods received yet" />}
          columns={[
            { key: 'no', header: 'GRN', cell: (r) => <span className="font-medium">{r.receiptNo}</span> },
            { key: 'd', header: 'Date', cell: (r) => dateTime(r.date) },
            {
              key: 'po',
              header: 'Purchase',
              cell: (r) => (
                <Link className="text-primary hover:underline" to={`/purchases/${refId(r.purchaseId)}`}>
                  {refName(r.purchaseId, 'purchaseNo')}
                </Link>
              ),
            },
            { key: 's', header: 'Supplier', cell: (r) => refName(r.supplierId) },
            { key: 'l', header: 'Items', cell: (r) => r.lines.map((l: any) => `${refName(l.productId, 'sku')} × ${l.qty}`).join(', ') },
            { key: 'c', header: 'Cost', align: 'right', cell: (r) => money(r.totalCost) },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
    </div>
  );
}

/* ============================== Suppliers ============================== */
export function SuppliersPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const ls = useListState({ sort: 'name' });
  const list = usePage('/suppliers', { page: ls.page, limit: ls.limit, sort: ls.sort, search: useDebounced(ls.search), ...ls.filters });
  const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Who you buy from and how much you owe each one."
        actions={
          can('suppliers:write') && (
            <Button size="sm" onClick={() => setEdit({})}>
              <Plus /> New supplier
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Name, code, phone…" />
          <Select aria-label="Status" className="sm:w-36" value={ls.filters.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)}>
            <option value="">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          sort={ls.sort}
          onSort={ls.setSort}
          onRowClick={(s) => nav(`/suppliers/${s._id}`)}
          empty={<EmptyState icon={Truck} title="No suppliers yet" />}
          columns={[
            { key: 'c', header: 'Code', cell: (s) => s.code },
            { key: 'n', header: 'Name', sort: 'name', cell: (s) => <span className="font-medium">{s.name}</span> },
            { key: 'p', header: 'Contact', cell: (s) => [s.contactPerson, s.phone].filter(Boolean).join(' · ') },
            { key: 'l', header: 'Location', cell: (s) => [s.city, s.country].filter(Boolean).join(', ') },
            { key: 't', header: 'Terms', cell: (s) => `${s.paymentTermsDays ?? 0} days` },
            { key: 'b', header: 'Payable', align: 'right', cell: (s) => <span className={s.payable > 0 ? 'font-medium text-warning' : ''}>{money(s.payable)}</span> },
            { key: 'st', header: 'Status', cell: (s) => <StatusBadge status={s.status} /> },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
      {edit && <PartyDialog kind="supplier" entity={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

export function PartyDialog({ kind, entity, onClose }: { kind: 'supplier' | 'customer'; entity: any; onClose: () => void }) {
  const isNew = !entity._id;
  const path = kind === 'supplier' ? '/suppliers' : '/customers';
  const [st, setSt] = useState<any>({
    name: entity.name ?? '',
    phone: entity.phone ?? '',
    email: entity.email ?? '',
    address: entity.address ?? '',
    contactPerson: entity.contactPerson ?? '',
    city: entity.city ?? '',
    country: entity.country ?? '',
    paymentTermsDays: entity.paymentTermsDays ?? (kind === 'supplier' ? 30 : 0),
    creditLimit: entity.creditLimit ?? 0,
    type: entity.type ?? 'INDIVIDUAL',
    status: entity.status ?? 'ACTIVE',
    notes: entity.notes ?? '',
  });
  const set = (k: string, v: unknown) => setSt((s: any) => ({ ...s, [k]: v }));
  const act = useAction(
    () => {
      const common = { name: st.name, phone: st.phone, email: st.email, address: st.address, paymentTermsDays: Number(st.paymentTermsDays) || 0, status: st.status, notes: st.notes };
      const body = kind === 'supplier' ? { ...common, contactPerson: st.contactPerson, city: st.city, country: st.country } : { ...common, type: st.type, creditLimit: st.creditLimit ?? 0 };
      return isNew ? post(path, body) : patch(`${path}/${entity._id}`, body);
    },
    { success: `${kind === 'supplier' ? 'Supplier' : 'Customer'} saved`, invalidate: [path], onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`${isNew ? 'New' : 'Edit'} ${kind}`} wide>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (st.name.trim().length < 2) return toast.error('Name is required');
            if (st.email && !/^\S+@\S+\.\S+$/.test(st.email)) return toast.error('Email address is not valid');
            act.mutate();
          }}
        >
          <Field label="Name" required className="sm:col-span-2">
            <Input value={st.name} onChange={(e) => set('name', e.target.value)} autoFocus />
          </Field>
          {kind === 'supplier' && (
            <Field label="Contact person">
              <Input value={st.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} />
            </Field>
          )}
          {kind === 'customer' && (
            <Field label="Customer type">
              <Select value={st.type} onChange={(e) => set('type', e.target.value)}>
                {['INDIVIDUAL', 'GARAGE', 'BUSINESS', 'FLEET', 'WALK_IN'].map((t) => (
                  <option key={t} value={t}>
                    {titleCase(t)}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="Phone">
            <Input value={st.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
          </Field>
          <Field label="Email">
            <Input value={st.email} onChange={(e) => set('email', e.target.value)} type="email" />
          </Field>
          {kind === 'supplier' && (
            <>
              <Field label="City">
                <Input value={st.city} onChange={(e) => set('city', e.target.value)} />
              </Field>
              <Field label="Country">
                <Input value={st.country} onChange={(e) => set('country', e.target.value)} />
              </Field>
            </>
          )}
          <Field label="Address" className="sm:col-span-2">
            <Input value={st.address} onChange={(e) => set('address', e.target.value)} />
          </Field>
          <Field label="Payment terms (days)">
            <Input type="number" min={0} value={st.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value)} />
          </Field>
          {kind === 'customer' && (
            <Field label="Credit limit" hint="0 = cash only (no credit sales)">
              <MoneyInput value={st.creditLimit} onChange={(c) => set('creditLimit', c ?? 0)} />
            </Field>
          )}
          <Field label="Status">
            <Select value={st.status} onChange={(e) => set('status', e.target.value)}>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              {kind === 'customer' && <option value="BLOCKED">Blocked</option>}
            </Select>
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={st.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <DialogFooter className="sm:col-span-2">
            <Button type="submit" loading={act.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function StatementCard({ path, partyLabel }: { path: string; partyLabel: string }) {
  const [period, setPeriod] = useState<PeriodValue>({ period: 'all' });
  const q = useApi(path, periodQuery(period));
  return (
    <Card>
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center sm:justify-between">
        <PeriodFilter value={period} onChange={setPeriod} />
        <ExportMenu path={path} query={periodQuery(period)} />
      </div>
      {q.data && (
        <div className="flex flex-wrap gap-6 px-4 py-3 text-sm">
          <span>
            Opening balance: <strong className="tabular">{money(q.data.opening)}</strong>
          </span>
          <span>
            Closing balance ({partyLabel}): <strong className="tabular">{money(q.data.closing)}</strong>
          </span>
        </div>
      )}
      <DataTable
        rows={q.data?.rows}
        rowKey={(r, i) => `${r.entryNo}-${i}`}
        loading={q.isFetching}
        error={q.error}
        empty={<EmptyState title="No transactions in this period" />}
        columns={[
          { key: 'd', header: 'Date', cell: (r) => dateTime(r.date) },
          { key: 'r', header: 'Reference', cell: (r) => <span className="font-medium">{r.reference ?? r.sourceRef}</span> },
          { key: 't', header: 'Type', cell: (r) => titleCase(r.type) },
          { key: 'm', header: 'Description', cell: (r) => r.memo },
          { key: 'i', header: 'Increase', align: 'right', cell: (r) => (r.increase ? money(r.increase) : '') },
          { key: 'x', header: 'Decrease', align: 'right', cell: (r) => (r.decrease ? money(r.decrease) : '') },
          { key: 'b', header: 'Balance', align: 'right', cell: (r) => <strong>{money(r.balance)}</strong> },
        ]}
      />
    </Card>
  );
}

export function SupplierDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi(`/suppliers/${id}`);
  const [edit, setEdit] = useState(false);
  const [pay, setPay] = useState(false);
  if (q.isLoading) return <LoadingBlock rows={8} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const s = q.data;
  return (
    <div>
      <PageHeader
        title={s.name}
        back="/suppliers"
        description={
          <span className="flex flex-wrap items-center gap-2">
            {s.code} <StatusBadge status={s.status} /> {[s.contactPerson, s.phone, s.email].filter(Boolean).join(' · ')}
          </span>
        }
        actions={
          <>
            {can('suppliers:write') && (
              <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
                <Pencil /> Edit
              </Button>
            )}
            {can('purchases:pay') && s.payable > 0 && (
              <Button size="sm" variant="success" onClick={() => setPay(true)}>
                <CreditCard /> Pay supplier
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Outstanding payable" value={money(s.payable)} tone={s.payable > 0 ? 'warning' : 'success'} />
        <StatCard label="Total purchased" value={money(s.totalPurchased)} />
        <StatCard label="Total paid" value={money(s.totalPaid)} />
        <StatCard label="Returned" value={money(s.totalReturned)} />
        <StatCard label="Supplier credit" value={money(s.supplierCredit)} hint={`Last purchase ${date(s.lastPurchaseDate)}`} />
      </div>
      <Tabs defaultValue="purchases">
        <TabsList>
          <TabsTrigger value="purchases">Purchases ({s.purchases.length})</TabsTrigger>
          <TabsTrigger value="payments">Payments ({s.payments.length})</TabsTrigger>
          <TabsTrigger value="returns">Returns ({s.returns.length})</TabsTrigger>
          <TabsTrigger value="statement">Statement</TabsTrigger>
        </TabsList>
        <TabsContent value="purchases">
          <Card>
            <DataTable
              rows={s.purchases}
              empty={<EmptyState title="No purchases" />}
              columns={[
                {
                  key: 'n',
                  header: 'PO',
                  cell: (p) => (
                    <Link to={`/purchases/${p._id}`} className="font-medium text-primary hover:underline">
                      {p.purchaseNo}
                    </Link>
                  ),
                },
                { key: 'd', header: 'Date', cell: (p) => date(p.purchaseDate) },
                { key: 'i', header: 'Invoice', cell: (p) => p.supplierInvoiceNo ?? '' },
                { key: 't', header: 'Total', align: 'right', cell: (p) => money(p.total) },
                { key: 'pd', header: 'Paid', align: 'right', cell: (p) => money(p.amountPaid) },
                { key: 'du', header: 'Due', cell: (p) => date(p.dueDate) },
                { key: 's', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="payments">
          <PaymentsTable rows={s.payments} />
        </TabsContent>
        <TabsContent value="returns">
          <Card>
            <DataTable
              rows={s.returns}
              empty={<EmptyState title="No returns" />}
              columns={[
                { key: 'n', header: 'Return', cell: (r) => r.returnNo },
                { key: 'd', header: 'Date', cell: (r) => date(r.createdAt) },
                { key: 'r', header: 'Reason', cell: (r) => titleCase(r.reason) },
                { key: 'v', header: 'Value', align: 'right', cell: (r) => money(r.totalCost) },
                { key: 's', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="statement">
          <StatementCard path={`/suppliers/${s._id}/statement`} partyLabel="owed to supplier" />
        </TabsContent>
      </Tabs>
      {edit && <PartyDialog kind="supplier" entity={s} onClose={() => setEdit(false)} />}
      {pay && <SupplierPaymentDialog supplier={s} onClose={() => setPay(false)} />}
    </div>
  );
}

/* ========================== Supplier payments ========================== */
export function SupplierPaymentsPage() {
  const { can } = useAuth();
  const ls = useListState({ sort: '-date' });
  const list = usePage('/supplier-payments', { page: ls.page, limit: ls.limit, search: useDebounced(ls.search) });
  const [open, setOpen] = useState(false);
  return (
    <div>
      <PageHeader
        title="Supplier payments"
        description="Money paid to suppliers. Each payment reduces Accounts Payable and the paying account."
        actions={
          can('purchases:pay') && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus /> Pay supplier
            </Button>
          )
        }
      />
      <Card>
        <div className="border-b p-3">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Payment number, reference…" />
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          empty={<EmptyState icon={CreditCard} title="No supplier payments" />}
          columns={[
            { key: 'no', header: 'Payment', cell: (r) => <span className="font-medium">{r.paymentNo}</span> },
            { key: 'd', header: 'Date', cell: (r) => dateTime(r.date) },
            {
              key: 's',
              header: 'Supplier',
              cell: (r) => (
                <Link className="text-primary hover:underline" to={`/suppliers/${refId(r.supplierId)}`}>
                  {refName(r.supplierId)}
                </Link>
              ),
            },
            {
              key: 'p',
              header: 'Purchase',
              cell: (r) =>
                r.purchaseId ? (
                  <Link className="hover:underline" to={`/purchases/${refId(r.purchaseId)}`}>
                    {refName(r.purchaseId, 'purchaseNo')}
                  </Link>
                ) : (
                  'On account'
                ),
            },
            { key: 'm', header: 'Method', cell: (r) => methodLabel(r.method) },
            { key: 'ref', header: 'Reference', cell: (r) => r.reference ?? '' },
            { key: 'a', header: 'Amount', align: 'right', cell: (r) => money(r.amount) },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
      {open && <SupplierPaymentDialog onClose={() => setOpen(false)} />}
    </div>
  );
}
