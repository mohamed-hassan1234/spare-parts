import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, LogOut, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun, KeyRound, Wrench, X } from 'lucide-react';
import { NAV, type NavGroup } from './nav';
import { useAuth } from '@/lib/auth';
import { useApi } from '@/lib/hooks';
import { cn } from '@/lib/format';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './ui';
import { ErrorBoundary } from './common';

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      /* storage unavailable */
    }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

function SidebarGroup({ g, collapsed, onNavigate }: { g: NavGroup; collapsed: boolean; onNavigate: () => void }) {
  const { can } = useAuth();
  const loc = useLocation();
  const items = (g.items ?? []).filter((i) => !i.permission || can(i.permission));
  const activeInGroup = items.some((i) => (i.to === '/' ? loc.pathname === '/' : loc.pathname === i.to || loc.pathname.startsWith(i.to + '/')));
  const [open, setOpen] = useState(activeInGroup);
  useEffect(() => {
    if (activeInGroup) setOpen(true);
  }, [activeInGroup]);
  const Icon = g.icon;
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    cn(
      'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
      isActive ? 'bg-sidebar-active text-white font-medium' : 'text-sidebar-foreground/80 hover:bg-sidebar-active/60 hover:text-white',
    );

  if (g.to) {
    if (g.permission && !can(g.permission)) return null;
    return (
      <NavLink to={g.to} end className={linkCls} onClick={onNavigate} title={collapsed ? g.label : undefined}>
        <Icon className="size-4 shrink-0" />
        {!collapsed && <span>{g.label}</span>}
      </NavLink>
    );
  }
  if (items.length === 0) return null;
  if (collapsed) {
    return (
      <NavLink to={items[0].to} className={() => linkCls({ isActive: activeInGroup })} title={g.label} onClick={onNavigate}>
        <Icon className="size-4 shrink-0" />
      </NavLink>
    );
  }
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors cursor-pointer', activeInGroup ? 'text-white' : 'text-sidebar-foreground/80 hover:text-white')}
      >
        <Icon className="size-4 shrink-0" />
        <span className="flex-1 text-left">{g.label}</span>
        <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="ml-5 mt-0.5 space-y-0.5 border-l border-white/10 pl-3">
          {items.map((i) => (
            <NavLink
              key={i.to}
              to={i.to}
              end
              className={({ isActive }) => cn('block rounded-md px-3 py-1.5 text-sm', isActive ? 'bg-sidebar-active text-white font-medium' : 'text-sidebar-muted hover:text-white')}
              onClick={onNavigate}
            >
              {i.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, settings, logout, can } = useAuth();
  const navigate = useNavigate();
  const { dark, toggle } = useTheme();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobileOpen(false), [loc.pathname]);
  useEffect(() => {
    try {
      localStorage.setItem('sidebar', collapsed ? 'collapsed' : 'open');
    } catch {
      /* ignore */
    }
  }, [collapsed]);
  const notif = useApi<{ unread: number }>(can('notifications:read') ? '/notifications' : null, { limit: 1, unread: 'true' }, { refetchInterval: 60_000 });

  const sidebar = (mobile: boolean) => (
    <aside className={cn('flex h-full flex-col bg-sidebar text-sidebar-foreground', mobile ? 'w-72' : collapsed ? 'w-16' : 'w-64', 'transition-[width]')}>
      <div className="flex h-14 items-center gap-2 border-b border-white/10 px-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-white">
          <Wrench className="size-4" />
        </span>
        {(!collapsed || mobile) && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{settings?.businessName ?? 'AutoParts ERP'}</p>
            <p className="text-[11px] text-sidebar-muted">AutoParts ERP</p>
          </div>
        )}
        {mobile && (
          <Button variant="ghost" size="icon" className="ml-auto text-white hover:bg-white/10" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X />
          </Button>
        )}
      </div>
      <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto p-3">
        {NAV.map((g) => (
          <SidebarGroup key={g.label} g={g} collapsed={collapsed && !mobile} onNavigate={() => setMobileOpen(false)} />
        ))}
      </nav>
      {!mobile && (
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex items-center gap-2 border-t border-white/10 px-5 py-3 text-xs text-sidebar-muted hover:text-white cursor-pointer"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          {!collapsed && 'Collapse'}
        </button>
      )}
    </aside>
  );

  return (
    <div className="flex h-dvh overflow-hidden">
      <div className="hidden lg:block no-print">{sidebar(false)}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden no-print">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="relative h-full w-72">{sidebar(true)}</div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-card px-3 sm:px-5 no-print">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu />
          </Button>
          <div className="flex-1" />
          {can('sales:create') && (
            <Button size="sm" asChild className="hidden sm:inline-flex">
              <Link to="/pos">New sale</Link>
            </Button>
          )}
          <Button variant="ghost" size="icon" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {dark ? <Sun /> : <Moon />}
          </Button>
          {can('notifications:read') && (
            <Button variant="ghost" size="icon" asChild aria-label={`Notifications${notif.data?.unread ? ` (${notif.data.unread} unread)` : ''}`}>
              <Link to="/notifications" className="relative">
                <Bell />
                {!!notif.data?.unread && (
                  <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
                    {notif.data.unread > 99 ? '99+' : notif.data.unread}
                  </span>
                )}
              </Link>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2 px-2" aria-label="Account menu">
                <span className="grid size-7 place-items-center rounded-full bg-primary/15 text-xs font-semibold text-primary">{user?.fullName?.slice(0, 1).toUpperCase()}</span>
                <span className="hidden text-sm md:inline">{user?.fullName}</span>
                <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>
                {user?.username} · {user?.role.replace('_', ' ').toLowerCase()}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate('/security')}>
                <KeyRound /> Security & password
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  await logout();
                  navigate('/login', { replace: true });
                }}
              >
                <LogOut /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>
        <main id="main" className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1500px] p-4 sm:p-6">
            <ErrorBoundary key={loc.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
    </div>
  );
}
