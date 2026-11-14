import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Bell, CheckCheck, Database, Download, HardDriveDownload, KeyRound, LogOut, ShieldCheck, Upload } from 'lucide-react';
import { api, del, fileUrl, patch, post } from '@/lib/api';
import { errorMessage, useAction, useApi, useDebounced, usePage } from '@/lib/hooks';
import { useAuth } from '@/lib/auth';
import { cn, dateTime, titleCase } from '@/lib/format';
import { DataTable, EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination, SearchInput, useListState } from '@/components/common';
import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Checkbox, Dialog, DialogContent, Field, Input, Select, StatusBadge, Textarea } from '@/components/ui';

/* ============================= Notifications ============================= */
export function NotificationsPage() {
  const ls = useListState({ sort: '-createdAt' });
  const list = usePage('/notifications', { page: ls.page, limit: ls.limit, ...ls.filters });
  const read = useAction((id: string) => post(`/notifications/${id}/read`), { invalidate: ['/notifications'] });
  const readAll = useAction(() => post('/notifications/read-all'), { success: 'All notifications marked as read', invalidate: ['/notifications'] });
  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Low and out-of-stock items, overdue debts, upcoming supplier payments, slow-moving stock, failed backups and suspicious sign-in activity."
        actions={
          <Button variant="outline" size="sm" onClick={() => readAll.mutate()} loading={readAll.isPending} disabled={!list.data?.unread}>
            <CheckCheck /> Mark all read
          </Button>
        }
      />
      <Card>
        <div className="flex items-center gap-3 border-b p-3">
          <Checkbox label="Unread only" checked={ls.filters.unread === 'true'} onChange={(e) => ls.setFilter('unread', e.target.checked ? 'true' : '')} />
          <span className="text-sm text-muted-foreground">{list.data?.unread ?? 0} unread</span>
        </div>
        {list.error ? (
          <ErrorState error={list.error} />
        ) : !list.data ? (
          <LoadingBlock />
        ) : list.data.items.length === 0 ? (
          <EmptyState icon={Bell} title="You're all caught up" />
        ) : (
          <ul className="divide-y">
            {list.data.items.map((n: any) => (
              <li key={n._id} className={cn('flex items-start gap-3 p-4', !n.isRead && 'bg-primary/5')}>
                <span
                  className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.severity === 'critical' ? 'bg-destructive' : n.severity === 'warning' ? 'bg-warning' : 'bg-primary', n.isRead && 'opacity-30')}
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', !n.isRead && 'font-semibold')}>{n.title}</p>
                  <p className="text-sm text-muted-foreground">{n.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {dateTime(n.createdAt)} · {titleCase(n.type)}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {n.link && (
                    <Button variant="ghost" size="sm" asChild onClick={() => !n.isRead && read.mutate(n._id)}>
                      <Link to={n.link.replace('/inventory/products/', '/products/').replace('/admin/backups', '/backups')}>Open</Link>
                    </Button>
                  )}
                  {!n.isRead && (
                    <Button variant="ghost" size="sm" onClick={() => read.mutate(n._id)}>
                      Mark read
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} />
      </Card>
    </div>
  );
}

/* =============================== Audit logs =============================== */
export function AuditLogsPage() {
  const ls = useListState({ sort: '-at' });
  const list = usePage('/audit-logs', { page: ls.page, limit: ls.limit, search: useDebounced(ls.search), ...ls.filters });
  const [view, setView] = useState<any>(null);
  const [tab, setTab] = useState<'audit' | 'logins'>('audit');
  const logins = useApi<any[]>(tab === 'logins' ? '/auth/login-activity' : null);
  return (
    <div>
      <PageHeader title="Audit logs" description="Append-only record of sensitive actions with actor, time, IP and before/after values. Audit records cannot be edited from the application." />
      <div className="mb-3 flex gap-2">
        <Button size="sm" variant={tab === 'audit' ? 'default' : 'outline'} onClick={() => setTab('audit')}>
          Activity
        </Button>
        <Button size="sm" variant={tab === 'logins' ? 'default' : 'outline'} onClick={() => setTab('logins')}>
          Sign-in attempts
        </Button>
      </div>
      {tab === 'audit' ? (
        <Card>
          <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
            <SearchInput value={ls.search} onChange={ls.setSearch} placeholder="Action, user, summary…" />
            <Select aria-label="Entity" className="sm:w-48" value={ls.filters.entity ?? ''} onChange={(e) => ls.setFilter('entity', e.target.value)}>
              <option value="">All entities</option>
              {['Product', 'Sale', 'Purchase', 'CustomerReturn', 'CustomerPayment', 'SupplierPayment', 'Expense', 'StockAdjustment', 'Settings', 'Session', 'User', 'Backup', 'JournalEntry'].map(
                (e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ),
              )}
            </Select>
          </div>
          <DataTable
            rows={list.data?.items}
            loading={list.isFetching}
            error={list.error}
            onRowClick={setView}
            empty={<EmptyState title="No audit records" />}
            columns={[
              { key: 'at', header: 'When', cell: (r) => dateTime(r.at) },
              { key: 'u', header: 'User', cell: (r) => r.userName ?? '—' },
              { key: 'a', header: 'Action', cell: (r) => <span className="font-mono text-xs">{r.action}</span> },
              { key: 'e', header: 'Entity', cell: (r) => r.entity },
              { key: 's', header: 'Summary', cell: (r) => <span className="line-clamp-1 max-w-96">{r.summary ?? ''}</span> },
              { key: 'ip', header: 'IP', cell: (r) => <span className="text-xs text-muted-foreground">{r.ip}</span> },
            ]}
          />
          <Pagination page={ls.page} pages={list.data?.pages ?? 1} total={list.data?.total ?? 0} onPage={ls.setPage} limit={ls.limit} onLimit={ls.setLimit} />
        </Card>
      ) : (
        <Card>
          <DataTable
            rows={logins.data}
            loading={logins.isLoading}
            error={logins.error}
            empty={<EmptyState title="No sign-in attempts recorded" />}
            columns={[
              { key: 'at', header: 'When', cell: (r) => dateTime(r.at) },
              { key: 'u', header: 'Username', cell: (r) => r.username },
              { key: 'r', header: 'Result', cell: (r) => (r.success ? <Badge variant="success">Success</Badge> : <Badge variant="destructive">{titleCase(r.reason ?? 'failed')}</Badge>) },
              { key: 'ip', header: 'IP', cell: (r) => r.ip },
              { key: 'ua', header: 'Device', cell: (r) => <span className="line-clamp-1 max-w-80 text-xs text-muted-foreground">{r.userAgent}</span> },
            ]}
          />
        </Card>
      )}
      {view && (
        <Dialog open onOpenChange={(o) => !o && setView(null)}>
          <DialogContent title={view.action} description={`${dateTime(view.at)} · ${view.userName ?? 'system'} · ${view.ip ?? ''}`} wide>
            <div className="grid gap-2 text-sm">
              <p>
                <strong>Entity:</strong> {view.entity} {view.entityId}
              </p>
              {view.summary && <p>{view.summary}</p>}
              {view.correlationId && <p className="text-xs text-muted-foreground">Request {view.correlationId}</p>}
              {(view.before || view.after) && (
                <div className="grid gap-2 md:grid-cols-2">
                  {(['before', 'after'] as const).map((k) => (
                    <div key={k}>
                      <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{k}</p>
                      <pre className="max-h-80 overflow-auto rounded-md bg-muted p-2 text-xs">{view[k] ? JSON.stringify(view[k], null, 2) : '—'}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ================================ Backups ================================ */
export function BackupsPage() {
  const q = useApi('/backups');
  const create = useAction(() => post('/backups'), { success: (r: any) => `Backup ${r.fileName} created and verified`, invalidate: ['/backups'] });
  const verify = useAction((id: string) => post(`/backups/${id}/verify`), {
    success: (r: any) => (r.verified ? 'Backup verified: decrypts and matches its manifest' : 'Backup FAILED verification'),
    invalidate: ['/backups'],
  });
  return (
    <div>
      <PageHeader
        title="Backup and restore"
        description="Encrypted (AES-256-GCM), compressed, checksummed backups. Each backup is read back and verified after writing."
        actions={
          <Button size="sm" onClick={() => create.mutate()} loading={create.isPending} disabled={!q.data?.encryptionConfigured}>
            <HardDriveDownload /> Back up now
          </Button>
        }
      />
      {q.data && !q.data.encryptionConfigured && (
        <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">BACKUP_ENCRYPTION_KEY is not configured on the server. Backups cannot be created until it is set.</p>
      )}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {q.data
              ? q.data.scheduleHours > 0
                ? `Automatic backup every ${q.data.scheduleHours} hours (server setting BACKUP_SCHEDULE_HOURS). Failures raise a critical notification.`
                : 'Scheduled backups are disabled.'
              : '…'}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Restoring</CardTitle>
            <CardDescription>Restores run from the server console only, never from the browser.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p>Restore into a new database first and check it:</p>
            <code className="rounded bg-muted px-2 py-1 text-xs">npm run restore -w server -- &lt;file&gt; --target autoparts_restore_check</code>
            <p className="text-muted-foreground">
              Replacing the live database needs <code>--force-live</code>, typed confirmation, and takes a pre-restore backup automatically. See BACKUP_AND_RESTORE.md.
            </p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <DataTable
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error}
          empty={<EmptyState icon={Database} title="No backups yet" />}
          columns={[
            { key: 'd', header: 'Created', cell: (b) => dateTime(b.createdAt) },
            { key: 'k', header: 'Kind', cell: (b) => titleCase(b.kind) },
            { key: 's', header: 'Status', cell: (b) => <StatusBadge status={b.status} /> },
            { key: 'v', header: 'Verified', cell: (b) => (b.status === 'SUCCEEDED' ? b.verified ? <Badge variant="success">Verified</Badge> : <Badge variant="destructive">Not verified</Badge> : '') },
            { key: 'f', header: 'File', cell: (b) => <span className="font-mono text-xs">{b.fileName ?? b.error}</span> },
            { key: 'z', header: 'Size', align: 'right', cell: (b) => (b.sizeBytes ? `${(b.sizeBytes / 1024).toFixed(1)} KB` : '') },
            {
              key: 'x',
              header: '',
              align: 'right',
              cell: (b) =>
                b.status === 'SUCCEEDED' && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => verify.mutate(b._id)} loading={verify.isPending && verify.variables === b._id}>
                      Verify
                    </Button>
                    <Button variant="ghost" size="icon" asChild aria-label="Download backup">
                      <a href={fileUrl(`/backups/${b._id}/download`)} download>
                        <Download />
                      </a>
                    </Button>
                  </div>
                ),
            },
          ]}
        />
      </Card>
    </div>
  );
}

/* ============================ Business settings ============================ */
export function SettingsPage() {
  const { can, refresh } = useAuth();
  const q = useApi('/settings');
  if (q.isLoading) return <LoadingBlock rows={10} />;
  if (q.error) return <ErrorState error={q.error} />;
  return <SettingsForm initial={q.data} readOnly={!can('settings:write')} onSaved={refresh} />;
}

function SettingsForm({ initial, readOnly, onSaved }: { initial: any; readOnly: boolean; onSaved: () => void }) {
  const [s, setS] = useState<any>(initial);
  const set = (k: string, v: unknown) => setS((x: any) => ({ ...x, [k]: v }));
  const logoRef = useRef<HTMLInputElement>(null);
  const save = useAction(
    () =>
      patch('/settings', {
        businessName: s.businessName,
        address: s.address ?? '',
        phone: s.phone ?? '',
        email: s.email ?? '',
        receiptFooter: s.receiptFooter ?? '',
        currency: s.currency,
        timezone: s.timezone,
        invoicePrefix: s.invoicePrefix,
        purchasePrefix: s.purchasePrefix,
        taxRateBps: Math.round(Number(s.taxRatePct ?? s.taxRateBps / 100) * 100),
        taxName: s.taxName,
        pricesIncludeTax: !!s.pricesIncludeTax,
        returnPolicy: s.returnPolicy ?? '',
        warrantyPolicy: s.warrantyPolicy ?? '',
        returnWindowDays: Number(s.returnWindowDays),
        lowStockDefault: Number(s.lowStockDefault),
        deadStockDays: Number(s.deadStockDays),
        allowDuplicateManufacturerPartNumbers: !!s.allowDuplicateManufacturerPartNumbers,
        maxDiscountBpsWithoutApproval: Math.round(Number(s.maxDiscountPct ?? s.maxDiscountBpsWithoutApproval / 100) * 100),
        enforceMinimumPrice: !!s.enforceMinimumPrice,
        sessionIdleMinutes: Number(s.sessionIdleMinutes),
        backupRetentionCount: Number(s.backupRetentionCount),
      }),
    { success: 'Settings saved', invalidate: ['/settings'], onSuccess: onSaved },
  );
  const logo = useAction(
    (f: File) => {
      const fd = new FormData();
      fd.append('logo', f);
      return api('/settings/logo', { method: 'POST', body: fd });
    },
    { success: 'Logo uploaded', invalidate: ['/settings'], onSuccess: (r: any) => set('logoUrl', r.logoUrl) },
  );
  const field = (k: string, label: string, opts: { type?: string; hint?: string; value?: unknown } = {}) => (
    <Field label={label} hint={opts.hint}>
      <Input type={opts.type ?? 'text'} value={(opts.value as string) ?? s[k] ?? ''} disabled={readOnly} onChange={(e) => set(k, e.target.value)} />
    </Field>
  );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <PageHeader
        title="Business settings"
        description="Changes are audited. Issued invoices keep the details they were printed with."
        actions={
          !readOnly && (
            <Button type="submit" loading={save.isPending}>
              Save settings
            </Button>
          )
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Shop details</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {field('businessName', 'Shop name')}
            {field('phone', 'Phone')}
            {field('email', 'Email', { type: 'email' })}
            {field('address', 'Address')}
            <Field label="Logo" className="sm:col-span-2" hint="PNG or JPEG up to 1 MB. Printed on invoices and receipts.">
              <div className="flex items-center gap-3">
                {s.logoUrl ? <img src={s.logoUrl} alt="Shop logo" className="h-12 w-auto rounded border" /> : <span className="text-sm text-muted-foreground">No logo</span>}
                {!readOnly && (
                  <>
                    <input ref={logoRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => e.target.files?.[0] && logo.mutate(e.target.files[0])} />
                    <Button type="button" variant="outline" size="sm" onClick={() => logoRef.current?.click()} loading={logo.isPending}>
                      <Upload /> Upload
                    </Button>
                  </>
                )}
              </div>
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Currency, time & numbering</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {field('currency', 'Currency (ISO code)', { hint: 'All amounts are stored in minor units (cents).' })}
            {field('timezone', 'Business time zone', { hint: 'Reports use this zone; timestamps are stored in UTC.' })}
            {field('invoicePrefix', 'Invoice number prefix')}
            {field('purchasePrefix', 'Purchase number prefix')}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Tax & pricing</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {field('taxName', 'Tax name')}
            <Field label="Tax rate (%)">
              <Input type="number" step="0.01" min={0} max={50} disabled={readOnly} value={s.taxRatePct ?? s.taxRateBps / 100} onChange={(e) => set('taxRatePct', e.target.value)} />
            </Field>
            <Checkbox label="Selling prices include tax" checked={!!s.pricesIncludeTax} disabled={readOnly} onChange={(e) => set('pricesIncludeTax', e.target.checked)} />
            <Checkbox label="Enforce minimum selling prices" checked={!!s.enforceMinimumPrice} disabled={readOnly} onChange={(e) => set('enforceMinimumPrice', e.target.checked)} />
            <Field label="Max discount without approval (%)">
              <Input
                type="number"
                step="0.01"
                min={0}
                max={100}
                disabled={readOnly}
                value={s.maxDiscountPct ?? s.maxDiscountBpsWithoutApproval / 100}
                onChange={(e) => set('maxDiscountPct', e.target.value)}
              />
            </Field>
            <Checkbox
              label="Allow duplicate manufacturer part numbers"
              checked={!!s.allowDuplicateManufacturerPartNumbers}
              disabled={readOnly}
              onChange={(e) => set('allowDuplicateManufacturerPartNumbers', e.target.checked)}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Inventory thresholds</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {field('lowStockDefault', 'Default reorder point', { type: 'number' })}
            {field('deadStockDays', 'Dead stock after (days without sale)', { type: 'number' })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Receipts, returns & warranty</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Receipt footer">
              <Input value={s.receiptFooter ?? ''} disabled={readOnly} onChange={(e) => set('receiptFooter', e.target.value)} />
            </Field>
            {field('returnWindowDays', 'Return window (days)', { type: 'number' })}
            <Field label="Return policy">
              <Textarea value={s.returnPolicy ?? ''} disabled={readOnly} onChange={(e) => set('returnPolicy', e.target.value)} />
            </Field>
            <Field label="Warranty policy">
              <Textarea value={s.warrantyPolicy ?? ''} disabled={readOnly} onChange={(e) => set('warrantyPolicy', e.target.value)} />
            </Field>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Security & backups</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {field('sessionIdleMinutes', 'Sign out after idle (minutes)', { type: 'number' })}
            {field('backupRetentionCount', 'Backups to keep', { type: 'number' })}
          </CardContent>
        </Card>
      </div>
    </form>
  );
}

/* ============================ Security settings ============================ */
export function SecurityPage() {
  const { user, refresh, logout } = useAuth();
  const sessions = useApi<any[]>('/auth/sessions');
  const revoke = useAction((id: string) => del(`/auth/sessions/${id}`), { success: 'Session signed out', invalidate: ['/auth/sessions'] });
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [enroll, setEnroll] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState('');
  const [disablePw, setDisablePw] = useState('');

  const strong = next.length >= 10 && /[a-z]/.test(next) && /[A-Z]/.test(next) && /\d/.test(next);
  const changePassword = async () => {
    if (!strong) return toast.error('Use at least 10 characters with upper case, lower case and a number');
    if (next !== confirm) return toast.error('New passwords do not match');
    setBusy(true);
    try {
      await post('/auth/change-password', { currentPassword: cur, newPassword: next });
      toast.success('Password changed. Other sessions were signed out.');
      setCur('');
      setNext('');
      setConfirm('');
      await refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader title="Security settings" description={`Signed in as ${user?.username} (${user?.role.replace('_', ' ').toLowerCase()}).`} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" /> Change password
            </CardTitle>
            <CardDescription>Passwords are hashed with Argon2id. Changing it signs out all other sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void changePassword();
              }}
            >
              <Field label="Current password" htmlFor="cur">
                <Input id="cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
              </Field>
              <Field label="New password" htmlFor="new" hint="At least 10 characters, with upper case, lower case and a number">
                <Input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
              </Field>
              <Field label="Confirm new password" htmlFor="confirm" error={confirm && confirm !== next ? 'Does not match' : undefined}>
                <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </Field>
              <Button type="submit" loading={busy} disabled={!cur || !next}>
                Change password
              </Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" /> Two-factor authentication
            </CardTitle>
            <CardDescription>Optional TOTP codes from an authenticator app (Google Authenticator, Microsoft Authenticator, Aegis…).</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {user?.totpEnabled ? (
              <>
                <p className="text-success">Two-factor authentication is ON.</p>
                <Field label="Confirm your password to turn it off">
                  <Input type="password" value={disablePw} onChange={(e) => setDisablePw(e.target.value)} />
                </Field>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    try {
                      await post('/auth/2fa/disable', { password: disablePw });
                      toast.success('Two-factor authentication disabled');
                      setDisablePw('');
                      await refresh();
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  Disable 2FA
                </Button>
              </>
            ) : enroll ? (
              <>
                <p>Add this key to your authenticator app (choose “enter a setup key”, time-based):</p>
                <code className="break-all rounded bg-muted px-2 py-2 text-base tracking-wider">{enroll.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                <p className="break-all text-xs text-muted-foreground">{enroll.otpauthUri}</p>
                <Field label="Enter the 6-digit code shown by the app">
                  <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
                </Field>
                <Button
                  onClick={async () => {
                    try {
                      await post('/auth/2fa/confirm', { code });
                      toast.success('Two-factor authentication enabled');
                      setEnroll(null);
                      await refresh();
                    } catch (e) {
                      toast.error(errorMessage(e));
                    }
                  }}
                >
                  Confirm & enable
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    setEnroll(await post('/auth/2fa/setup'));
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Set up two-factor authentication
              </Button>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Active sessions</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await logout();
              }}
            >
              <LogOut /> Sign out of this device
            </Button>
          </CardHeader>
          <DataTable
            rows={sessions.data}
            loading={sessions.isLoading}
            columns={[
              { key: 'd', header: 'Device', cell: (s) => <span className="line-clamp-1 max-w-96 text-xs">{s.userAgent}</span> },
              { key: 'ip', header: 'IP', cell: (s) => s.ip },
              { key: 'c', header: 'Signed in', cell: (s) => dateTime(s.createdAt) },
              { key: 'l', header: 'Last active', cell: (s) => dateTime(s.lastSeenAt) },
              { key: 'e', header: 'Expires', cell: (s) => dateTime(s.expiresAt) },
              {
                key: 'x',
                header: '',
                align: 'right',
                cell: (s) =>
                  s.current ? (
                    <Badge>This device</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>
                      Sign out
                    </Button>
                  ),
              },
            ]}
          />
        </Card>
      </div>
    </div>
  );
}
