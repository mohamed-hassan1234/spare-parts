import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, get, type Page, type Query } from './api';

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** GET a resource; key is derived from path + query so invalidation by path prefix works. */
export function useApi<T = any>(path: string | null, query?: Query, opts: { enabled?: boolean; refetchInterval?: number } = {}) {
  return useQuery<T>({
    queryKey: [path, query ?? {}],
    queryFn: () => get<T>(path!, query),
    enabled: !!path && (opts.enabled ?? true),
    placeholderData: keepPreviousData,
    refetchInterval: opts.refetchInterval,
  });
}

export const usePage = <T = any>(path: string, query: Query) => useApi<Page<T> & Record<string, any>>(path, query);

export const errorMessage = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong');

/**
 * Mutation helper: toasts success/failure and invalidates the given path prefixes
 * (every cached query whose first key segment starts with one of them).
 */
export function useAction<TVars = void, TRes = any>(
  fn: (v: TVars) => Promise<TRes>,
  opts: { success?: string | ((r: TRes) => string); invalidate?: string[]; onSuccess?: (r: TRes, v: TVars) => void } = {},
) {
  const qc = useQueryClient();
  return useMutation<TRes, unknown, TVars>({
    mutationFn: fn,
    onSuccess: (r, v) => {
      if (opts.success) toast.success(typeof opts.success === 'function' ? opts.success(r) : opts.success);
      invalidatePrefixes(qc, opts.invalidate ?? []);
      opts.onSuccess?.(r, v);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
}

export function invalidatePrefixes(qc: ReturnType<typeof useQueryClient>, prefixes: string[]) {
  // Financial data is interconnected: anything that posts a transaction can change dashboards and reports.
  const all = [...prefixes, '/dashboard', '/notifications'];
  void qc.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === 'string' && all.some((p) => (q.queryKey[0] as string).startsWith(p)) });
}

export type { QueryKey };
