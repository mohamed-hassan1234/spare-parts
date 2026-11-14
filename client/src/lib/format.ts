import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatCents, parseToCents } from '@autoparts/shared';

export const cn = (...v: ClassValue[]) => twMerge(clsx(v));

let currency = 'USD';
let timezone = 'Africa/Mogadishu';
export const setLocaleSettings = (s: { currency?: string; timezone?: string }) => {
  if (s.currency) currency = s.currency;
  if (s.timezone) timezone = s.timezone;
};
export const getTimezone = () => timezone;

/** Integer cents → "$1,234.56". */
export const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '—' : formatCents(cents, currency));

/** Integer cents → "1234.56" (for prefilling inputs). */
export const centsToInput = (cents: number | null | undefined) => {
  if (cents === null || cents === undefined) return '';
  const neg = cents < 0;
  const a = Math.abs(cents);
  return `${neg ? '-' : ''}${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
};

/** "12.5" → 1250 cents, or null when the text is not a valid amount. Never uses float math. */
export const inputToCents = (s: string): number | null => {
  const t = s.replace(/[,$\s]/g, '');
  if (t === '') return null;
  try {
    return parseToCents(t);
  } catch {
    return null;
  }
};

export const bps = (v: number) => `${(v / 100).toFixed(2).replace(/\.00$/, '')}%`;
export const pct = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(1)}%`);
export const num = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toLocaleString('en-US'));

/** Dates are stored in UTC and displayed in the business time zone. */
export const date = (d: string | Date | null | undefined) => (d ? new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d)) : '—');
export const dateTime = (d: string | Date | null | undefined) =>
  d ? new Intl.DateTimeFormat('en-GB', { timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) : '—';

/** Today's date in the business time zone as YYYY-MM-DD (for <input type="date">). */
export const todayInput = () => new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());

export const titleCase = (s: string | undefined | null) =>
  s
    ? s
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

/** Mongo populated reference (object) or raw id → display name. */
export const refName = (v: unknown, key = 'name'): string => (v && typeof v === 'object' ? String((v as Record<string, unknown>)[key] ?? '') : '');
export const refId = (v: unknown): string => (v && typeof v === 'object' ? String((v as { _id?: string })._id ?? '') : String(v ?? ''));
