/**
 * Thin fetch wrapper for the AutoParts ERP REST API.
 * - Session is an HttpOnly cookie (credentials: 'include'); the client never sees it.
 * - Every state-changing request echoes the per-session CSRF token.
 * - Money values are integer cents end-to-end; the server is authoritative for totals.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** Field-level validation messages keyed by path, when the server returned them. */
  get fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(this.details)) for (const d of this.details as { path?: string; message?: string }[]) if (d.path) out[d.path] = d.message ?? 'Invalid';
    return out;
  }
}

let csrfToken: string | null = null;
export const setCsrfToken = (t: string | null) => {
  csrfToken = t;
};

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export const onUnauthorized = (l: Listener) => {
  unauthorizedListeners.add(l);
  return () => {
    unauthorizedListeners.delete(l);
  };
};

const BASE = '/api/v1';

export type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(q?: Query) {
  if (!q) return '';
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

interface Opts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export async function api<T = any>(path: string, opts: Opts = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${qs(opts.query)}`, {
      method,
      headers,
      credentials: 'include',
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection; nothing was saved.');
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const err = json?.error ?? {};
    if (res.status === 401 && !path.startsWith('/auth/login')) unauthorizedListeners.forEach((l) => l());
    throw new ApiError(res.status, err.code ?? 'HTTP_' + res.status, err.message ?? `Request failed (${res.status})`, err.details);
  }
  return (json?.data ?? json) as T;
}

export const get = <T = any>(path: string, query?: Query) => api<T>(path, { query });
export const post = <T = any>(path: string, body?: unknown, idempotencyKey?: string) => api<T>(path, { method: 'POST', body: body ?? {}, idempotencyKey });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T = any>(path: string) => api<T>(path, { method: 'DELETE' });

/** URL for a file download (PDF/CSV/XLSX). Same-origin, so the session cookie is sent. */
export const fileUrl = (path: string, query?: Query) => `${BASE}${path}${qs(query)}`;

export function newIdempotencyKey(prefix = 'ui') {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${rand}`;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
