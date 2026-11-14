import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { MOVEMENT_TYPES } from '@autoparts/shared';
import { get, post } from '@/lib/api';
import { useAction, useApi, useDebounced, usePage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { dateTime, money, num, refName, titleCase } from '@/lib/format';
import { AsyncPicker, ConfirmDialog, DataTable, EmptyState, ExportMenu, MoneyInput, PageHeader, Pagination, SearchInput, StatCard, useListState, type Column } from '@/components/common';
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
import { searchProducts, StockBadge, type Product } from './catalog';

/* ============================ Stock overview ============================ */
export function StockOverviewPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const ls = useListState({ sort: 'name' });
  const search = useDebounced(ls.search);
  const list = usePage<Product>('/inventory', { page: ls.page, limit: ls.limit, sort: ls.sort, search, ...ls.filters });
  const val = useApi('/inventory/valuation');
  const cats = useApi<any[]>('/categories');
  const [adjust, setAdjust] = useState(false);
  const valueBy = new Map<string, any>((val.data?.rows ?? []).map((r: any) => [String(r.productId), r]));
  const cols: Column<Product>[] = [
    {
      key: 'sku',
      header: 'SKU',
      sort: 'sku',
      cell: (p) => (
        <Link className="font-medium text-primary hover:underline" to={`/products/${p._id}`} onClick={(e) => e.stopPropagation()}>
          {p.sku}
        </Link>
      ),
    },
    { key: 'n', header: 'Product', sort: 'name', cell: (p) => p.name },
    { key: 'loc', header: 'Shelf', cell: (p) => p.storageLocation ?? '—' },
    { key: 'oh', header: 'On hand', align: 'right', cell: (p) => num(p.qtyOnHand) },
    { key: 'res', header: 'Reserved', align: 'right', cell: (p) => num((p.qtyOnHand ?? 0) - (p.qtyAvailable ?? 0)) },
    { key: 'av', header: 'Available', align: 'right', cell: (p) => <StockBadge p={p} /> },
    { key: 'rp', header: 'Reorder pt', align: 'right', cell: (p) => p.reorderPoint },
    { key: 'v', header: 'FIFO value', align: 'right', cell: (p) => money(valueBy.get(p._id)?.value ?? 0) },
    { key: 'age', header: 'Oldest (days)', align: 'right', cell: (p) => valueBy.get(p._id)?.oldestStockDays ?? '—' },
  ];
  return (
    <div>
      <PageHeader
        title="Stock overview"
        description="Quantities come from the immutable movement ledger; values from remaining FIFO cost layers."
        actions={
          <>
            <ExportMenu path="/inventory/valuation" />
            {can('inventory:adjust') && (
              <Button size="sm" onClick={() => setAdjust(true)}>
                <Plus /> Stock adjustment
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Inventory value" value={money(val.data?.totalValue)} loading={val.isLoading} hint="Σ remaining FIFO layer cost" />
        <StatCard label="Units on hand" value={num(val.data?.totalUnits)} loading={val.isLoading} />
        <StatCard label="Low stock" value={num(val.data?.lowStock?.length)} tone="warning" loading={val.isLoading} to="/inventory/low-stock" />
        <StatCard label="Out of stock" value={num(val.data?.outOfStock?.length)} tone="destructive" loading={val.isLoading} to="/inventory/low-stock" />
      </div>
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Search SKU, name, part number…" />
          <Select aria-label="Category" className="sm:w-44" value={ls.filters.categoryId ?? ''} onChange={(e) => ls.setFilter('categoryId', e.target.value)}>
            <option value="">All categories</option>
            {cats.data?.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Stock status" className="sm:w-36" value={ls.filters.stock ?? ''} onChange={(e) => ls.setFilter('stock', e.target.value)}>
            <option value="">Any stock</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </Select>
        </div>
        <DataTable
          columns={cols}
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          retry={list.refetch}
          sort={ls.sort}
          onSort={ls.setSort}
          onRowClick={(p) => nav(`/products/${p._id}`)}
          empty={<EmptyState title="No products match" />}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} limit={ls.limit} onLimit={ls.setLimit} />
      </Card>
      {adjust && <AdjustmentDialog onClose={() => setAdjust(false)} />}
    </div>
  );
}

/* ============================ Stock movements ============================ */
export function MovementsPage() {
  const ls = useListState({ sort: '-at' });
  const search = useDebounced(ls.search);
  const list = usePage('/inventory/movements', { page: ls.page, limit: ls.limit, sort: ls.sort, search, ...ls.filters });
  return (
    <div>
      <PageHeader title="Stock movements" description="Every stock change is an immutable ledger entry with its source document." />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="SKU, product or reference…" />
          <Select aria-label="Movement type" className="sm:w-48" value={ls.filters.type ?? ''} onChange={(e) => ls.setFilter('type', e.target.value)}>
            <option value="">All types</option>
            {MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
          </Select>
          <Input type="date" aria-label="From" className="sm:w-40" value={ls.filters.from ?? ''} onChange={(e) => ls.setFilter('from', e.target.value)} />
          <Input type="date" aria-label="To" className="sm:w-40" value={ls.filters.to ?? ''} onChange={(e) => ls.setFilter('to', e.target.value)} />
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          retry={list.refetch}
          sort={ls.sort}
          onSort={ls.setSort}
          empty={<EmptyState title="No movements found" />}
          columns={[
            { key: 'at', header: 'Date', sort: 'at', cell: (m) => dateTime(m.at) },
            {
              key: 'p',
              header: 'Product',
              cell: (m) => (
                <Link className="text-primary hover:underline" to={`/products/${m.productId?._id}`}>
                  {refName(m.productId, 'sku')}
                </Link>
              ),
            },
            { key: 'n', header: 'Name', cell: (m) => refName(m.productId) },
            { key: 't', header: 'Type', cell: (m) => <Badge variant="secondary">{titleCase(m.type)}</Badge> },
            { key: 'r', header: 'Reference', cell: (m) => m.sourceRef },
            {
              key: 'q',
              header: 'Qty',
              align: 'right',
              cell: (m) => (
                <span className={m.qty < 0 ? 'text-destructive' : 'text-success'}>
                  {m.qty > 0 ? '+' : ''}
                  {m.qty}
                </span>
              ),
            },
            { key: 'c', header: 'Cost', align: 'right', cell: (m) => money(m.costAmount) },
            { key: 'b', header: 'Balance after', align: 'right', cell: (m) => m.balanceAfter },
            { key: 'why', header: 'Reason', cell: (m) => m.reason ?? '' },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} limit={ls.limit} onLimit={ls.setLimit} />
      </Card>
    </div>
  );
}

/* ============================ Adjustments ============================ */
const REASONS = ['COUNT_CORRECTION', 'DAMAGE', 'THEFT_OR_LOSS', 'EXPIRED', 'FOUND', 'OPENING_BALANCE', 'DATA_CORRECTION', 'OTHER'];

export function AdjustmentsPage() {
  const { can } = useAuth();
  const ls = useListState({ sort: '-createdAt' });
  const list = usePage('/inventory/adjustments', { page: ls.page, limit: ls.limit, ...ls.filters });
  const [open, setOpen] = useState(false);
  const [reject, setReject] = useState<any>(null);
  const approve = useAction((id: string) => post(`/inventory/adjustments/${id}/approve`), { success: 'Adjustment approved and posted', invalidate: ['/inventory', '/products'] });
  const rej = useAction((v: { id: string; reason: string }) => post(`/inventory/adjustments/${v.id}/reject`, { reason: v.reason }), {
    success: 'Adjustment rejected',
    invalidate: ['/inventory'],
    onSuccess: () => setReject(null),
  });
  return (
    <div>
      <PageHeader
        title="Stock adjustments"
        description="Corrections require a reason. Pending adjustments change nothing until approved; approved ones post movements and ledger entries."
        actions={
          can('inventory:adjust') && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <Plus /> New adjustment
            </Button>
          )
        }
      />
      <Card>
        <div className="flex gap-2 border-b p-3">
          <Select aria-label="Status" className="w-44" value={ls.filters.status ?? ''} onChange={(e) => ls.setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            <option value="PENDING">Pending</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          empty={<EmptyState title="No adjustments" />}
          columns={[
            { key: 'no', header: 'No.', cell: (a) => <span className="font-medium">{a.adjustmentNo}</span> },
            { key: 'd', header: 'Date', cell: (a) => dateTime(a.createdAt) },
            { key: 'p', header: 'Product', cell: (a) => `${refName(a.productId, 'sku')} — ${refName(a.productId)}` },
            {
              key: 'q',
              header: 'Qty',
              align: 'right',
              cell: (a) => (
                <span className={a.qtyChange < 0 ? 'text-destructive' : 'text-success'}>
                  {a.qtyChange > 0 ? '+' : ''}
                  {a.qtyChange}
                </span>
              ),
            },
            { key: 'c', header: 'Cost impact', align: 'right', cell: (a) => money(a.costImpact ?? (a.unitCost ? a.unitCost * a.qtyChange : null)) },
            {
              key: 'r',
              header: 'Reason',
              cell: (a) => (
                <div>
                  <div>{titleCase(a.reason)}</div>
                  <div className="text-xs text-muted-foreground">{a.notes}</div>
                </div>
              ),
            },
            { key: 'by', header: 'Requested by', cell: (a) => refName(a.requestedBy, 'fullName') },
            { key: 's', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
            {
              key: 'x',
              header: '',
              align: 'right',
              cell: (a) =>
                a.status === 'PENDING' && can('inventory:adjust') ? (
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="success" loading={approve.isPending && approve.variables === a._id} onClick={() => approve.mutate(a._id)}>
                      Approve
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setReject(a)}>
                      Reject
                    </Button>
                  </div>
                ) : null,
            },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
      {open && <AdjustmentDialog onClose={() => setOpen(false)} />}
      <ConfirmDialog
        open={!!reject}
        onOpenChange={(o) => !o && setReject(null)}
        title={`Reject ${reject?.adjustmentNo}?`}
        requireReason
        confirmLabel="Reject"
        destructive
        loading={rej.isPending}
        onConfirm={(reason) => rej.mutate({ id: reject._id, reason })}
      />
    </div>
  );
}

export function AdjustmentDialog({ onClose, product }: { onClose: () => void; product?: Product }) {
  const [p, setP] = useState<Product | null>(product ?? null);
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('DAMAGE');
  const [notes, setNotes] = useState('');
  const [unitCost, setUnitCost] = useState<number | null>(null);
  const [approveNow, setApproveNow] = useState(true);
  const act = useAction((b: object) => post('/inventory/adjustments', b), {
    success: (r: any) => (r.status === 'APPROVED' ? 'Adjustment posted' : 'Adjustment submitted for approval'),
    invalidate: ['/inventory', '/products'],
    onSuccess: onClose,
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Stock adjustment" description="Use for damage, loss, found stock and corrections. Every adjustment keeps its reason and is audited.">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(qty);
            if (!p) return toast.error('Choose a product');
            if (!Number.isInteger(n) || n <= 0) return toast.error('Quantity must be a positive whole number');
            if (notes.trim().length < 3) return toast.error('Explain the adjustment in the notes');
            if (dir === 'in' && !unitCost) return toast.error('Stock increases need a unit cost so inventory value stays correct');
            act.mutate({ productId: p._id, qtyChange: dir === 'in' ? n : -n, reason, notes, unitCost: dir === 'in' ? unitCost : undefined, approve: approveNow });
          }}
        >
          <Field label="Product" required>
            <AsyncPicker
              load={searchProducts}
              value={p}
              onChange={setP}
              render={(x) => (
                <span>
                  {x.sku} — {x.name} <span className="text-muted-foreground">({x.qtyAvailable ?? 0} available)</span>
                </span>
              )}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Direction">
              <Select value={dir} onChange={(e) => setDir(e.target.value as 'in')}>
                <option value="out">Decrease (−)</option>
                <option value="in">Increase (+)</option>
              </Select>
            </Field>
            <Field label="Quantity" required>
              <Input type="number" min={1} step={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field label="Reason" required>
              <Select value={reason} onChange={(e) => setReason(e.target.value)}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {titleCase(r)}
                  </option>
                ))}
              </Select>
            </Field>
            {dir === 'in' && (
              <Field label="Unit cost" required hint="Creates a FIFO cost layer">
                <MoneyInput value={unitCost} onChange={setUnitCost} />
              </Field>
            )}
          </div>
          <Field label="Notes" required>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What happened?" />
          </Field>
          <Checkbox label="Approve and post immediately" checked={approveNow} onChange={(e) => setApproveNow(e.target.checked)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={act.isPending}>
              Submit
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ============================ Stock counts ============================ */
export function StockCountsPage() {
  const { can } = useAuth();
  const ls = useListState();
  const list = usePage('/inventory/stock-counts', { page: ls.page, limit: ls.limit });
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<any>(null);
  return (
    <div>
      <PageHeader
        title="Stock counts"
        description="Record physical counts. Differences become adjustments (count correction) for review."
        actions={
          can('inventory:adjust') && (
            <Button size="sm" onClick={() => setOpen(true)}>
              <ClipboardList /> New count
            </Button>
          )
        }
      />
      <Card>
        <DataTable
          rows={list.data?.items}
          loading={list.isFetching}
          error={list.error}
          onRowClick={setView}
          empty={<EmptyState icon={ClipboardList} title="No stock counts yet" />}
          columns={[
            { key: 'no', header: 'Count', cell: (c) => <span className="font-medium">{c.countNo}</span> },
            { key: 'd', header: 'Date', cell: (c) => dateTime(c.createdAt) },
            { key: 'l', header: 'Lines', align: 'right', cell: (c) => c.lines.length },
            { key: 'diff', header: 'Lines with differences', align: 'right', cell: (c) => c.lines.filter((l: any) => l.difference !== 0).length },
            { key: 'n', header: 'Notes', cell: (c) => c.notes ?? '' },
          ]}
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
      {open && <StockCountDialog onClose={() => setOpen(false)} />}
      {view && (
        <Dialog open onOpenChange={(o) => !o && setView(null)}>
          <DialogContent title={`Stock count ${view.countNo}`} description={dateTime(view.createdAt)} wide>
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="text-right">System</TH>
                  <TH className="text-right">Counted</TH>
                  <TH className="text-right">Difference</TH>
                </TR>
              </THead>
              <TBody>
                {view.lines.map((l: any, i: number) => (
                  <TR key={i}>
                    <TD>
                      {refName(l.productId, 'sku')} — {refName(l.productId)}
                    </TD>
                    <TD className="text-right tabular">{l.systemQty}</TD>
                    <TD className="text-right tabular">{l.countedQty}</TD>
                    <TD className={`text-right tabular ${l.difference < 0 ? 'text-destructive' : l.difference > 0 ? 'text-success' : ''}`}>
                      {l.difference > 0 ? '+' : ''}
                      {l.difference}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function StockCountDialog({ onClose }: { onClose: () => void }) {
  const [lines, setLines] = useState<{ p: Product; counted: string }[]>([]);
  const [picker, setPicker] = useState<Product | null>(null);
  const [notes, setNotes] = useState('');
  const [approve, setApprove] = useState(false);
  const act = useAction((b: object) => post('/inventory/stock-counts', b), { success: 'Stock count recorded', invalidate: ['/inventory', '/products'], onSuccess: onClose });
  const addAll = async () => {
    const r = await get('/inventory', { limit: 500 });
    setLines(r.items.map((p: Product) => ({ p, counted: '' })));
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="New stock count" description="Enter what is physically on the shelf. The system quantity is captured when you submit." wide>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <AsyncPicker
              load={searchProducts}
              value={picker}
              onChange={(p) => {
                if (p && !lines.some((l) => l.p._id === p._id)) setLines((ls) => [...ls, { p, counted: '' }]);
                setPicker(null);
              }}
              render={(x) => `${x.sku} — ${x.name}`}
              placeholder="Add product to count…"
            />
          </div>
          <Button type="button" variant="outline" onClick={addAll}>
            Add all products
          </Button>
        </div>
        {lines.length > 0 && (
          <div className="max-h-80 overflow-y-auto">
            <Table>
              <THead>
                <TR>
                  <TH>Product</TH>
                  <TH className="text-right">Expected</TH>
                  <TH className="w-32 text-right">Counted</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {lines.map((l, i) => (
                  <TR key={l.p._id}>
                    <TD>
                      {l.p.sku} — {l.p.name}
                    </TD>
                    <TD className="text-right tabular">{l.p.qtyOnHand ?? 0}</TD>
                    <TD>
                      <Input
                        type="number"
                        min={0}
                        aria-label={`Counted ${l.p.sku}`}
                        className="text-right"
                        value={l.counted}
                        onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, counted: e.target.value } : x)))}
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
          </div>
        )}
        <Field label="Notes">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Checkbox label="Approve resulting adjustments immediately" checked={approve} onChange={(e) => setApprove(e.target.checked)} />
        <DialogFooter>
          <Button
            loading={act.isPending}
            onClick={() => {
              const filled = lines.filter((l) => l.counted !== '');
              if (!filled.length) return toast.error('Enter at least one counted quantity');
              if (filled.some((l) => !Number.isInteger(Number(l.counted)) || Number(l.counted) < 0)) return toast.error('Counts must be whole numbers ≥ 0');
              act.mutate({ notes: notes || undefined, approve, lines: filled.map((l) => ({ productId: l.p._id, countedQty: Number(l.counted) })) });
            }}
          >
            Record count
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================== Low stock ============================== */
export function LowStockPage() {
  const q = useApi<{ lowStock: any[]; outOfStock: any[] }>('/inventory/low-stock');
  const { can } = useAuth();
  const rows = [...(q.data?.outOfStock ?? []), ...(q.data?.lowStock ?? [])];
  return (
    <div>
      <PageHeader
        title="Low stock & reorder recommendations"
        description="Products at or below their reorder point. Suggested quantity = reorder quantity set on the product."
        actions={
          can('purchases:write') && (
            <Button size="sm" asChild>
              <Link to="/purchases/new">Create purchase</Link>
            </Button>
          )
        }
      />
      <Card>
        <CardHeader>
          <CardTitle>
            {rows.length} product{rows.length === 1 ? '' : 's'} need attention
          </CardTitle>
        </CardHeader>
        <CardContent className="px-0">
          <DataTable
            rows={rows}
            rowKey={(r) => String(r.productId)}
            loading={q.isLoading}
            error={q.error}
            empty={<EmptyState title="All products are above their reorder point" />}
            columns={[
              {
                key: 's',
                header: 'SKU',
                cell: (r) => (
                  <Link className="font-medium text-primary hover:underline" to={`/products/${r.productId}`}>
                    {r.sku}
                  </Link>
                ),
              },
              { key: 'n', header: 'Product', cell: (r) => r.name },
              { key: 'c', header: 'Category', cell: (r) => r.category },
              { key: 'a', header: 'Available', align: 'right', cell: (r) => r.available },
              { key: 'rp', header: 'Reorder point', align: 'right', cell: (r) => r.reorderPoint },
              { key: 'sold', header: 'Sold (90d)', align: 'right', cell: (r) => r.sold90 },
              { key: 'sug', header: 'Suggested order', align: 'right', cell: (r) => <strong>{Math.max(r.reorderQuantity, r.reorderPoint - r.available + 1)}</strong> },
              { key: 'st', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
            ]}
          />
        </CardContent>
      </Card>
    </div>
  );
}
