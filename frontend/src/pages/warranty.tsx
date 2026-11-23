import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PackageCheck, Plus, ShieldCheck, Trash2, Undo2 } from 'lucide-react';
import { get, patch, post, type Page } from '@/lib/api';
import { useAction, useDebounced, usePage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { date, dateTime, money, refId, refName, titleCase } from '@/lib/format';
import { AsyncPicker, DataTable, EmptyState, PageHeader, Pagination, SearchInput, useListState } from '@/components/common';
import { Button, Card, Checkbox, Dialog, DialogContent, DialogFooter, Field, Input, Select, StatusBadge, Table, TBody, TD, TH, THead, TR, Textarea } from '@/components/ui';
import { searchProducts, type Product } from './catalog';
import { searchSuppliers } from './purchases';

/* =========================== Warranty claims =========================== */
export function WarrantyPage() {
  const { can } = useAuth();
  const ls = useListState({ sort: '-createdAt' });
  const list = usePage('/warranty-claims', { page: ls.page, limit: ls.limit, search: useDebounced(ls.search), ...ls.filters });
  const [edit, setEdit] = useState<any>(null);
  return (
    <div>
      <PageHeader title="Warranty claims" description="Claims are opened from an invoice line (Sales → invoice → Claim) and checked against the warranty period sold." />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Claim, invoice, customer…" />
          <Select aria-label="Status" className="sm:w-44" value={ls.filters.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {['OPEN', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'RESOLVED'].map((s) => (
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
          onRowClick={can('warranty:write') ? setEdit : undefined}
          empty={<EmptyState icon={ShieldCheck} title="No warranty claims" />}
          columns={[
            { key: 'n', header: 'Claim', cell: (c) => <span className="font-medium">{c.claimNo}</span> },
            { key: 'd', header: 'Opened', cell: (c) => date(c.createdAt) },
            { key: 'p', header: 'Product', cell: (c) => c.productName },
            { key: 'c', header: 'Customer', cell: (c) => c.customerName },
            {
              key: 'i',
              header: 'Invoice',
              cell: (c) => (
                <Link className="text-primary hover:underline" to={`/sales/${refId(c.saleId)}`} onClick={(e) => e.stopPropagation()}>
                  {c.invoiceNo}
                </Link>
              ),
            },
            { key: 'w', header: 'Warranty until', cell: (c) => date(c.warrantyEnd) },
            { key: 'is', header: 'Issue', cell: (c) => <span className="line-clamp-2 max-w-64">{c.issue}</span> },
            { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
            { key: 'r', header: 'Resolution', cell: (c) => (c.resolution ? titleCase(c.resolution) : '') },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
      {edit && <ClaimDialog claim={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function ClaimDialog({ claim, onClose }: { claim: any; onClose: () => void }) {
  const closed = ['RESOLVED', 'REJECTED'].includes(claim.status);
  const [status, setStatus] = useState(claim.status);
  const [note, setNote] = useState('');
  const [resolution, setResolution] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [replaceFromStock, setReplace] = useState(true);
  const act = useAction((b: object) => patch(`/warranty-claims/${claim._id}`, b), {
    success: 'Claim updated',
    invalidate: ['/warranty-claims', '/inventory', '/products', '/finance'],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Warranty claim ${claim.claimNo}`} description={`${claim.productName} · ${claim.customerName} · ${claim.invoiceNo}`} wide>
        <p className="rounded-md bg-muted p-3 text-sm">{claim.issue}</p>
        {claim.notes?.length > 0 && (
          <ul className="space-y-1 text-sm">
            {claim.notes.map((n: any, i: number) => (
              <li key={i}>
                <span className="text-xs text-muted-foreground">{dateTime(n.at)}</span> — {n.text}
              </li>
            ))}
          </ul>
        )}
        {closed ? (
          <p className="text-sm">
            Closed as <strong>{titleCase(claim.resolution)}</strong>. {claim.resolutionNotes} {claim.replacementCost ? `Replacement cost ${money(claim.replacementCost)}.` : ''}
          </p>
        ) : (
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              act.mutate({
                status: resolution ? undefined : status,
                note: note || undefined,
                resolution: resolution || undefined,
                resolutionNotes: resolutionNotes || undefined,
                replaceFromStock: resolution === 'REPLACED' ? replaceFromStock : undefined,
              });
            }}
          >
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} disabled={!!resolution}>
                {['OPEN', 'IN_REVIEW', 'APPROVED'].map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Resolve claim">
              <Select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                <option value="">Not yet</option>
                {['REPLACED', 'REPAIRED', 'REFUNDED', 'REJECTED', 'OTHER'].map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </Field>
            {resolution === 'REPLACED' && (
              <Checkbox
                className="sm:col-span-2"
                label="Issue the replacement from stock (FIFO cost recorded as inventory loss)"
                checked={replaceFromStock}
                onChange={(e) => setReplace(e.target.checked)}
              />
            )}
            {resolution === 'REFUNDED' && (
              <p className="text-xs text-muted-foreground sm:col-span-2">To pay money back, process a return on the original invoice so revenue and stock are reversed correctly.</p>
            )}
            {resolution && (
              <Field label="Resolution notes" className="sm:col-span-2">
                <Input value={resolutionNotes} onChange={(e) => setResolutionNotes(e.target.value)} />
              </Field>
            )}
            <Field label="Add note" className="sm:col-span-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <DialogFooter className="sm:col-span-2">
              <Button type="submit" loading={act.isPending}>
                Save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* =========================== Supplier returns =========================== */
export function SupplierReturnsPage() {
  const { can } = useAuth();
  const ls = useListState({ sort: '-createdAt' });
  const list = usePage('/supplier-returns', { page: ls.page, limit: ls.limit, search: useDebounced(ls.search), ...ls.filters });
  const [open, setOpen] = useState(false);
  const replace = useAction((id: string) => post(`/supplier-returns/${id}/replacement`), {
    success: 'Replacement received into stock',
    invalidate: ['/supplier-returns', '/inventory', '/products', '/suppliers', '/finance'],
  });
  return (
    <div>
      <PageHeader
        title="Supplier returns"
        description="Send faulty or wrong goods back to the supplier for credit or replacement. Stock leaves at its FIFO cost."
        actions={
          can('purchases:write') && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus /> New supplier return
            </Button>
          )
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Return number…" />
          <Select aria-label="Status" className="sm:w-52" value={ls.filters.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            <option value="CREDITED">Credited</option>
            <option value="AWAITING_REPLACEMENT">Awaiting replacement</option>
            <option value="REPLACED">Replaced</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          empty={<EmptyState icon={Undo2} title="No supplier returns" />}
          columns={[
            { key: 'n', header: 'Return', cell: (r) => <span className="font-medium">{r.returnNo}</span> },
            { key: 'd', header: 'Date', cell: (r) => date(r.createdAt) },
            {
              key: 's',
              header: 'Supplier',
              cell: (r) =>
                r.supplierId ? (
                  <Link className="text-primary hover:underline" to={`/suppliers/${refId(r.supplierId)}`}>
                    {refName(r.supplierId) || 'Supplier'}
                  </Link>
                ) : (
                  '—'
                ),
            },
            {
              key: 'p',
              header: 'Purchase',
              cell: (r) =>
                r.purchaseId ? (
                  <Link className="hover:underline" to={`/purchases/${refId(r.purchaseId)}`}>
                    {refName(r.purchaseId, 'purchaseNo') || 'View'}
                  </Link>
                ) : (
                  '—'
                ),
            },
            { key: 'l', header: 'Items', cell: (r) => r.lines.map((l: any) => `${l.sku} × ${l.qty}`).join(', ') },
            { key: 'r', header: 'Reason', cell: (r) => titleCase(r.reason) },
            { key: 'st', header: 'Settlement', cell: (r) => titleCase(r.settlement) },
            { key: 'v', header: 'Cost value', align: 'right', cell: (r) => money(r.totalCost) },
            { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status === 'AWAITING_REPLACEMENT' ? 'PENDING' : r.status === 'CREDITED' ? 'POSTED' : 'COMPLETED'} /> },
            {
              key: 'x',
              header: '',
              align: 'right',
              cell: (r) =>
                r.status === 'AWAITING_REPLACEMENT' &&
                can('purchases:receive') && (
                  <Button size="sm" variant="outline" onClick={() => replace.mutate(r._id)} loading={replace.isPending && replace.variables === r._id}>
                    <PackageCheck /> Receive replacement
                  </Button>
                ),
            },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
      {open && <SupplierReturnDialog onClose={() => setOpen(false)} />}
    </div>
  );
}

function SupplierReturnDialog({ onClose }: { onClose: () => void }) {
  const [supplier, setSupplier] = useState<any>(null);
  const [purchaseId, setPurchaseId] = useState('');
  const [purchases, setPurchases] = useState<any[]>([]);
  const [reason, setReason] = useState('DEFECTIVE');
  const [settlement, setSettlement] = useState('CREDIT');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<{ p: Product; qty: string }[]>([]);
  const [pick, setPick] = useState<Product | null>(null);
  const act = useAction((b: object) => post('/supplier-returns', b), {
    success: (r: any) => `Supplier return ${r.returnNo} recorded`,
    invalidate: ['/supplier-returns', '/inventory', '/products', '/suppliers', '/purchases', '/finance'],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Return goods to supplier" wide>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier" required>
            <AsyncPicker
              load={searchSuppliers}
              value={supplier}
              onChange={async (s) => {
                setSupplier(s);
                setPurchaseId('');
                setPurchases(s ? (await get<Page<any>>('/purchases', { supplierId: s._id, limit: 50 })).items.filter((p) => p.receivedValue > 0) : []);
              }}
              render={(s) => s.name}
            />
          </Field>
          <Field label="Original purchase" hint="Recommended so the return links to its source">
            <Select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)} disabled={!supplier}>
              <option value="">Not linked</option>
              {purchases.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.purchaseNo} · {date(p.purchaseDate)} · {money(p.receivedValue)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Reason">
            <Select value={reason} onChange={(e) => setReason(e.target.value)}>
              {['DEFECTIVE', 'DAMAGED', 'INCORRECT_ITEM', 'OTHER'].map((r) => (
                <option key={r} value={r}>
                  {titleCase(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Settlement">
            <Select value={settlement} onChange={(e) => setSettlement(e.target.value)}>
              <option value="CREDIT">Credit (reduces what we owe)</option>
              <option value="REPLACEMENT">Replacement goods</option>
            </Select>
          </Field>
        </div>
        <AsyncPicker
          load={searchProducts}
          value={pick}
          onChange={(p) => {
            if (p && !lines.some((l) => l.p._id === p._id)) setLines((ls) => [...ls, { p, qty: '1' }]);
            setPick(null);
          }}
          render={(x) => `${x.sku} — ${x.name} (${x.qtyAvailable ?? 0} available)`}
          placeholder="Add product to return…"
        />
        {lines.length > 0 && (
          <Table>
            <THead>
              <TR>
                <TH>Product</TH>
                <TH className="text-right">Available</TH>
                <TH className="w-28 text-right">Qty</TH>
                <TH />
              </TR>
            </THead>
            <TBody>
              {lines.map((l, i) => (
                <TR key={l.p._id}>
                  <TD>
                    {l.p.sku} — {l.p.name}
                  </TD>
                  <TD className="text-right tabular">{l.p.qtyAvailable ?? 0}</TD>
                  <TD>
                    <Input
                      type="number"
                      min={1}
                      aria-label={`Return qty ${l.p.sku}`}
                      className="text-right"
                      value={l.qty}
                      onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
                    />
                  </TD>
                  <TD>
                    <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <DialogFooter>
          <Button
            loading={act.isPending}
            onClick={() => {
              if (!supplier) return toast.error('Choose a supplier');
              if (!lines.length) return toast.error('Add at least one product');
              if (lines.some((l) => !Number.isInteger(Number(l.qty)) || Number(l.qty) <= 0)) return toast.error('Quantities must be positive whole numbers');
              act.mutate({
                supplierId: supplier._id,
                purchaseId: purchaseId || undefined,
                reason,
                settlement,
                notes: notes || undefined,
                lines: lines.map((l) => ({ productId: l.p._id, qty: Number(l.qty) })),
              });
            }}
          >
            Record return
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
