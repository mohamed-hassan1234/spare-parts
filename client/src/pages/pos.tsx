import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Banknote, CheckCircle2, FileText, Minus, Plus, Printer, ScanBarcode, Search, ShoppingCart, Trash2, UserRound, X } from 'lucide-react';
import { ApiError, fileUrl, get, newIdempotencyKey, post, type Page } from '@/lib/api';
import { errorMessage, invalidatePrefixes, useDebounced } from '@/lib/hooks';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { cn, money } from '@/lib/format';
import { AsyncPicker, EmptyState, MoneyInput, PageHeader } from '@/components/common';
import { Badge, Button, Card, Checkbox, Dialog, DialogContent, DialogFooter, Field, Input, Select, Spinner } from '@/components/ui';
import type { Product } from './catalog';
import { methodLabel } from './purchases';

export interface CartLine {
  product: Product;
  qty: number;
  unitPrice: number;
  discount: number;
}
export interface PaymentLine {
  method: 'CASH' | 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'STORE_CREDIT';
  amount: number | null;
  reference: string;
}

/** Cart preview maths in integer cents. The server recalculates everything at checkout. */
export function cartTotals(lines: CartLine[], cartDiscount: number) {
  const gross = lines.reduce((s, l) => s + l.qty * l.product.sellingPrice, 0);
  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0);
  const lineDiscounts = lines.reduce((s, l) => s + l.discount, 0);
  const net = subtotal - lineDiscounts - cartDiscount;
  return { gross, subtotal, lineDiscounts, discountTotal: gross - net, net };
}

const searchCustomers = (search: string) => get<Page<any>>('/customers', { search, limit: 15, status: 'ACTIVE' }).then((r) => r.items);

