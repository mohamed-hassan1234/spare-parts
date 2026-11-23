import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { money } from '@/lib/format';
import { EmptyState } from './common';

export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];

const axis = { stroke: 'var(--muted-foreground)', fontSize: 11, tickLine: false, axisLine: false } as const;
const compact = (c: number) => {
  const d = c / 100;
  return Math.abs(d) >= 1000 ? `$${(d / 1000).toFixed(1)}k` : `$${d.toFixed(0)}`;
};
const tooltipStyle = { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12, color: 'var(--foreground)' };

export interface SeriesDef {
  key: string;
  label: string;
}

/** Money time series (values in cents). */
export function MoneyAreaChart({ data, series, height = 260, xKey = 'period' }: { data: Record<string, any>[]; series: SeriesDef[]; height?: number; xKey?: string }) {
  if (!data?.length) return <EmptyState title="No data for this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={CHART_COLORS[i % 5]} stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_COLORS[i % 5]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey={xKey} {...axis} />
        <YAxis {...axis} tickFormatter={compact} width={56} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [money(v), n]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={CHART_COLORS[i % 5]} fill={`url(#g-${s.key})`} strokeWidth={2} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function MoneyBarChart({
  data,
  series,
  height = 260,
  xKey = 'period',
  layout = 'horizontal',
  stacked,
}: {
  data: Record<string, any>[];
  series: SeriesDef[];
  height?: number;
  xKey?: string;
  layout?: 'horizontal' | 'vertical';
  stacked?: boolean;
}) {
  if (!data?.length) return <EmptyState title="No data for this period" />;
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 8, right: 8, left: vertical ? 8 : 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" {...axis} tickFormatter={compact} />
            <YAxis type="category" dataKey={xKey} {...axis} width={140} tickFormatter={(v: string) => (v.length > 22 ? v.slice(0, 21) + '…' : v)} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} {...axis} />
            <YAxis {...axis} tickFormatter={compact} width={56} />
          </>
        )}
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [money(v), n]} cursor={{ fill: 'var(--muted)' }} />
        {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={CHART_COLORS[i % 5]} radius={vertical ? [0, 4, 4, 0] : [4, 4, 0, 0]} stackId={stacked ? 'a' : undefined} maxBarSize={36} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function MoneyPieChart({ data, nameKey, valueKey, height = 260 }: { data: Record<string, any>[]; nameKey: string; valueKey: string; height?: number }) {
  const rows = (data ?? []).filter((d) => d[valueKey] > 0);
  if (!rows.length) return <EmptyState title="No data for this period" />;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={rows} dataKey={valueKey} nameKey={nameKey} innerRadius="55%" outerRadius="85%" paddingAngle={2}>
          {rows.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % 5]} />
          ))}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [money(v), n]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
