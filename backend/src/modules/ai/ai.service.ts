import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import * as rep from '../reports/reports.service.js';
import { resolvePeriod } from '../../utils/dates.js';
import { getSettings } from '../settings/settings.model.js';

/**
 * AI business assistant (optional).
 *
 * Design rules:
 *  - Every number in the report is computed by the backend reporting service. The model never
 *    produces financial figures; it only writes narrative text over pre-computed facts.
 *  - Only aggregated, non-personal data is sent (no customer names/phones; product SKUs and names only).
 *  - Without ANTHROPIC_API_KEY the report is still produced, with rule-based insights.
 *  - The AI never changes data. Suggested actions are text for the owner to decide on.
 */

const money = (c: number) => (c / 100).toFixed(2);

export async function buildMonthlyFacts(period: 'thisMonth' | 'prevMonth' = 'thisMonth') {
  const s = await getSettings();
  const range = resolvePeriod(period, s.timezone);
  const prevRange = { from: new Date(range.from.getTime() - (range.to.getTime() - range.from.getTime())), to: range.from };
  const [pl, prevPl, sales, inv, ar, ap, exp, prevExp] = await Promise.all([
    rep.profitAndLoss(range),
    rep.profitAndLoss(prevRange),
    rep.salesReport(range, 'day'),
    rep.inventoryReport(),
    rep.receivablesReport(),
    rep.payablesReport(),
    rep.expensesReport(range),
    rep.expensesReport(prevRange),
  ]);
  const prevByCat = new Map(prevExp.byCategory.map((c) => [c.category, c.amount]));
  const expenseChanges = exp.byCategory
    .map((c) => {
      const before = prevByCat.get(c.category) ?? 0;
      return { category: c.category, current: c.amount, previous: before, changePct: before > 0 ? Math.round(((c.amount - before) / before) * 1000) / 10 : null };
    })
    .filter((c) => (c.changePct === null ? c.current > 0 : Math.abs(c.changePct) >= 25));
  return {
    period: { label: range.label, from: range.from, to: range.to, currency: s.currency },
    totals: {
      netSales: pl.netSales,
      grossSales: pl.grossSales,
      returns: pl.returns,
      discounts: pl.discounts,
      cogs: pl.cogs,
      grossProfit: pl.grossProfit,
      grossMarginPct: pl.grossMarginPct,
      operatingExpenses: pl.totalOperatingExpenses,
      netProfit: pl.netProfit,
      invoices: sales.summary.invoices,
    },
    previous: { netSales: prevPl.netSales, grossProfit: prevPl.grossProfit, netProfit: prevPl.netProfit, operatingExpenses: prevPl.totalOperatingExpenses },
    topSelling: [...sales.byProduct]
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5)
      .map((p) => ({ product: p.name, qty: p.qty, netSales: p.netSales, grossProfit: p.grossProfit })),
    topProfit: [...sales.byProduct]
      .sort((a, b) => b.grossProfit - a.grossProfit)
      .slice(0, 5)
      .map((p) => ({ product: p.name, grossProfit: p.grossProfit, marginPct: p.marginPct })),
    slowMoving: inv.deadStock.slice(0, 10).map((r) => ({ product: `${r.sku} — ${r.name}`, onHand: r.onHand, value: r.value, daysSinceLastSale: r.daysSinceLastSale })),
    stockAlerts: {
      outOfStock: inv.outOfStock.slice(0, 15).map((r) => ({ product: `${r.sku} — ${r.name}`, reorderQuantity: r.reorderQuantity })),
      lowStock: inv.lowStock.slice(0, 15).map((r) => ({ product: `${r.sku} — ${r.name}`, available: r.available, reorderPoint: r.reorderPoint, reorderQuantity: r.reorderQuantity, sold90: r.sold90 })),
    },
    inventoryValue: inv.totalValue,
    customerDebt: { total: ar.totals.total, overdue: ar.totals.total - ar.totals.current, customersWithDebt: ar.rows.length },
    supplierDebt: { total: ap.totals.total, overdue: ap.totals.total - ap.totals.current, suppliersOwed: ap.rows.length },
    expenseChanges,
  };
}
export type MonthlyFacts = Awaited<ReturnType<typeof buildMonthlyFacts>>;

interface Narrative {
  executiveSummary: string;
  salesTrend: string;
  debtSummary: string;
  suggestedActions: { action: string; reason: string; kind: 'observation' | 'prediction' | 'recommendation' }[];
}

