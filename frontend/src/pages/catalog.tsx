import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Archive, ArchiveRestore, CarFront, CheckCircle2, ImagePlus, Pencil, Plus, Trash2, Upload, AlertTriangle } from 'lucide-react';
import { api, del, get, patch, post, type Page } from '@/lib/api';
import { useAction, useApi, useDebounced, usePage, errorMessage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { dateTime, money, num, refId, refName, titleCase } from '@/lib/format';
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
  SearchInput,
  StatCard,
  useListState,
  type Column,
} from '@/components/common';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';

export interface Product {
  _id: string;
  sku: string;
  name: string;
  manufacturerPartNumber?: string;
  oemPartNumbers: string[];
  alternativePartNumbers: string[];
  barcode?: string;
  brandId?: any;
  categoryId?: any;
  description?: string;
  imageUrl?: string;
  unit: string;
  weightGrams?: number;
  sellingPrice: number;
  minimumSellingPrice: number;
  lastPurchaseCost?: number;
  warrantyMonths: number;
  warrantyTerms?: string;
  supplierIds?: any[];
  storageLocation?: string;
  reorderPoint: number;
  reorderQuantity: number;
  condition: string;
  isActive: boolean;
  qtyOnHand?: number;
  qtyAvailable?: number;
  qtyReserved?: number;
  brandName?: string;
  categoryName?: string;
}

export const searchProducts = (search: string) => get<Page<Product>>('/products', { search, limit: 15, status: 'active' }).then((r) => r.items);

export function StockBadge({ p }: { p: Pick<Product, 'qtyAvailable' | 'reorderPoint'> }) {
  const q = p.qtyAvailable ?? 0;
  if (q <= 0) return <Badge variant="destructive">Out of stock</Badge>;
  if (q <= p.reorderPoint) return <Badge variant="warning">{q} · low</Badge>;
  return <Badge variant="success">{num(q)} in stock</Badge>;
}

