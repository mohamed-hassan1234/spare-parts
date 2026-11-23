/** Date helpers. Dates are stored in UTC; reporting periods are resolved in the business time zone. */

/** Offset (ms) of a time zone at a given instant, e.g. Africa/Mogadishu → +3h. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Wall-clock date components of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string) {
  const local = new Date(date.getTime() + tzOffsetMs(date, timeZone));
  return { y: local.getUTCFullYear(), m: local.getUTCMonth(), d: local.getUTCDate() };
}

/** UTC instant of local midnight y-m-d in `timeZone` (month is 0-based; overflow is normalised). */
export function zonedMidnight(y: number, m: number, d: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, m, d));
  return new Date(guess.getTime() - tzOffsetMs(guess, timeZone));
}

export const PERIOD_KEYS = ['today', 'yesterday', 'last7', 'last30', 'thisMonth', 'prevMonth', 'thisYear', 'custom', 'all'] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

/** Resolve a named period into a half-open [from, to) UTC range. */
export function resolvePeriod(period: PeriodKey, timeZone: string, from?: string, to?: string, now = new Date()): { from: Date; to: Date; label: string } {
  const { y, m, d } = zonedParts(now, timeZone);
  const day = (offset: number) => zonedMidnight(y, m, d + offset, timeZone);
  switch (period) {
    case 'today':
      return { from: day(0), to: day(1), label: 'Today' };
    case 'yesterday':
      return { from: day(-1), to: day(0), label: 'Yesterday' };
    case 'last7':
      return { from: day(-6), to: day(1), label: 'Last 7 days' };
    case 'last30':
      return { from: day(-29), to: day(1), label: 'Last 30 days' };
    case 'thisMonth':
      return { from: zonedMidnight(y, m, 1, timeZone), to: zonedMidnight(y, m + 1, 1, timeZone), label: 'Current month' };
    case 'prevMonth':
      return { from: zonedMidnight(y, m - 1, 1, timeZone), to: zonedMidnight(y, m, 1, timeZone), label: 'Previous month' };
    case 'thisYear':
      return { from: zonedMidnight(y, 0, 1, timeZone), to: zonedMidnight(y + 1, 0, 1, timeZone), label: 'Current year' };
    case 'all':
      return { from: new Date(0), to: day(1), label: 'All time' };
    case 'custom': {
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        throw new Error('Custom period requires from and to as YYYY-MM-DD');
      }
      const [fy, fm, fd] = from.split('-').map(Number);
      const [ty, tm, td] = to.split('-').map(Number);
      return { from: zonedMidnight(fy, fm - 1, fd, timeZone), to: zonedMidnight(ty, tm - 1, td + 1, timeZone), label: `${from} → ${to}` };
    }
  }
}

/** YYYY-MM-DD of an instant in a zone. */
export function localDateKey(date: Date, timeZone: string): string {
  const { y, m, d } = zonedParts(date, timeZone);
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}