export function PosPage() {
  const { can, settings } = useAuth();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const dq = useDebounced(query, 200);
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartDiscount, setCartDiscount] = useState<number | null>(0);
  const [customer, setCustomer] = useState<any>(null);
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'CASH', amount: null, reference: '' }]);
  const [tendered, setTendered] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [overrideMin, setOverrideMin] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  // A fresh key per cart. Retrying the same cart (e.g. after a timeout) reuses it, so the server never records it twice.
  const [checkoutKey, setCheckoutKey] = useState(() => newIdempotencyKey('sale'));
  const searchRef = useRef<HTMLInputElement>(null);
  const canDiscount = can('sales:discount');

  useEffect(() => {
    let alive = true;
    if (!dq.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    get<Page<Product>>('/products', { search: dq, limit: 12, status: 'active' })
      .then((r) => alive && setResults(r.items))
      .catch(() => alive && setResults([]))
      .finally(() => alive && setSearching(false));
    return () => {
      alive = false;
    };
  }, [dq]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === 'F9') {
        e.preventDefault();
        document.getElementById('pos-checkout')?.click();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const totals = cartTotals(lines, cartDiscount ?? 0);
  const paid = payments.reduce((s, p) => s + (p.amount ?? 0), 0);
  const balance = totals.net - paid;
  const cashLine = payments.find((p) => p.method === 'CASH');
  const change = cashLine && tendered !== null && cashLine.amount !== null ? tendered - cashLine.amount : 0;

  const add = (p: Product) => {
    const avail = p.qtyAvailable ?? 0;
    setLines((ls) => {
      const ex = ls.find((l) => l.product._id === p._id);
      if (ex) {
        if (ex.qty + 1 > avail) {
          toast.warning(`Only ${avail} × ${p.sku} available`);
          return ls;
        }
        return ls.map((l) => (l.product._id === p._id ? { ...l, qty: l.qty + 1 } : l));
      }
      if (avail <= 0) {
        toast.error(`${p.sku} is out of stock`);
        return ls;
      }
      return [...ls, { product: p, qty: 1, unitPrice: p.sellingPrice, discount: 0 }];
    });
    setCheckoutKey(newIdempotencyKey('sale'));
  };
  const upd = (id: string, patch: Partial<CartLine>) => {
    setLines((ls) => ls.map((l) => (l.product._id === id ? { ...l, ...patch } : l)));
    setCheckoutKey(newIdempotencyKey('sale'));
  };

  /** Enter in the search box: exact barcode/SKU/part number lookup (scanner), else first result. */
  const onSearchEnter = async () => {
    const code = query.trim();
    if (!code) return;
    try {
      const p = await get<Product>('/products/lookup', { code });
      add(p);
      setQuery('');
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        if (results.length === 1) {
          add(results[0]);
          setQuery('');
        } else if (!results.length) toast.error(`No product matches "${code}"`);
      } else toast.error(errorMessage(e));
    }
  };

  const reset = () => {
    setLines([]);
    setCartDiscount(0);
    setCustomer(null);
    setPayments([{ method: 'CASH', amount: null, reference: '' }]);
    setTendered(null);
    setNotes('');
    setOverrideMin(false);
    setCheckoutKey(newIdempotencyKey('sale'));
  };

  const checkout = async () => {
    if (!lines.length) return toast.error('The cart is empty');
    const pays = payments.filter((p) => (p.amount ?? 0) > 0);
    if (balance < 0) return toast.error('Payments exceed the total. Record only what is due and give change for cash.');
    if (balance > 0 && !customer) return toast.error('Unpaid balance: select a registered customer for a credit sale, or take full payment.');
    setBusy(true);
    try {
      const r = await post(
        '/sales',
        {
          customerId: customer?._id,
          items: lines.map((l) => ({
            productId: l.product._id,
            qty: l.qty,
            ...(l.unitPrice !== l.product.sellingPrice ? { unitPrice: l.unitPrice } : {}),
            ...(l.discount ? { discount: l.discount } : {}),
          })),
          cartDiscount: cartDiscount ?? 0,
          payments: pays.map((p) => ({ method: p.method, amount: p.amount!, reference: p.reference || undefined })),
          notes: notes || undefined,
          overrideMinimumPrice: overrideMin || undefined,
        },
        checkoutKey,
      );
      setDone({ ...r, change: change > 0 ? change : 0 });
      invalidatePrefixes(qc, ['/sales', '/products', '/inventory', '/customers', '/finance', '/reports', '/customer-payments']);
      reset();
    } catch (e) {
      toast.error(errorMessage(e), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Point of Sale"
        description="F2 search · scan a barcode and press Enter · F9 checkout"
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/sales">Sales history</Link>
          </Button>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        {/* Left: search + cart */}
        <div className="grid content-start gap-4">
          <Card className="p-3">
            <div className="relative">
              <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchRef}
                autoFocus
                className="h-12 pl-11 text-base"
                placeholder="Search name, SKU, barcode or part number…"
                aria-label="Search products"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), void onSearchEnter())}
              />
              {searching && <Spinner className="absolute right-3 top-1/2 -translate-y-1/2" />}
            </div>
            {results.length > 0 && (
              <ul className="mt-2 max-h-80 divide-y overflow-y-auto rounded-md border" aria-label="Search results">
                {results.map((p) => (
                  <li key={p._id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent disabled:opacity-50 cursor-pointer"
                      onClick={() => (add(p), setQuery(''), searchRef.current?.focus())}
                      disabled={(p.qtyAvailable ?? 0) <= 0}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">
                          {p.name} <span className="text-xs text-muted-foreground">{p.sku}</span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[p.brandName, p.manufacturerPartNumber, p.storageLocation && `Shelf ${p.storageLocation}`].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <Badge variant={(p.qtyAvailable ?? 0) <= 0 ? 'destructive' : (p.qtyAvailable ?? 0) <= p.reorderPoint ? 'warning' : 'success'}>{p.qtyAvailable ?? 0} avail.</Badge>
                      <span className="w-24 text-right font-semibold tabular">{money(p.sellingPrice)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {dq && !searching && results.length === 0 && <p className="mt-2 px-1 text-sm text-muted-foreground">No products match “{dq}”.</p>}
          </Card>

          <Card>
            {lines.length === 0 ? (
              <EmptyState icon={ShoppingCart} title="Cart is empty" description="Search or scan products to add them." />
            ) : (
              <ul className="divide-y" aria-label="Cart">
                {lines.map((l) => {
                  const avail = l.product.qtyAvailable ?? 0;
                  const lineTotal = l.qty * l.unitPrice - l.discount;
                  return (
                    <li key={l.product._id} className="grid gap-2 p-3 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                      <div className="min-w-0">
                        <div className="font-medium">{l.product.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {l.product.sku} · {avail} available · list {money(l.product.sellingPrice)}
                          {l.product.minimumSellingPrice > 0 && ` · min ${money(l.product.minimumSellingPrice)}`}
                        </div>
                        {canDiscount && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              Unit price
                              <MoneyInput
                                className="w-28"
                                aria-label={`Unit price ${l.product.sku}`}
                                value={l.unitPrice}
                                onChange={(c) => upd(l.product._id, { unitPrice: c ?? l.product.sellingPrice })}
                              />
                            </label>
                            <label className="flex items-center gap-1 text-xs text-muted-foreground">
                              Line discount
                              <MoneyInput className="w-28" aria-label={`Discount ${l.product.sku}`} value={l.discount} onChange={(c) => upd(l.product._id, { discount: c ?? 0 })} />
                            </label>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={`Decrease ${l.product.sku}`}
                          onClick={() => (l.qty > 1 ? upd(l.product._id, { qty: l.qty - 1 }) : setLines((ls) => ls.filter((x) => x !== l)))}
                        >
                          <Minus />
                        </Button>
                        <Input
                          aria-label={`Quantity ${l.product.sku}`}
                          className="w-16 text-center"
                          type="number"
                          min={1}
                          max={avail}
                          value={l.qty}
                          onChange={(e) => {
                            const n = Math.floor(Number(e.target.value));
                            if (n > avail) toast.warning(`Only ${avail} available`);
                            upd(l.product._id, { qty: Math.max(1, Math.min(n || 1, avail)) });
                          }}
                        />
                        <Button variant="outline" size="icon" aria-label={`Increase ${l.product.sku}`} disabled={l.qty >= avail} onClick={() => upd(l.product._id, { qty: l.qty + 1 })}>
                          <Plus />
                        </Button>
                      </div>
                      <div className="flex items-center justify-between gap-2 sm:justify-end">
                        <span className="w-28 text-right text-base font-semibold tabular">{money(lineTotal)}</span>
                        <Button variant="ghost" size="icon" aria-label={`Remove ${l.product.sku}`} onClick={() => setLines((ls) => ls.filter((x) => x !== l))}>
                          <Trash2 />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Right: customer, totals, payments */}
        <Card className="h-fit p-4 xl:sticky xl:top-4">
          <div className="grid gap-4">
            <Field label="Customer" hint="Walk-in sales must be paid in full. Credit needs a customer with a credit limit.">
              <AsyncPicker
                load={searchCustomers}
                value={customer}
                onChange={setCustomer}
                placeholder="Walk-in customer — search to select…"
                render={(c) => (
                  <span className="flex items-center gap-2">
                    <UserRound className="size-4 text-muted-foreground" />
                    <span className="truncate">{c.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {c.receivable > 0 && `owes ${money(c.receivable)}`} {c.creditLimit > 0 ? `· limit ${money(c.creditLimit)}` : '· cash only'}
                    </span>
                  </span>
                )}
              />
            </Field>

            <dl className="space-y-1.5 rounded-lg bg-muted/50 p-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Items</dt>
                <dd className="tabular">{lines.reduce((s, l) => s + l.qty, 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="tabular">{money(totals.gross)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-muted-foreground">Cart discount</dt>
                <dd>
                  {canDiscount ? (
                    <MoneyInput className="w-28" aria-label="Cart discount" value={cartDiscount} onChange={(c) => (setCartDiscount(c), setCheckoutKey(newIdempotencyKey('sale')))} />
                  ) : (
                    <span className="tabular">{money(0)}</span>
                  )}
                </dd>
              </div>
              {totals.discountTotal > 0 && (
                <div className="flex justify-between text-destructive">
                  <dt>Total discounts</dt>
                  <dd className="tabular">−{money(totals.discountTotal)}</dd>
                </div>
              )}
              {settings && settings.taxRateBps > 0 && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <dt>{settings.taxName}</dt>
                  <dd>{settings.pricesIncludeTax ? 'included in prices' : `${settings.taxRateBps / 100}% added at checkout`}</dd>
                </div>
              )}
              <div className="flex justify-between border-t pt-2 text-xl font-bold">
                <dt>Total</dt>
                <dd className="tabular" data-testid="pos-total">
                  {money(totals.net)}
                </dd>
              </div>
            </dl>

            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Payments</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPayments((ps) => ps.map((p, i) => (i === 0 ? { ...p, amount: Math.max(totals.net - ps.slice(1).reduce((s, x) => s + (x.amount ?? 0), 0), 0) } : p)))}
                  >
                    Exact amount
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setPayments((ps) => [...ps, { method: 'MOBILE_MONEY', amount: null, reference: '' }])}>
                    <Plus /> Split
                  </Button>
                </div>
              </div>
              {payments.map((p, i) => (
                <div key={i} className="grid grid-cols-[1fr_120px_auto] gap-2">
                  <Select
                    aria-label={`Payment method ${i + 1}`}
                    value={p.method}
                    onChange={(e) => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentLine['method'] } : x)))}
                  >
                    {(['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'STORE_CREDIT'] as const).map((m) => (
                      <option key={m} value={m} disabled={m === 'STORE_CREDIT' && !customer}>
                        {methodLabel(m)}
                      </option>
                    ))}
                  </Select>
                  <MoneyInput aria-label={`Payment amount ${i + 1}`} value={p.amount} onChange={(c) => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, amount: c } : x)))} />
                  <Button type="button" variant="ghost" size="icon" aria-label="Remove payment" disabled={payments.length === 1} onClick={() => setPayments((ps) => ps.filter((_, j) => j !== i))}>
                    <X />
                  </Button>
                  {p.method !== 'CASH' && p.method !== 'STORE_CREDIT' && (
                    <Input
                      className="col-span-3"
                      placeholder="Reference (transaction ID)"
                      aria-label={`Payment reference ${i + 1}`}
                      value={p.reference}
                      onChange={(e) => setPayments((ps) => ps.map((x, j) => (j === i ? { ...x, reference: e.target.value } : x)))}
                    />
                  )}
                </div>
              ))}
              {cashLine && (
                <div className="grid grid-cols-[1fr_120px] items-center gap-2 text-sm">
                  <label htmlFor="tendered" className="text-muted-foreground">
                    Cash tendered (for change)
                  </label>
                  <MoneyInput id="tendered" value={tendered} onChange={setTendered} />
                  {change > 0 && (
                    <p className="col-span-2 rounded-md bg-success/10 px-3 py-2 font-semibold text-success">
                      <Banknote className="mr-1 inline size-4" /> Change due: {money(change)}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div
              className={cn('rounded-md px-3 py-2 text-sm font-medium', balance > 0 ? 'bg-warning/15' : balance < 0 ? 'bg-destructive/10 text-destructive' : 'bg-success/10 text-success')}
              data-testid="pos-balance"
            >
              {lines.length === 0
                ? 'Add items to begin'
                : balance > 0
                  ? `Unpaid ${money(balance)} → ${customer ? 'credit sale (receivable)' : 'select a customer or take full payment'}`
                  : balance < 0
                    ? `Payments exceed total by ${money(-balance)}`
                    : 'Fully paid'}
            </div>
            {canDiscount && lines.some((l) => l.product.minimumSellingPrice > 0 && l.unitPrice * l.qty - l.discount < l.product.minimumSellingPrice * l.qty) && (
              <Checkbox label="Approve selling below the minimum price (recorded in the audit log)" checked={overrideMin} onChange={(e) => setOverrideMin(e.target.checked)} />
            )}
            <Field label="Notes">
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional (vehicle, plate…)" />
            </Field>
            <div className="grid grid-cols-[auto_1fr] gap-2">
              <Button variant="outline" onClick={reset} disabled={busy || !lines.length} aria-label="Clear cart">
                <Trash2 />
              </Button>
              <Button id="pos-checkout" size="lg" onClick={checkout} loading={busy} disabled={!lines.length}>
                <CheckCircle2 /> Complete sale · {money(totals.net)}
              </Button>
            </div>
          </div>
        </Card>
      </div>
      {done && <SaleCompleteDialog result={done} onClose={() => (setDone(null), searchRef.current?.focus())} />}
    </div>
  );
}

function SaleCompleteDialog({ result, onClose }: { result: any; onClose: () => void }) {
  const s = result.sale;
  const thermal = useMemo(() => fileUrl(`/sales/${s._id}/invoice`, { format: 'thermal' }), [s._id]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={result.replayed ? 'Sale already recorded' : 'Sale completed'}
        description={result.replayed ? 'This checkout was already processed; no duplicate was created.' : `Invoice ${s.invoiceNo}`}
      >
        <div className="grid gap-2 rounded-lg border p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice</span>
            <strong>{s.invoiceNo}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Customer</span>
            <span>{s.customerName}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total</span>
            <strong className="tabular">{money(s.total)}</strong>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Paid</span>
            <span className="tabular">{money(s.amountPaid)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Balance due</span>
            <span className={cn('tabular', s.balanceDue > 0 && 'font-semibold text-warning')}>{money(s.balanceDue)}</span>
          </div>
          {result.change > 0 && (
            <div className="flex justify-between text-base font-semibold text-success">
              <span>Change to give</span>
              <span className="tabular">{money(result.change)}</span>
            </div>
          )}
        </div>
        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <a href={thermal} target="_blank" rel="noreferrer">
                <Printer /> Receipt
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={fileUrl(`/sales/${s._id}/invoice`, { format: 'a4' })} target="_blank" rel="noreferrer">
                <FileText /> A4 invoice
              </a>
            </Button>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" asChild>
              <Link to={`/sales/${s._id}`}>View sale</Link>
            </Button>
            <Button onClick={onClose} autoFocus>
              <Search /> New sale
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