/* ================================ Products ================================ */
export function ProductsPage() {
  const nav = useNavigate();
  const { can } = useAuth();
  const ls = useListState({ sort: 'name', filters: { status: 'active' } });
  const search = useDebounced(ls.search);
  const cats = useApi<any[]>('/categories');
  const brands = useApi<any[]>('/brands');
  const q = { page: ls.page, limit: ls.limit, sort: ls.sort, search, ...ls.filters };
  const list = usePage<Product>('/products', q);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);

  const cols: Column<Product>[] = [
    {
      key: 'sku',
      header: 'SKU',
      sort: 'sku',
      cell: (p) => (
        <Link to={`/products/${p._id}`} className="font-medium text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
          {p.sku}
        </Link>
      ),
    },
    {
      key: 'name',
      header: 'Product',
      sort: 'name',
      cell: (p) => (
        <div className="min-w-48">
          <div className="font-medium">{p.name}</div>
          <div className="text-xs text-muted-foreground">{[p.manufacturerPartNumber, p.barcode].filter(Boolean).join(' · ')}</div>
        </div>
      ),
    },
    { key: 'cat', header: 'Category', cell: (p) => p.categoryName ?? '—' },
    { key: 'brand', header: 'Brand', cell: (p) => p.brandName ?? '—' },
    { key: 'loc', header: 'Shelf', cell: (p) => p.storageLocation ?? '—' },
    { key: 'cost', header: 'Last cost', align: 'right', cell: (p) => money(p.lastPurchaseCost) },
    { key: 'price', header: 'Price', align: 'right', sort: 'sellingPrice', cell: (p) => <span className="font-medium">{money(p.sellingPrice)}</span> },
    { key: 'stock', header: 'Stock', align: 'right', cell: (p) => <StockBadge p={p} /> },
    { key: 'st', header: 'Status', cell: (p) => (p.isActive ? null : <StatusBadge status="INACTIVE" />) },
  ];

  return (
    <div>
      <PageHeader
        title="Products"
        description="Search by name, SKU, barcode, OEM or alternative part number."
        actions={
          <>
            <ExportMenu path="/products/export" />
            {can('products:write') && (
              <>
                <Button variant="outline" size="sm" onClick={() => setBulkOpen(true)}>
                  Bulk price update
                </Button>
                <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
                  <Upload /> Import
                </Button>
                <Button size="sm" asChild>
                  <Link to="/products/new">
                    <Plus /> New product
                  </Link>
                </Button>
              </>
            )}
          </>
        }
      />
      <Card>
        <div className="flex flex-col gap-2 border-b p-3 md:flex-row md:flex-wrap md:items-center">
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Search products…" autoFocus />
          <Select aria-label="Category" className="md:w-44" value={ls.filters.categoryId ?? ''} onChange={(e) => ls.setFilter('categoryId', e.target.value)}>
            <option value="">All categories</option>
            {cats.data?.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Brand" className="md:w-40" value={ls.filters.brandId ?? ''} onChange={(e) => ls.setFilter('brandId', e.target.value)}>
            <option value="">All brands</option>
            {brands.data?.map((b) => (
              <option key={b._id} value={b._id}>
                {b.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Stock" className="md:w-36" value={ls.filters.stock ?? ''} onChange={(e) => ls.setFilter('stock', e.target.value)}>
            <option value="">Any stock</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </Select>
          <Select aria-label="Status" className="md:w-32" value={ls.filters.status} onChange={(e) => ls.setFilter('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
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
          empty={
            <EmptyState
              title="No products found"
              description={search ? 'Try a different search term.' : 'Create your first product to start tracking stock.'}
              action={
                can('products:write') && !search ? (
                  <Button asChild size="sm">
                    <Link to="/products/new">New product</Link>
                  </Button>
                ) : undefined
              }
            />
          }
        />
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} limit={ls.limit} onLimit={ls.setLimit} />
      </Card>
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <BulkPriceDialog open={bulkOpen} onOpenChange={setBulkOpen} categories={cats.data ?? []} brands={brands.data ?? []} />
    </div>
  );
}

function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean) => {
    const f = fileRef.current?.files?.[0];
    if (!f) return toast.error('Choose a CSV or Excel file first');
    const fd = new FormData();
    fd.append('file', f);
    setBusy(true);
    try {
      const r = await api('/products/import', { method: 'POST', body: fd, query: { dryRun: String(dryRun) } });
      setResult({ ...r, dryRun });
      if (!dryRun) toast.success(`${r.created} products imported`);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (onOpenChange(o), !o && setResult(null))}>
      <DialogContent
        title="Import products from CSV or Excel"
        description="CSV or .xlsx (first sheet). Columns: sku, name, sellingPrice, minimumSellingPrice, category, brand, manufacturerPartNumber, oemPartNumbers (separated by ;), barcode, reorderPoint, reorderQuantity, storageLocation, warrantyMonths, openingQty, openingUnitCost. Prices in dollars (e.g. 12.50)."
        wide
      >
        <Input ref={fileRef} type="file" accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Import file" />
        {result && (
          <div className="max-h-64 overflow-y-auto rounded-md border text-sm">
            <p className="border-b bg-muted/40 px-3 py-2 font-medium">
              {result.dryRun ? 'Validation' : 'Import'}: {result.total} rows · {result.dryRun ? result.results.filter((r: any) => r.status === 'valid').length + ' valid' : result.created + ' created'}{' '}
              · {result.errors} errors
            </p>
            {result.results
              .filter((r: any) => r.status === 'error')
              .map((r: any) => (
                <p key={r.row} className="border-b px-3 py-1.5 text-destructive">
                  Row {r.row} {r.sku && `(${r.sku})`}: {r.message}
                </p>
              ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => run(true)} loading={busy}>
            Validate only
          </Button>
          <Button onClick={() => run(false)} loading={busy}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkPriceDialog({ open, onOpenChange, categories, brands }: { open: boolean; onOpenChange: (o: boolean) => void; categories: any[]; brands: any[] }) {
  const [categoryId, setCat] = useState('');
  const [brandId, setBrand] = useState('');
  const [mode, setMode] = useState<'PERCENT' | 'AMOUNT'>('PERCENT');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const act = useAction((b: object) => post('/products/bulk-price', b), { success: (r: any) => `${r.updated ?? 'Prices'} updated`, invalidate: ['/products'], onSuccess: () => onOpenChange(false) });
  const v = mode === 'PERCENT' ? Math.round(Number(value) * 100) : Math.round(Number(value) * 100);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Bulk price update" description="Changes are recorded in each product's price history. Past invoices are never changed.">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!categoryId && !brandId) return toast.error('Choose a category or brand');
            if (!Number.isFinite(v) || v === 0) return toast.error('Enter a non-zero change');
            act.mutate({ categoryId: categoryId || undefined, brandId: brandId || undefined, mode, value: v, reason });
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <Select value={categoryId} onChange={(e) => setCat(e.target.value)}>
                <option value="">Any</option>
                {categories.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand">
              <Select value={brandId} onChange={(e) => setBrand(e.target.value)}>
                <option value="">Any</option>
                {brands.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Change type">
              <Select value={mode} onChange={(e) => setMode(e.target.value as 'PERCENT')}>
                <option value="PERCENT">Percent (%)</option>
                <option value="AMOUNT">Fixed amount ($)</option>
              </Select>
            </Field>
            <Field label={mode === 'PERCENT' ? 'Percent (e.g. 5 or -2.5)' : 'Amount in $ (e.g. 1.50)'}>
              <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
            </Field>
          </div>
          <Field label="Reason" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} required />
          </Field>
          <DialogFooter>
            <Button type="submit" loading={act.isPending}>
              Apply
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ============================== Product form ============================== */
const list = z
  .string()
  .optional()
  .transform((s) =>
    s
      ? s
          .split(/[,;\n]/)
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
  );
const productSchema = z
  .object({
    sku: z.string().trim().min(1, 'SKU is required').max(60),
    name: z.string().trim().min(2, 'Name is required').max(200),
    manufacturerPartNumber: z.string().trim().max(100).optional(),
    oemPartNumbers: list,
    alternativePartNumbers: list,
    barcode: z.string().trim().max(60).optional(),
    brandId: z.string().optional(),
    categoryId: z.string().optional(),
    description: z.string().max(2000).optional(),
    unit: z.string().trim().min(1).max(20),
    weightGrams: z.coerce.number().int().min(0).optional(),
    sellingPrice: z.number({ invalid_type_error: 'Enter a valid price' }).int().min(0, 'Price cannot be negative'),
    minimumSellingPrice: z.number({ invalid_type_error: 'Enter a valid price' }).int().min(0),
    warrantyMonths: z.coerce.number().int().min(0).max(120),
    warrantyTerms: z.string().max(500).optional(),
    storageLocation: z.string().max(60).optional(),
    reorderPoint: z.coerce.number().int().min(0),
    reorderQuantity: z.coerce.number().int().min(0),
    condition: z.enum(['NEW', 'USED', 'REFURBISHED']),
    priceChangeReason: z.string().max(300).optional(),
  })
  .refine((v) => v.minimumSellingPrice <= v.sellingPrice, { message: 'Minimum price cannot exceed the selling price', path: ['minimumSellingPrice'] });
type ProductFormIn = z.input<typeof productSchema>;
type ProductFormOut = z.output<typeof productSchema>;

export function ProductFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const existing = useApi<Product>(editing ? `/products/${id}` : null);
  if (editing && existing.isLoading) return <LoadingBlock rows={10} />;
  if (editing && existing.error) return <ErrorState error={existing.error} retry={existing.refetch} />;
  return <ProductForm key={id ?? 'new'} product={existing.data} />;
}

function ProductForm({ product }: { product?: Product }) {
  const nav = useNavigate();
  const cats = useApi<any[]>('/categories');
  const brands = useApi<any[]>('/brands');
  const p = product;
  const { register, handleSubmit, control, formState, setError, watch } = useForm<ProductFormIn, unknown, ProductFormOut>({
    resolver: zodResolver(productSchema) as never,
    defaultValues: {
      sku: p?.sku ?? '',
      name: p?.name ?? '',
      manufacturerPartNumber: p?.manufacturerPartNumber ?? '',
      oemPartNumbers: p?.oemPartNumbers?.join(', ') ?? '',
      alternativePartNumbers: p?.alternativePartNumbers?.join(', ') ?? '',
      barcode: p?.barcode ?? '',
      brandId: refId(p?.brandId) || '',
      categoryId: refId(p?.categoryId) || '',
      description: p?.description ?? '',
      unit: p?.unit ?? 'pcs',
      weightGrams: p?.weightGrams ?? undefined,
      sellingPrice: p?.sellingPrice ?? (null as never),
      minimumSellingPrice: p?.minimumSellingPrice ?? 0,
      warrantyMonths: p?.warrantyMonths ?? 0,
      warrantyTerms: p?.warrantyTerms ?? '',
      storageLocation: p?.storageLocation ?? '',
      reorderPoint: p?.reorderPoint ?? 5,
      reorderQuantity: p?.reorderQuantity ?? 10,
      condition: (p?.condition as 'NEW') ?? 'NEW',
      priceChangeReason: '',
    },
  });
  const e = formState.errors;
  const priceChanged = p && watch('sellingPrice') !== p.sellingPrice;

  const onSubmit = async (v: ProductFormOut) => {
    const body = { ...v, brandId: v.brandId || null, categoryId: v.categoryId || null, weightGrams: v.weightGrams || undefined };
    if (!p) delete (body as Partial<typeof body>).priceChangeReason;
    try {
      const saved = p ? await patch<Product>(`/products/${p._id}`, body) : await post<Product>('/products', body);
      toast.success(p ? 'Product updated' : 'Product created');
      nav(`/products/${saved._id}`);
    } catch (err) {
      const fe = (err as any).fieldErrors as Record<string, string> | undefined;
      if (fe && Object.keys(fe).length) Object.entries(fe).forEach(([k, m]) => setError(k as never, { message: m }));
      toast.error(errorMessage(err));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <PageHeader
        title={p ? `Edit ${p.sku}` : 'New product'}
        back={p ? `/products/${p._id}` : '/products'}
        actions={
          <Button type="submit" loading={formState.isSubmitting}>
            {p ? 'Save changes' : 'Create product'}
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Identification</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="SKU" htmlFor="sku" error={e.sku?.message} required hint="Unique; stored in upper case">
              <Input id="sku" {...register('sku')} aria-invalid={!!e.sku} className="uppercase" />
            </Field>
            <Field label="Product name" htmlFor="name" error={e.name?.message} required>
              <Input id="name" {...register('name')} aria-invalid={!!e.name} />
            </Field>
            <Field label="Manufacturer part number" htmlFor="mpn">
              <Input id="mpn" {...register('manufacturerPartNumber')} />
            </Field>
            <Field label="Barcode" htmlFor="barcode" error={e.barcode?.message}>
              <Input id="barcode" {...register('barcode')} />
            </Field>
            <Field label="OEM part numbers" htmlFor="oem" hint="Separate with commas">
              <Input id="oem" {...register('oemPartNumbers')} />
            </Field>
            <Field label="Alternative part numbers" htmlFor="alt" hint="Separate with commas">
              <Input id="alt" {...register('alternativePartNumbers')} />
            </Field>
            <Field label="Category" htmlFor="cat">
              <Select id="cat" {...register('categoryId')}>
                <option value="">— None —</option>
                {cats.data?.map((c) => (
                  <option key={c._id} value={c._id}>
                    {c.parentId ? '— ' : ''}
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Brand" htmlFor="brand">
              <Select id="brand" {...register('brandId')}>
                <option value="">— None —</option>
                {brands.data?.map((b) => (
                  <option key={b._id} value={b._id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Description" htmlFor="desc" className="sm:col-span-2">
              <Textarea id="desc" {...register('description')} />
            </Field>
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Pricing</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <Field label="Selling price" htmlFor="price" error={e.sellingPrice?.message} required>
                <Controller control={control} name="sellingPrice" render={({ field }) => <MoneyInput id="price" value={field.value} onChange={field.onChange} invalid={!!e.sellingPrice} />} />
              </Field>
              <Field label="Minimum selling price" htmlFor="minprice" error={e.minimumSellingPrice?.message} hint="POS refuses to sell below this without approval">
                <Controller control={control} name="minimumSellingPrice" render={({ field }) => <MoneyInput id="minprice" value={field.value} onChange={(c) => field.onChange(c ?? 0)} />} />
              </Field>
              {priceChanged && (
                <Field label="Reason for price change" htmlFor="pcr">
                  <Input id="pcr" {...register('priceChangeReason')} />
                </Field>
              )}
              {p && <p className="text-xs text-muted-foreground">Last purchase cost: {money(p.lastPurchaseCost)}. Cost comes from purchase receipts (FIFO), never typed here.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Stock control</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <Field label="Reorder point" htmlFor="rp" error={e.reorderPoint?.message}>
                <Input id="rp" type="number" min={0} {...register('reorderPoint')} />
              </Field>
              <Field label="Reorder qty" htmlFor="rq" error={e.reorderQuantity?.message}>
                <Input id="rq" type="number" min={0} {...register('reorderQuantity')} />
              </Field>
              <Field label="Unit" htmlFor="unit">
                <Input id="unit" {...register('unit')} />
              </Field>
              <Field label="Weight (g)" htmlFor="wg">
                <Input id="wg" type="number" min={0} {...register('weightGrams')} />
              </Field>
              <Field label="Shelf location" htmlFor="loc" className="col-span-2">
                <Input id="loc" placeholder="e.g. A-03-2" {...register('storageLocation')} />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Condition & warranty</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <Field label="Condition" htmlFor="cond">
                <Select id="cond" {...register('condition')}>
                  <option value="NEW">New</option>
                  <option value="USED">Used</option>
                  <option value="REFURBISHED">Refurbished</option>
                </Select>
              </Field>
              <Field label="Warranty (months)" htmlFor="wm" error={e.warrantyMonths?.message}>
                <Input id="wm" type="number" min={0} {...register('warrantyMonths')} />
              </Field>
              <Field label="Warranty terms" htmlFor="wt" className="col-span-2">
                <Input id="wt" {...register('warrantyTerms')} />
              </Field>
            </CardContent>
          </Card>
        </div>
      </div>
    </form>
  );
}

/* ============================= Product detail ============================= */
export function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const q = useApi<Product & { inventoryValue: number; avgUnitCost: number; compatibility: any[] }>(`/products/${id}`);
  const hist = useApi<{ prices: any[]; movements: any[]; audit: any[] }>(`/products/${id}/history`);
  const [confirm, setConfirm] = useState(false);
  const [compatOpen, setCompatOpen] = useState(false);
  const archive = useAction(() => post(`/products/${id}/${q.data?.isActive ? 'archive' : 'restore'}`), {
    success: q.data?.isActive ? 'Product archived' : 'Product restored',
    invalidate: ['/products'],
    onSuccess: () => setConfirm(false),
  });
  const removeCompat = useAction((cid: string) => del(`/compatibility/${cid}`), { success: 'Compatibility removed', invalidate: [`/products/${id}`] });
  const verifyCompat = useAction((cid: string) => patch(`/compatibility/${cid}`, { verified: true }), { success: 'Marked verified', invalidate: [`/products/${id}`] });
  const imgRef = useRef<HTMLInputElement>(null);
  const upload = useAction(
    (f: File) => {
      const fd = new FormData();
      fd.append('image', f);
      return api(`/products/${id}/image`, { method: 'POST', body: fd });
    },
    { success: 'Image uploaded', invalidate: [`/products/${id}`] },
  );

  if (q.isLoading) return <LoadingBlock rows={10} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const p = q.data!;
  return (
    <div>
      <PageHeader
        title={p.name}
        back="/products"
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{p.sku}</span>
            {!p.isActive && <StatusBadge status="INACTIVE" />}
            <StockBadge p={p} />
          </span>
        }
        actions={
          can('products:write') && (
            <>
              <Button variant="outline" size="sm" onClick={() => setConfirm(true)}>
                {p.isActive ? <Archive /> : <ArchiveRestore />} {p.isActive ? 'Archive' : 'Restore'}
              </Button>
              <Button size="sm" asChild>
                <Link to={`/products/${p._id}/edit`}>
                  <Pencil /> Edit
                </Link>
              </Button>
            </>
          )
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="On hand" value={num(p.qtyOnHand)} hint={`${num(p.qtyReserved)} reserved`} />
        <StatCard label="Available" value={num(p.qtyAvailable)} hint={`Reorder at ${p.reorderPoint}`} tone={(p.qtyAvailable ?? 0) <= p.reorderPoint ? 'warning' : 'default'} />
        <StatCard label="Inventory value (FIFO)" value={money(p.inventoryValue)} hint={`Avg unit cost ${money(p.avgUnitCost)}`} />
        <StatCard label="Selling price" value={money(p.sellingPrice)} hint={`Minimum ${money(p.minimumSellingPrice)}`} />
      </div>
      <Tabs defaultValue="details" className="mt-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="compat">Vehicle compatibility ({p.compatibility.length})</TabsTrigger>
          <TabsTrigger value="movements">Stock movements</TabsTrigger>
          <TabsTrigger value="prices">Price history</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
        <TabsContent value="details">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardContent className="pt-5">
                <KeyValue
                  items={[
                    ['Category', refName(p.categoryId) || '—'],
                    ['Brand', refName(p.brandId) || '—'],
                    ['Manufacturer part no.', p.manufacturerPartNumber],
                    ['Barcode', p.barcode],
                    ['OEM numbers', p.oemPartNumbers.join(', ') || '—'],
                    ['Alternative numbers', p.alternativePartNumbers.join(', ') || '—'],
                    ['Shelf location', p.storageLocation],
                    ['Unit / weight', `${p.unit}${p.weightGrams ? ` · ${p.weightGrams} g` : ''}`],
                    ['Condition', titleCase(p.condition)],
                    ['Warranty', p.warrantyMonths ? `${p.warrantyMonths} months${p.warrantyTerms ? ` — ${p.warrantyTerms}` : ''}` : 'None'],
                    ['Suppliers', p.supplierIds?.map((s: any) => s.name).join(', ') || '—'],
                    ['Last purchase cost', money(p.lastPurchaseCost)],
                  ]}
                />
                {p.description && <p className="mt-4 whitespace-pre-wrap text-sm text-muted-foreground">{p.description}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Image</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="aspect-square w-full rounded-md border object-contain" />
                ) : (
                  <div className="grid aspect-square place-items-center rounded-md border border-dashed text-sm text-muted-foreground">No image</div>
                )}
                {can('products:write') && (
                  <>
                    <input
                      ref={imgRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && upload.mutate(e.target.files[0])}
                      aria-label="Product image file"
                    />
                    <Button variant="outline" size="sm" onClick={() => imgRef.current?.click()} loading={upload.isPending}>
                      <ImagePlus /> Upload image
                    </Button>
                    <p className="text-xs text-muted-foreground">PNG, JPEG or WebP up to 2 MB.</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        <TabsContent value="compat">
          <Card>
            <div className="flex items-center justify-between border-b p-3">
              <p className="text-sm text-muted-foreground">Only explicitly recorded fitments are shown, each with its data source. Unverified links are flagged.</p>
              {can('products:write') && (
                <Button size="sm" onClick={() => setCompatOpen(true)}>
                  <Plus /> Add vehicle
                </Button>
              )}
            </div>
            <DataTable
              rows={p.compatibility}
              empty={<EmptyState icon={CarFront} title="No vehicle compatibility recorded" />}
              columns={[
                { key: 'v', header: 'Vehicle', cell: (c) => <VehicleLabel v={c.vehicleId} /> },
                { key: 's', header: 'Source', cell: (c) => `${titleCase(c.source)}${c.sourceReference ? ` · ${c.sourceReference}` : ''}` },
                {
                  key: 'ver',
                  header: 'Verified',
                  cell: (c) =>
                    c.verified ? (
                      <Badge variant="success">
                        <CheckCircle2 className="size-3" /> Verified
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <AlertTriangle className="size-3" /> Unverified
                      </Badge>
                    ),
                },
                { key: 'n', header: 'Notes', cell: (c) => c.notes ?? '' },
                {
                  key: 'a',
                  header: '',
                  align: 'right',
                  cell: (c) =>
                    can('products:write') && (
                      <div className="flex justify-end gap-1">
                        {!c.verified && (
                          <Button variant="ghost" size="sm" onClick={() => verifyCompat.mutate(c._id)}>
                            Verify
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" aria-label="Remove compatibility" onClick={() => removeCompat.mutate(c._id)}>
                          <Trash2 />
                        </Button>
                      </div>
                    ),
                },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="movements">
          <Card>
            <DataTable
              rows={hist.data?.movements}
              loading={hist.isLoading}
              empty={<EmptyState title="No stock movements yet" />}
              columns={[
                { key: 'd', header: 'Date', cell: (m) => dateTime(m.at) },
                { key: 't', header: 'Type', cell: (m) => titleCase(m.type) },
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
                { key: 'b', header: 'Balance', align: 'right', cell: (m) => m.balanceAfter },
                { key: 'why', header: 'Reason', cell: (m) => m.reason ?? '' },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="prices">
          <Card>
            <DataTable
              rows={hist.data?.prices}
              empty={<EmptyState title="No price changes recorded" />}
              columns={[
                { key: 'd', header: 'Date', cell: (r) => dateTime(r.at) },
                { key: 'f', header: 'Field', cell: (r) => titleCase(r.field ?? 'sellingPrice') },
                { key: 'o', header: 'Old', align: 'right', cell: (r) => money(r.oldValue ?? r.oldPrice) },
                { key: 'n', header: 'New', align: 'right', cell: (r) => money(r.newValue ?? r.newPrice) },
                { key: 'r', header: 'Reason', cell: (r) => r.reason ?? '' },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="audit">
          <AuditTable rows={hist.data?.audit} />
        </TabsContent>
      </Tabs>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={p.isActive ? 'Archive this product?' : 'Restore this product?'}
        description={p.isActive ? 'Archived products cannot be sold or purchased. All history, invoices and movements are kept.' : 'The product becomes available for sale again.'}
        confirmLabel={p.isActive ? 'Archive' : 'Restore'}
        destructive={p.isActive}
        loading={archive.isPending}
        onConfirm={() => archive.mutate()}
      />
      <CompatibilityDialog open={compatOpen} onOpenChange={setCompatOpen} productId={p._id} />
    </div>
  );
}

export function AuditTable({ rows }: { rows?: any[] }) {
  return (
    <Card>
      <DataTable
        rows={rows}
        empty={<EmptyState title="No audit records" />}
        columns={[
          { key: 'at', header: 'When', cell: (r) => dateTime(r.at) },
          { key: 'u', header: 'User', cell: (r) => r.userName ?? '—' },
          { key: 'a', header: 'Action', cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
          { key: 's', header: 'Summary', cell: (r) => r.summary ?? '' },
        ]}
      />
    </Card>
  );
}

export function VehicleLabel({ v }: { v: any }) {
  if (!v) return <>—</>;
  return (
    <div>
      <div className="font-medium">
        {v.make} {v.model} {v.generation && <span className="text-muted-foreground">({v.generation})</span>}
      </div>
      <div className="text-xs text-muted-foreground">
        {[`${v.yearFrom}–${v.yearTo ?? 'present'}`, v.engineSize, v.engineCode, v.fuelType && titleCase(v.fuelType), v.variant].filter(Boolean).join(' · ')}
      </div>
    </div>
  );
}

const SOURCES = ['MANUFACTURER_CATALOG', 'OEM_CROSS_REFERENCE', 'SUPPLIER_DATA', 'PHYSICALLY_VERIFIED', 'CUSTOMER_REPORT', 'OTHER'];

function CompatibilityDialog({ open, onOpenChange, productId, vehicle }: { open: boolean; onOpenChange: (o: boolean) => void; productId?: string; vehicle?: any }) {
  const [v, setV] = useState<any>(vehicle ?? null);
  const [prod, setProd] = useState<Product | null>(null);
  const [source, setSource] = useState('MANUFACTURER_CATALOG');
  const [ref, setRef] = useState('');
  const [verified, setVerified] = useState(false);
  const [notes, setNotes] = useState('');
  const act = useAction((b: object) => post('/compatibility', b), { success: 'Compatibility recorded', invalidate: ['/products', '/vehicles'], onSuccess: () => onOpenChange(false) });
  const loadVehicles = (s: string) => get<Page<any>>('/vehicles', { search: s, limit: 15 }).then((r) => r.items);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Record vehicle compatibility" description="Record only fitments confirmed by a catalogue, cross-reference or physical check. The source is stored with the link.">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const pid = productId ?? prod?._id;
            if (!pid || !v) return toast.error(productId ? 'Choose a vehicle' : 'Choose a product');
            act.mutate({ productId: pid, vehicleId: v._id, source, sourceReference: ref || undefined, verified, notes: notes || undefined });
          }}
        >
          {!productId && (
            <Field label="Product" required>
              <AsyncPicker load={searchProducts} value={prod} onChange={setProd} render={(p) => `${p.sku} — ${p.name}`} placeholder="Search products…" />
            </Field>
          )}
          {!vehicle && (
            <Field label="Vehicle" required>
              <AsyncPicker
                load={loadVehicles}
                value={v}
                onChange={setV}
                render={(x) => `${x.make} ${x.model} ${x.yearFrom}–${x.yearTo ?? ''} ${x.engineSize ?? ''} ${x.engineCode ?? ''}`}
                placeholder="Search make, model, engine…"
              />
            </Field>
          )}
          <Field label="Data source" required>
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Source reference" hint="Catalogue page, document number…">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} />
          </Field>
          <Field label="Notes">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Checkbox label="This fitment has been verified" checked={verified} onChange={(e) => setVerified(e.target.checked)} />
          <DialogFooter>
            <Button type="submit" loading={act.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ========================= Categories & brands ========================= */
export function CategoriesPage() {
  const { can } = useAuth();
  const q = useApi<any[]>('/categories');
  const [edit, setEdit] = useState<any | null>(null);
  const roots = (q.data ?? []).filter((c) => !c.parentId);
  const rows = roots.flatMap((r) => [r, ...(q.data ?? []).filter((c) => String(c.parentId) === String(r._id))]);
  return (
    <div>
      <PageHeader
        title="Categories"
        description="Organise products into categories and subcategories."
        actions={
          can('products:write') && (
            <Button size="sm" onClick={() => setEdit({})}>
              <Plus /> New category
            </Button>
          )
        }
      />
      <Card>
        <DataTable
          rows={rows}
          loading={q.isLoading}
          error={q.error}
          columns={[
            {
              key: 'n',
              header: 'Name',
              cell: (c) => (
                <span className={c.parentId ? 'pl-6 text-muted-foreground' : 'font-medium'}>
                  {c.parentId ? '↳ ' : ''}
                  {c.name}
                </span>
              ),
            },
            { key: 'd', header: 'Description', cell: (c) => c.description ?? '' },
            { key: 'p', header: 'Products', align: 'right', cell: (c) => c.productCount ?? 0 },
            { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
            {
              key: 'a',
              header: '',
              align: 'right',
              cell: (c) =>
                can('products:write') && (
                  <Button variant="ghost" size="sm" onClick={() => setEdit(c)}>
                    Edit
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <NamedEntityDialog
        key={edit?._id ?? 'new'}
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        entity={edit}
        path="/categories"
        title="Category"
        extra={(st, set) => (
          <>
            <Field label="Parent category">
              <Select value={st.parentId ?? ''} onChange={(e) => set({ parentId: e.target.value || null })}>
                <option value="">— Top level —</option>
                {roots
                  .filter((r) => r._id !== edit?._id)
                  .map((r) => (
                    <option key={r._id} value={r._id}>
                      {r.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Description">
              <Input value={st.description ?? ''} onChange={(e) => set({ description: e.target.value })} />
            </Field>
          </>
        )}
      />
    </div>
  );
}

export function BrandsPage() {
  const { can } = useAuth();
  const q = useApi<any[]>('/brands');
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div>
      <PageHeader
        title="Brands"
        description="Part manufacturers and brands."
        actions={
          can('products:write') && (
            <Button size="sm" onClick={() => setEdit({})}>
              <Plus /> New brand
            </Button>
          )
        }
      />
      <Card>
        <DataTable
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          columns={[
            { key: 'n', header: 'Name', cell: (c) => <span className="font-medium">{c.name}</span> },
            { key: 'c', header: 'Country', cell: (c) => c.country ?? '' },
            { key: 'p', header: 'Products', align: 'right', cell: (c) => c.productCount ?? 0 },
            { key: 's', header: 'Status', cell: (c) => <StatusBadge status={c.isActive === false ? 'INACTIVE' : 'ACTIVE'} /> },
            {
              key: 'a',
              header: '',
              align: 'right',
              cell: (c) =>
                can('products:write') && (
                  <Button variant="ghost" size="sm" onClick={() => setEdit(c)}>
                    Edit
                  </Button>
                ),
            },
          ]}
        />
      </Card>
      <NamedEntityDialog
        key={edit?._id ?? 'new'}
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        entity={edit}
        path="/brands"
        title="Brand"
        extra={(st, set) => (
          <Field label="Country">
            <Input value={st.country ?? ''} onChange={(e) => set({ country: e.target.value })} />
          </Field>
        )}
      />
    </div>
  );
}

function NamedEntityDialog({
  open,
  onOpenChange,
  entity,
  path,
  title,
  extra,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  entity: any;
  path: string;
  title: string;
  extra: (st: any, set: (p: object) => void) => React.ReactNode;
}) {
  const isNew = !entity?._id;
  const [st, setSt] = useState<any>(() => ({
    name: entity?.name ?? '',
    isActive: entity?.isActive ?? true,
    parentId: entity?.parentId ?? null,
    description: entity?.description ?? '',
    country: entity?.country ?? '',
  }));
  const set = (p: object) => setSt((s: any) => ({ ...s, ...p }));
  const act = useAction(
    () => {
      const body: any = { name: st.name, isActive: st.isActive };
      if (path === '/categories') Object.assign(body, { parentId: st.parentId, description: st.description });
      if (path === '/brands') body.country = st.country;
      return isNew ? post(path, body) : patch(`${path}/${entity._id}`, body);
    },
    { success: `${title} saved`, invalidate: [path, '/products'], onSuccess: () => onOpenChange(false) },
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={isNew ? `New ${title.toLowerCase()}` : `Edit ${title.toLowerCase()}`}>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (st.name.trim().length < 2) return toast.error('Name is required');
            act.mutate();
          }}
        >
          <Field label="Name" required>
            <Input value={st.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
          </Field>
          {extra(st, set)}
          {!isNew && <Checkbox label="Active" checked={st.isActive} onChange={(e) => set({ isActive: e.target.checked })} />}
          <DialogFooter>
            <Button type="submit" loading={act.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ================================ Vehicles ================================ */
const FUELS = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC', 'LPG', 'OTHER'];

export function VehiclesPage() {
  const { can } = useAuth();
  const makes = useApi<{ make: string; models: string[] }[]>('/vehicles/makes');
  const [f, setF] = useState({ make: '', model: '', year: '', engine: '', part: '' });
  const df = useDebounced(f);
  const active = Object.values(df).some(Boolean);
  const parts = useApi<{ vehicles: number; items: any[] }>(active ? '/vehicles/parts' : null, { ...df, year: df.year || undefined, limit: 100 });
  const ls = useListState({ sort: 'make' });
  const vehicles = usePage('/vehicles', { page: ls.page, limit: ls.limit, search: useDebounced(ls.search), sort: ls.sort });
  const [vOpen, setVOpen] = useState<any | null>(null);
  const [linkFor, setLinkFor] = useState<any | null>(null);
  const models = makes.data?.find((m) => m.make === f.make)?.models ?? [];

  return (
    <div>
      <PageHeader
        title="Vehicle compatibility"
        description="Find parts that fit a vehicle. Results come only from recorded compatibility links — never guessed from product names."
        actions={
          can('products:write') && (
            <Button size="sm" onClick={() => setVOpen({})}>
              <Plus /> Register vehicle
            </Button>
          )
        }
      />
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Parts finder</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Make">
            <Select value={f.make} onChange={(e) => setF({ ...f, make: e.target.value, model: '' })}>
              <option value="">Any make</option>
              {makes.data?.map((m) => (
                <option key={m.make}>{m.make}</option>
              ))}
            </Select>
          </Field>
          <Field label="Model">
            <Select value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })} disabled={!f.make}>
              <option value="">Any model</option>
              {models.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
          </Field>
          <Field label="Year">
            <Input type="number" min={1950} max={2100} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} placeholder="e.g. 2016" />
          </Field>
          <Field label="Engine">
            <Input value={f.engine} onChange={(e) => setF({ ...f, engine: e.target.value })} placeholder="1.8L or 2ZR-FE" />
          </Field>
          <Field label="Part name / number">
            <Input value={f.part} onChange={(e) => setF({ ...f, part: e.target.value })} placeholder="brake pad, 04465…" />
          </Field>
        </CardContent>
        {active && (
          <div className="border-t">
            <p className="px-4 py-2 text-xs text-muted-foreground">{parts.data ? `${parts.data.vehicles} matching vehicle variant(s), ${parts.data.items.length} compatible part(s)` : 'Searching…'}</p>
            <DataTable
              rows={parts.data?.items}
              loading={parts.isFetching}
              empty={<EmptyState icon={CarFront} title="No recorded compatible parts" description="If you know a part fits, record the compatibility with its source." />}
              columns={[
                {
                  key: 'sku',
                  header: 'SKU',
                  cell: (p) => (
                    <Link to={`/products/${p._id}`} className="font-medium text-primary hover:underline">
                      {p.sku}
                    </Link>
                  ),
                },
                { key: 'n', header: 'Product', cell: (p) => p.name },
                { key: 'fit', header: 'Fits', cell: (p) => p.fitments.map((x: any) => `${x.vehicle?.make} ${x.vehicle?.model} ${x.vehicle?.yearFrom}–${x.vehicle?.yearTo ?? ''}`).join('; ') },
                { key: 'v', header: 'Verification', cell: (p) => (p.hasUnverified ? <Badge variant="warning">Contains unverified</Badge> : <Badge variant="success">Verified</Badge>) },
                { key: 'pr', header: 'Price', align: 'right', cell: (p) => money(p.sellingPrice) },
                { key: 'st', header: 'Stock', align: 'right', cell: (p) => <StockBadge p={p} /> },
              ]}
            />
          </div>
        )}
      </Card>
      <Card>
        <div className="flex items-center justify-between gap-2 border-b p-3">
          <CardTitle>Registered vehicles</CardTitle>
          <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Search vehicles…" />
        </div>
        <DataTable
          rows={vehicles.data?.items}
          loading={vehicles.isFetching}
          error={vehicles.error}
          sort={ls.sort}
          onSort={ls.setSort}
          empty={<EmptyState icon={CarFront} title="No vehicles registered" />}
          columns={[
            { key: 'v', header: 'Vehicle', sort: 'make', cell: (v) => <VehicleLabel v={v} /> },
            { key: 'e', header: 'Engine', cell: (v) => [v.engineSize, v.engineCode].filter(Boolean).join(' / ') || '—' },
            { key: 't', header: 'Transmission', cell: (v) => v.transmission ?? '—' },
            {
              key: 'a',
              header: '',
              align: 'right',
              cell: (v) =>
                can('products:write') && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setLinkFor(v)}>
                      Link part
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setVOpen(v)}>
                      Edit
                    </Button>
                  </div>
                ),
            },
          ]}
        />
        <Pagination page={ls.page} pages={vehicles.data?.pages ?? 1} total={vehicles.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
      {vOpen && <VehicleDialog vehicle={vOpen} onClose={() => setVOpen(null)} />}
      {linkFor && <CompatibilityDialog open onOpenChange={(o) => !o && setLinkFor(null)} vehicle={linkFor} />}
    </div>
  );
}

function VehicleDialog({ vehicle, onClose }: { vehicle: any; onClose: () => void }) {
  const isNew = !vehicle._id;
  const [st, setSt] = useState({
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    generation: vehicle.generation ?? '',
    yearFrom: vehicle.yearFrom ?? '',
    yearTo: vehicle.yearTo ?? '',
    engineSize: vehicle.engineSize ?? '',
    engineCode: vehicle.engineCode ?? '',
    fuelType: vehicle.fuelType ?? 'PETROL',
    transmission: vehicle.transmission ?? '',
    variant: vehicle.variant ?? '',
  });
  const set = (k: string, v: string) => setSt((s) => ({ ...s, [k]: v }));
  const act = useAction(
    () => {
      const body = { ...st, yearFrom: Number(st.yearFrom), yearTo: st.yearTo ? Number(st.yearTo) : undefined };
      return isNew ? post('/vehicles', body) : patch(`/vehicles/${vehicle._id}`, body);
    },
    { success: 'Vehicle saved', invalidate: ['/vehicles'], onSuccess: onClose },
  );
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={isNew ? 'Register vehicle' : 'Edit vehicle'}>
        <form
          className="grid grid-cols-2 gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!st.make || !st.model || !st.yearFrom) return toast.error('Make, model and start year are required');
            act.mutate();
          }}
        >
          {(
            [
              ['make', 'Make', true],
              ['model', 'Model', true],
              ['generation', 'Generation'],
              ['variant', 'Variant / trim'],
              ['yearFrom', 'Year from', true],
              ['yearTo', 'Year to'],
              ['engineSize', 'Engine size'],
              ['engineCode', 'Engine code'],
              ['transmission', 'Transmission'],
            ] as [keyof typeof st, string, boolean?][]
          ).map(([k, l, r]) => (
            <Field key={k} label={l} required={r}>
              <Input value={st[k]} type={k.startsWith('year') ? 'number' : 'text'} onChange={(e) => set(k, e.target.value)} />
            </Field>
          ))}
          <Field label="Fuel type">
            <Select value={st.fuelType} onChange={(e) => set('fuelType', e.target.value)}>
              {FUELS.map((x) => (
                <option key={x} value={x}>
                  {titleCase(x)}
                </option>
              ))}
            </Select>
          </Field>
          <DialogFooter className="col-span-2">
            <Button type="submit" loading={act.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