/** Deterministic insights — used when AI is disabled or unavailable. */
export function ruleBasedNarrative(f: MonthlyFacts): Narrative {
  const d = (cur: number, prev: number) =>
    prev > 0 ? `${cur >= prev ? 'up' : 'down'} ${Math.abs(Math.round(((cur - prev) / prev) * 1000) / 10)}% vs the previous period` : 'no prior-period comparison available';
  const actions: Narrative['suggestedActions'] = [];
  for (const p of f.stockAlerts.outOfStock.slice(0, 5)) actions.push({ action: `Reorder ${p.product} (suggested qty ${p.reorderQuantity})`, reason: 'Out of stock', kind: 'recommendation' });
  for (const p of f.stockAlerts.lowStock.slice(0, 5))
    actions.push({ action: `Reorder ${p.product} (suggested qty ${p.reorderQuantity})`, reason: `${p.available} available, reorder point ${p.reorderPoint}`, kind: 'recommendation' });
  if (f.slowMoving.length)
    actions.push({
      action: `Review pricing/promotion for ${f.slowMoving.length} slow-moving product(s)`,
      reason: `Stock value tied up: ${money(f.slowMoving.reduce((s, x) => s + x.value, 0))}`,
      kind: 'recommendation',
    });
  if (f.customerDebt.overdue > 0) actions.push({ action: 'Follow up overdue customer invoices', reason: `${money(f.customerDebt.overdue)} overdue`, kind: 'recommendation' });
  for (const e of f.expenseChanges)
    actions.push({
      action: `Check ${e.category} spending`,
      reason: e.changePct == null ? `New this period: ${money(e.current)}` : `Changed ${e.changePct}% (${money(e.previous)} → ${money(e.current)})`,
      kind: 'observation',
    });
  return {
    executiveSummary: `Net sales ${money(f.totals.netSales)} (${d(f.totals.netSales, f.previous.netSales)}), gross profit ${money(f.totals.grossProfit)}, net profit ${money(f.totals.netProfit)} (${d(f.totals.netProfit, f.previous.netProfit)}).`,
    salesTrend: f.topSelling.length ? `Best seller by quantity: ${f.topSelling[0].product} (${f.topSelling[0].qty} units).` : 'No sales recorded in this period.',
    debtSummary: `Customers owe ${money(f.customerDebt.total)} (${money(f.customerDebt.overdue)} overdue). The shop owes suppliers ${money(f.supplierDebt.total)}.`,
    suggestedActions: actions,
  };
}

const NARRATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['executiveSummary', 'salesTrend', 'debtSummary', 'suggestedActions'],
  properties: {
    executiveSummary: { type: 'string' },
    salesTrend: { type: 'string' },
    debtSummary: { type: 'string' },
    suggestedActions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['action', 'reason', 'kind'],
        properties: { action: { type: 'string' }, reason: { type: 'string' }, kind: { type: 'string', enum: ['observation', 'prediction', 'recommendation'] } },
      },
    },
  },
};

const SYSTEM = `You are a business analyst for a small automotive spare parts shop. You receive verified, pre-computed figures from the shop's accounting system (amounts are integer cents).
Write concise narrative for the owner. Rules:
- Use only the numbers provided. Never invent, estimate, or recompute figures; quote amounts converted to currency units with 2 decimals.
- Clearly separate observed facts from predictions; label each suggested action's kind accurately.
- Suggested actions are proposals for the owner to decide on — never state that anything has been done.
- Be specific and practical. Keep each text field under 120 words.`;

export const aiEnabled = () => !!env.ANTHROPIC_API_KEY;

export async function generateMonthlyReport(period: 'thisMonth' | 'prevMonth' = 'thisMonth') {
  const facts = await buildMonthlyFacts(period);
  const fallback = ruleBasedNarrative(facts);
  if (!aiEnabled()) return { source: 'rules' as const, facts, narrative: fallback };
  try {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 120_000, maxRetries: 2 });
    const response = await client.beta.messages.create({
      model: env.AI_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: NARRATIVE_SCHEMA } },
      messages: [{ role: 'user', content: `Monthly figures (JSON):\n${JSON.stringify(facts)}` }],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') {
      logger.warn({ stop: response.stop_reason }, 'AI report not completed; using rule-based insights');
      return { source: 'rules' as const, facts, narrative: fallback, note: 'AI analysis was not available for this request.' };
    }
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    const narrative = JSON.parse(text) as Narrative;
    return { source: 'ai' as const, model: response.model, facts, narrative };
  } catch (e) {
    if (e instanceof Anthropic.APIError) logger.error({ status: e.status, msg: e.message }, 'AI request failed');
    else logger.error({ err: e }, 'AI report failed');
    return { source: 'rules' as const, facts, narrative: fallback, note: 'AI service unavailable; showing rule-based insights.' };
  }
}
