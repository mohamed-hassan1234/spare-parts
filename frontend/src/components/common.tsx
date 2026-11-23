import * as React from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ChevronLeft, ChevronRight, Download, FileSpreadsheet, FileText, Inbox, Search, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogFooter,
  Field,
  Input,
  Select,
  Skeleton,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Textarea,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui';
import { cn, inputToCents, centsToInput, todayInput } from '@/lib/format';
import { errorMessage } from '@/lib/hooks';
import { fileUrl, type Query } from '@/lib/api';

/* ------------------------------ Page header ------------------------------ */
export function PageHeader({ title, description, actions, back }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; back?: string }) {
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back} className="mb-1 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground no-print">
            <ChevronLeft className="size-4" /> Back
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: string; action?: React.ReactNode; icon?: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <div className="rounded-full bg-muted p-3">
        <Icon className="size-6 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <AlertTriangle className="size-6 text-destructive" />
      <p className="font-medium">Could not load data</p>
      <p className="max-w-md text-sm text-muted-foreground">{errorMessage(error)}</p>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingBlock({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

/* -------------------------------- Stat card ------------------------------- */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
  to,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: 'default' | 'success' | 'warning' | 'destructive';
  to?: string;
  loading?: boolean;
}) {
  const toneCls = { default: 'text-primary bg-primary/10', success: 'text-success bg-success/12', warning: 'text-warning bg-warning/15', destructive: 'text-destructive bg-destructive/10' }[tone];
  const body = (
    <Card role="group" aria-label={label} className={cn('h-full p-4 transition-shadow', to && 'hover:shadow-md')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon && (
          <span className={cn('rounded-md p-1.5', toneCls)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      {loading ? <Skeleton className="mt-2 h-7 w-24" /> : <p className="mt-1 text-xl font-semibold tabular sm:text-2xl">{value}</p>}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/* ------------------------------- Money input ------------------------------ */
/** Text input for a money amount; value/onChange are integer cents (null when empty/invalid). */
export const MoneyInput = React.forwardRef<
  HTMLInputElement,
  {
    value: number | null | undefined;
    onChange: (cents: number | null) => void;
    id?: string;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    'aria-label'?: string;
    className?: string;
    invalid?: boolean;
  }
>(({ value, onChange, invalid, className, ...rest }, ref) => {
  const [text, setText] = React.useState(centsToInput(value ?? null));
  const last = React.useRef(value);
  React.useEffect(() => {
    if (value !== last.current) {
      last.current = value;
      if (inputToCents(text) !== value) setText(centsToInput(value ?? null));
    }
  }, [value, text]);
  const bad = text !== '' && inputToCents(text) === null;
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
      <Input
        ref={ref}
        inputMode="decimal"
        autoComplete="off"
        className="pl-6 text-right tabular"
        aria-invalid={bad || !!invalid}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const c = inputToCents(e.target.value);
          last.current = c;
          onChange(c);
        }}
        {...rest}
      />
    </div>
  );
});
MoneyInput.displayName = 'MoneyInput';

/* ------------------------------ Period filter ----------------------------- */
export const PERIODS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['last7', 'Last 7 days'],
  ['last30', 'Last 30 days'],
  ['thisMonth', 'This month'],
  ['prevMonth', 'Previous month'],
  ['thisYear', 'This year'],
  ['all', 'All time'],
  ['custom', 'Custom range'],
] as const;

export interface PeriodValue {
  period: string;
  from?: string;
  to?: string;
}
export const periodQuery = (p: PeriodValue): Query => (p.period === 'custom' ? { period: 'custom', from: p.from, to: p.to } : { period: p.period });

export function PeriodFilter({ value, onChange, className }: { value: PeriodValue; onChange: (v: PeriodValue) => void; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Select
        aria-label="Reporting period"
        className="w-40"
        value={value.period}
        onChange={(e) => onChange({ ...value, period: e.target.value, from: value.from ?? todayInput(), to: value.to ?? todayInput() })}
      >
        {PERIODS.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </Select>
      {value.period === 'custom' && (
        <>
          <Input type="date" aria-label="From date" className="w-38" value={value.from ?? ''} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          <span className="text-sm text-muted-foreground">to</span>
          <Input type="date" aria-label="To date" className="w-38" value={value.to ?? ''} onChange={(e) => onChange({ ...value, to: e.target.value })} />
        </>
      )}
    </div>
  );
}

/* ------------------------------- Export menu ------------------------------ */
/** Downloads come straight from the backend, so files always match the server-side calculation. */
export function ExportMenu({ path, query, formats = ['csv', 'xlsx', 'pdf'] }: { path: string; query?: Query; formats?: ('csv' | 'xlsx' | 'pdf')[] }) {
  const icon = { csv: FileText, xlsx: FileSpreadsheet, pdf: FileText } as const;
  const label = { csv: 'CSV', xlsx: 'Excel (.xlsx)', pdf: 'PDF' } as const;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download /> Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {formats.map((f) => {
          const I = icon[f];
          return (
            <DropdownMenuItem key={f} asChild>
              <a href={fileUrl(path, { ...query, format: f })} download>
                <I /> {label[f]}
              </a>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/* ----------------------------- Confirm dialogs ---------------------------- */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  destructive,
  requireReason,
  reasonLabel = 'Reason',
  onConfirm,
  loading,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
  requireReason?: boolean;
  reasonLabel?: string;
  onConfirm: (reason: string) => void | Promise<void>;
  loading?: boolean;
}) {
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (!open) setReason('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} role="alertdialog">
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (requireReason && reason.trim().length < 3) return;
            void onConfirm(reason.trim());
          }}
        >
          {requireReason && (
            <Field label={reasonLabel} htmlFor="confirm-reason" required hint="At least 3 characters. Stored in the audit trail.">
              <Textarea id="confirm-reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? 'destructive' : 'default'} loading={loading} disabled={requireReason && reason.trim().length < 3}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* -------------------------------- DataTable ------------------------------- */
export interface Column<T = any> {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  sort?: string;
  className?: string;
  align?: 'right' | 'center';
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className={cn('relative w-full sm:w-72', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="pl-9" autoFocus={autoFocus} />
    </div>
  );
}

export function DataTable<T = any>({
  columns,
  rows,
  loading,
  error,
  retry,
  empty,
  sort,
  onSort,
  rowKey,
  onRowClick,
  footer,
}: {
  columns: Column<T>[];
  rows: T[] | undefined;
  loading?: boolean;
  error?: unknown;
  retry?: () => void;
  empty?: React.ReactNode;
  sort?: string;
  onSort?: (s: string) => void;
  rowKey?: (r: T, i: number) => string;
  onRowClick?: (r: T) => void;
  footer?: React.ReactNode;
}) {
  if (error) return <ErrorState error={error} retry={retry} />;
  if (loading && !rows) return <LoadingBlock />;
  if (!rows || rows.length === 0) return <>{empty ?? <EmptyState title="Nothing here yet" />}</>;
  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          {columns.map((c) => {
            const active = sort?.replace(/^-/, '') === c.sort;
            const desc = sort?.startsWith('-');
            return (
              <TH
                key={c.key}
                className={cn(c.align === 'right' && 'text-right', c.align === 'center' && 'text-center', c.className)}
                aria-sort={active ? (desc ? 'descending' : 'ascending') : undefined}
              >
                {c.sort && onSort ? (
                  <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-foreground cursor-pointer" onClick={() => onSort(active && !desc ? `-${c.sort}` : c.sort!)}>
                    {c.header}
                    {active ? desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" /> : <ArrowUpDown className="size-3 opacity-50" />}
                  </button>
                ) : (
                  c.header
                )}
              </TH>
            );
          })}
        </TR>
      </THead>
      <TBody>
        {rows.map((r, i) => (
          <TR
            key={rowKey ? rowKey(r, i) : String((r as any)._id ?? (r as any).id ?? i)}
            className={cn(onRowClick && 'cursor-pointer', loading && 'opacity-60')}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            tabIndex={onRowClick ? 0 : undefined}
            onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(r) : undefined}
          >
            {columns.map((c) => (
              <TD key={c.key} className={cn(c.align === 'right' && 'text-right tabular', c.align === 'center' && 'text-center', c.className)}>
                {c.cell(r)}
              </TD>
            ))}
          </TR>
        ))}
      </TBody>
      {footer}
    </Table>
  );
}

export function Pagination({ page, pages, total, onPage, limit, onLimit }: { page: number; pages: number; total: number; onPage: (p: number) => void; limit?: number; onLimit?: (l: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 text-sm sm:flex-row">
      <span className="text-muted-foreground">
        {total.toLocaleString()} record{total === 1 ? '' : 's'} · page {page} of {Math.max(pages, 1)}
      </span>
      <div className="flex items-center gap-2">
        {onLimit && (
          <Select aria-label="Rows per page" className="h-8 w-20" value={limit} onChange={(e) => onLimit(Number(e.target.value))}>
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        )}
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

/** List page state: page, limit, sort, search and extra filters. */
export function useListState(defaults: { sort?: string; limit?: number; filters?: Record<string, string> } = {}) {
  const [page, setPage] = React.useState(1);
  const [limit, setLimit] = React.useState(defaults.limit ?? 25);
  const [sort, setSort] = React.useState(defaults.sort);
  const [search, setSearchRaw] = React.useState('');
  const [filters, setFiltersRaw] = React.useState<Record<string, string>>(defaults.filters ?? {});
  const setSearch = (s: string) => {
    setSearchRaw(s);
    setPage(1);
  };
  const setFilter = (k: string, v: string) => {
    setFiltersRaw((f) => ({ ...f, [k]: v }));
    setPage(1);
  };
  return { page, setPage, limit, setLimit: (l: number) => (setLimit(l), setPage(1)), sort, setSort, search, setSearch, filters, setFilter };
}

/* ------------------------------ Async picker ------------------------------ */
/** Searchable picker backed by a paginated list endpoint (customers, suppliers, products…). */
export function AsyncPicker<T extends { _id: string }>({
  id,
  load,
  value,
  onChange,
  render,
  placeholder = 'Search…',
  allowClear = true,
}: {
  id?: string;
  load: (search: string) => Promise<T[]>;
  value: T | null;
  onChange: (v: T | null) => void;
  render: (v: T) => React.ReactNode;
  placeholder?: string;
  allowClear?: boolean;
}) {
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<T[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const listId = React.useId();
  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    setBusy(true);
    const t = setTimeout(() => {
      load(q)
        .then((r) => alive && (setItems(r), setActive(0)))
        .catch(() => alive && setItems([]))
        .finally(() => alive && setBusy(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, open, load]);

  if (value) {
    return (
      <div className="flex min-h-9 items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1.5 text-sm">
        <div className="min-w-0 truncate">{render(value)}</div>
        {allowClear && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)} aria-label="Clear selection">
            Change
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          }
          if (e.key === 'Enter' && open && items[active]) {
            e.preventDefault();
            onChange(items[active]);
            setOpen(false);
            setQ('');
          }
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-card p-1 shadow-lg">
          {busy && items.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">Searching…</li>}
          {!busy && items.length === 0 && <li className="px-2 py-1.5 text-sm text-muted-foreground">No matches</li>}
          {items.map((it, i) => (
            <li
              key={it._id}
              role="option"
              aria-selected={i === active}
              className={cn('cursor-pointer rounded-sm px-2 py-1.5 text-sm', i === active && 'bg-accent')}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(it);
                setOpen(false);
                setQ('');
              }}
            >
              {render(it)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function KeyValue({ items, className }: { items: [React.ReactNode, React.ReactNode][]; className?: string }) {
  return (
    <dl className={cn('grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2', className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-dashed pb-2 sm:block sm:border-0 sm:pb-0">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium sm:mt-0.5">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Error boundary so one broken widget never blanks the whole app. */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode; fallback?: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(error);
  }
  render() {
    if (this.state.error)
      return (
        this.props.fallback ?? (
          <Card className="m-4 p-6">
            <ErrorState error={this.state.error} retry={() => this.setState({ error: null })} />
          </Card>
        )
      );
    return this.props.children;
  }
}
