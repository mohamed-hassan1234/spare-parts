import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@autoparts/shared';
import { api, ApiError, onUnauthorized, setCsrfToken } from './api';
import { setLocaleSettings } from './format';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: string;
  totpEnabled: boolean;
  lastLoginAt?: string;
  permissions: string[];
}

export interface PublicSettings {
  businessName: string;
  currency: string;
  timezone: string;
  taxRateBps: number;
  taxName: string;
  pricesIncludeTax: boolean;
  maxDiscountBpsWithoutApproval: number;
  sessionIdleMinutes: number;
}

interface AuthState {
  user: User | null;
  settings: PublicSettings | null;
  loading: boolean;
  login: (username: string, password: string, totpCode?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  can: (p: Permission) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  const loadSettings = useCallback(async () => {
    const s = await api<PublicSettings>('/settings/public');
    setLocaleSettings(s);
    setSettings(s);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api<{ user: User; csrfToken: string }>('/auth/me');
      setCsrfToken(me.csrfToken);
      setUser(me.user);
      await loadSettings();
    } catch (e) {
      if (!(e instanceof ApiError) || e.status !== 401) console.error(e);
      setCsrfToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [loadSettings]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      onUnauthorized(() => {
        setCsrfToken(null);
        setUser(null);
        qc.clear();
      }),
    [qc],
  );

  const login = useCallback(
    async (username: string, password: string, totpCode?: string) => {
      const r = await api<{ user: User; csrfToken: string }>('/auth/login', { method: 'POST', body: { username, password, ...(totpCode ? { totpCode } : {}) } });
      setCsrfToken(r.csrfToken);
      qc.clear();
      setUser(r.user);
      await loadSettings();
    },
    [loadSettings, qc],
  );

  const logout = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST', body: {} });
    } finally {
      setCsrfToken(null);
      setUser(null);
      qc.clear();
    }
  }, [qc]);

  const can = useCallback((p: Permission) => !!user && (user.permissions.includes('*') || user.permissions.includes(p)), [user]);

  const value = useMemo(() => ({ user, settings, loading, login, logout, refresh, can }), [user, settings, loading, login, logout, refresh, can]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
