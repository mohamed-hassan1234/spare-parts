import { Types, type PipelineStage } from 'mongoose';
import { ACCOUNTS } from '@autoparts/shared';
import { JournalEntry, Account } from '../ledger/ledger.models.js';
import { accountTotals } from '../ledger/ledger.service.js';
import { CostLayer, InventoryBalance, Movement } from '../inventory/inventory.models.js';
import { Product, Category } from '../catalog/catalog.models.js';
import { Sale, CustomerPayment, CustomerReturn } from '../sales/sales.models.js';
import { Purchase, PurchaseReceipt, SupplierPayment } from '../purchases/purchases.models.js';
import { Expense, ExpenseCategory } from '../expenses/expenses.models.js';
import { Customer, Supplier } from '../partners/partners.models.js';
import { getSettings } from '../settings/settings.model.js';
import { resolvePeriod, type PeriodKey } from '../../utils/dates.js';

export interface Range {
  from: Date;
  to: Date;
  label: string;
}

export async function rangeFrom(q: { period?: PeriodKey; from?: string; to?: string }): Promise<Range> {
  const s = await getSettings();
  return resolvePeriod(q.period ?? 'thisMonth', s.timezone, q.from, q.to);
}

type Totals = Map<string, { debit: number; credit: number }>;
async function totalsByAccount(from?: Date, to?: Date): Promise<Totals> {
  const rows = await accountTotals({ from, to }, 'account');
  return new Map(rows.map((r) => [r._id as string, { debit: r.debit, credit: r.credit }]));
}
const dr = (t: Totals, a: string) => (t.get(a)?.debit ?? 0) - (t.get(a)?.credit ?? 0);
const cr = (t: Totals, a: string) => -dr(t, a);

/* --------------------------------- P&L --------------------------------- */

export async function profitAndLoss(range: { from: Date; to: Date }) {
  const t = await totalsByAccount(range.from, range.to);
  const grossSales = cr(t, ACCOUNTS.SALES_REVENUE);
  const returns = dr(t, ACCOUNTS.SALES_RETURNS);
  const discounts = dr(t, ACCOUNTS.SALES_DISCOUNTS);
  const netSales = grossSales - returns - discounts;
  const cogs = dr(t, ACCOUNTS.COGS);
  const grossProfit = netSales - cogs;
  const inventoryLoss = dr(t, ACCOUNTS.INVENTORY_LOSS);

  // Operating expenses by category (excludes voided — voids are reversed in the ledger and net to zero).
  const opexRows = await JournalEntry.aggregate<{ _id: Types.ObjectId | null; amount: number }>([
    { $match: { date: { $gte: range.from, $lt: range.to }, 'lines.accountCode': ACCOUNTS.OPERATING_EXPENSES } },
    { $unwind: '$lines' },
    { $match: { 'lines.accountCode': ACCOUNTS.OPERATING_EXPENSES } },
    { $group: { _id: '$lines.expenseCategoryId', amount: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } } } },
  ]);
  const cats = await ExpenseCategory.find({ _id: { $in: opexRows.map((r) => r._id).filter(Boolean) } }).lean();
  const catName = new Map(cats.map((c) => [String(c._id), c.name]));
  const expensesByCategory = opexRows
    .filter((r) => r.amount !== 0)
    .map((r) => ({ categoryId: r._id, category: r._id ? (catName.get(String(r._id)) ?? 'Unknown') : 'Uncategorised', amount: r.amount }))
    .sort((a, b) => b.amount - a.amount);
  const operatingExpenses = dr(t, ACCOUNTS.OPERATING_EXPENSES);
  const totalOperatingExpenses = operatingExpenses + inventoryLoss;
  const operatingProfit = grossProfit - totalOperatingExpenses;
  const otherIncome = cr(t, ACCOUNTS.OTHER_INCOME);
  const otherExpenses = dr(t, ACCOUNTS.OTHER_EXPENSES);
  const netProfit = operatingProfit + otherIncome - otherExpenses;
  const pct = (n: number) => (netSales > 0 ? Math.round((n / netSales) * 10_000) / 100 : null);
  return {
    grossSales,
    returns,
    discounts,
    netSales,
    cogs,
    grossProfit,
    grossMarginPct: pct(grossProfit),
    operatingExpenses,
    inventoryLoss,
    expensesByCategory,
    totalOperatingExpenses,
    operatingProfit,
    operatingMarginPct: pct(operatingProfit),
    otherIncome,
    otherExpenses,
    netProfit,
    netMarginPct: pct(netProfit),
  };
}

/* ---------------------------- Trial balance ---------------------------- */

export async function trialBalance(to?: Date) {
  const [t, accounts] = await Promise.all([totalsByAccount(undefined, to), Account.find().sort({ code: 1 }).lean()]);
  const rows = accounts.map((a) => {
    const net = dr(t, a.code);
    return { code: a.code, name: a.name, type: a.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0, totalDebit: t.get(a.code)?.debit ?? 0, totalCredit: t.get(a.code)?.credit ?? 0 };
  });
  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/* ---------------------------- Balance sheet ---------------------------- */

export async function balanceSheet(to?: Date) {
  const [t, accounts] = await Promise.all([totalsByAccount(undefined, to), Account.find().sort({ code: 1 }).lean()]);
  const section = (types: string[], sign: 1 | -1) =>
    accounts
      .filter((a) => types.includes(a.type))
      .map((a) => ({ code: a.code, name: a.name, amount: sign * dr(t, a.code) }))
      .filter((r) => r.amount !== 0);
  const assets = section(['ASSET'], 1);
  const liabilities = section(['LIABILITY'], -1);
  const equity = section(['EQUITY'], -1);
  // Current (un-closed) earnings = revenue − contra revenue − expenses to date.
  const earnings =
    accounts.filter((a) => a.type === 'REVENUE').reduce((s, a) => s + cr(t, a.code), 0) -
    accounts.filter((a) => a.type === 'CONTRA_REVENUE' || a.type === 'EXPENSE').reduce((s, a) => s + dr(t, a.code), 0);
  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalEquity = equity.reduce((s, r) => s + r.amount, 0) + earnings;
  return { assets, liabilities, equity, currentEarnings: earnings, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity };
}

/* ------------------------------ Cash flow ------------------------------ */

const CASH = [ACCOUNTS.CASH, ACCOUNTS.BANK, ACCOUNTS.MOBILE_MONEY] as string[];

export async function cashPosition(to?: Date) {
  const t = await totalsByAccount(undefined, to);
  const accounts = await Account.find({ code: { $in: CASH } })
    .sort({ code: 1 })
    .lean();
  const rows = accounts.map((a) => ({ code: a.code, name: a.name, balance: dr(t, a.code) }));
  return { accounts: rows, total: rows.reduce((s, r) => s + r.balance, 0) };
}

export async function cashFlow(range: { from: Date; to: Date }) {
  const opening = await cashPosition(range.from);
  const closing = await cashPosition(range.to);
  const rows = await JournalEntry.aggregate<{ _id: string; inflow: number; outflow: number }>([
    { $match: { date: { $gte: range.from, $lt: range.to }, 'lines.accountCode': { $in: CASH } } },
    { $unwind: '$lines' },
    { $match: { 'lines.accountCode': { $in: CASH } } },
    { $group: { _id: '$sourceType', inflow: { $sum: '$lines.debit' }, outflow: { $sum: '$lines.credit' } } },
  ]);
  // Transfers between own accounts appear as both in and out and net to zero.
  const labels: Record<string, string> = {
    CUSTOMER_PAYMENT: 'Customer receipts',
    CUSTOMER_RETURN: 'Customer refunds',
    SUPPLIER_PAYMENT: 'Supplier payments',
    EXPENSE: 'Expenses & withdrawals',
    CAPITAL: 'Owner capital / loans / other',
    TRANSFER: 'Transfers between accounts',
    OPENING_BALANCE: 'Opening balances',
    REVERSAL: 'Reversals',
  };
  const lines = rows.map((r) => ({ sourceType: r._id, label: labels[r._id] ?? r._id, inflow: r.inflow, outflow: r.outflow, net: r.inflow - r.outflow })).sort((a, b) => b.net - a.net);
  const inflow = lines.reduce((s, l) => s + l.inflow, 0);
  const outflow = lines.reduce((s, l) => s + l.outflow, 0);
  return { openingBalance: opening.total, inflow, outflow, netChange: inflow - outflow, closingBalance: closing.total, lines, accounts: closing.accounts };
}

/** Cash account statement: running balance of one cash/bank account. */
export async function cashStatement(account: string, range: { from: Date; to: Date }) {
  const t = await totalsByAccount(undefined, range.from);
  let balance = dr(t, account);
  const opening = balance;
  const entries = await JournalEntry.find({ date: { $gte: range.from, $lt: range.to }, 'lines.accountCode': account })
    .sort({ date: 1, entryNo: 1 })
    .lean();
  const rows = entries.map((e) => {
    const d = e.lines.filter((l) => l.accountCode === account).reduce((s, l) => s + l.debit - l.credit, 0);
    balance += d;
    return { date: e.date, entryNo: e.entryNo, memo: e.memo, sourceType: e.sourceType, sourceRef: e.sourceRef, inflow: d > 0 ? d : 0, outflow: d < 0 ? -d : 0, balance };
  });
  return { account, opening, closing: balance, rows };
}

/* ----------------------------- Receivables ----------------------------- */

function agingBucket(due: Date | undefined, now: Date) {
  if (!due) return 'current';
  const days = Math.floor((now.getTime() - due.getTime()) / 86_400_000);
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}
const emptyBuckets = () => ({ current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 });

export async function receivablesReport() {
  const now = new Date();
  const open = await Sale.find({ balanceDue: { $gt: 0 } })
    .sort({ date: 1 })
    .lean();
  const byCustomer = new Map<string, { customerId: string | null; name: string; phone?: string; invoices: number; overdue: number } & ReturnType<typeof emptyBuckets>>();
  for (const s of open) {
    const key = String(s.customerId ?? 'walk-in');
    const row = byCustomer.get(key) ?? { customerId: s.customerId ? String(s.customerId) : null, name: s.customerName, phone: s.customerPhone, invoices: 0, overdue: 0, ...emptyBuckets() };
    const b = agingBucket(s.dueDate, now);
    row[b] += s.balanceDue;
    row.total += s.balanceDue;
    row.invoices += 1;
    if (b !== 'current') row.overdue += s.balanceDue;
    byCustomer.set(key, row);
  }
  const rows = [...byCustomer.values()].sort((a, b) => b.total - a.total);
  const totals = rows.reduce((t, r) => {
    for (const k of Object.keys(emptyBuckets()) as (keyof ReturnType<typeof emptyBuckets>)[]) t[k] += r[k];
    return t;
  }, emptyBuckets());
  const ledgerAR = (await accountTotals({ accounts: [ACCOUNTS.ACCOUNTS_RECEIVABLE] }))[0];
  const ledgerTotal = ledgerAR ? ledgerAR.debit - ledgerAR.credit : 0;
  const creditRows = await accountTotals({ accounts: [ACCOUNTS.CUSTOMER_CREDITS] });
  const storeCredits = creditRows[0] ? creditRows[0].credit - creditRows[0].debit : 0;
  return {
    rows,
    totals,
    invoices: open.map((s) => ({
      saleId: s._id,
      invoiceNo: s.invoiceNo,
      customer: s.customerName,
      date: s.date,
      dueDate: s.dueDate,
      total: s.total,
      balanceDue: s.balanceDue,
      bucket: agingBucket(s.dueDate, now),
    })),
    ledgerTotal,
    storeCredits,
    reconciled: ledgerTotal === totals.total,
  };
}

/* ------------------------------- Payables ------------------------------ */

export async function payablesReport() {
  const now = new Date();
  const purchases = await Purchase.find({ status: { $nin: ['DRAFT', 'CANCELLED'] } }).lean();
  const suppliers = await Supplier.find().lean();
  const supName = new Map(suppliers.map((s) => [String(s._id), s.name]));
  const bySupplier = new Map<string, { supplierId: string; name: string; purchases: number; overdue: number } & ReturnType<typeof emptyBuckets>>();
  const open = [];
  for (const p of purchases) {
    const owed = p.receivedValue - p.returnedValue - p.amountPaid;
    if (owed === 0) continue;
    const key = String(p.supplierId);
    const row = bySupplier.get(key) ?? { supplierId: key, name: supName.get(key) ?? 'Unknown', purchases: 0, overdue: 0, ...emptyBuckets() };
    const b = owed > 0 ? agingBucket(p.dueDate, now) : 'current';
    row[b] += owed;
    row.total += owed;
    row.purchases += 1;
    if (b !== 'current') row.overdue += owed;
    bySupplier.set(key, row);
    open.push({
      purchaseId: p._id,
      purchaseNo: p.purchaseNo,
      supplier: supName.get(key),
      date: p.purchaseDate,
      dueDate: p.dueDate,
      total: p.total,
      received: p.receivedValue,
      paid: p.amountPaid,
      owed,
      bucket: b,
    });
  }
  // Payments not linked to a purchase reduce the supplier balance too.
  const unlinked = await SupplierPayment.aggregate<{ _id: Types.ObjectId; amount: number }>([
    { $match: { purchaseId: { $exists: false } } },
    { $group: { _id: '$supplierId', amount: { $sum: '$amount' } } },
  ]);
  const { SupplierReturn } = await import('../purchases/purchases.models.js');
  const unlinkedReturns = await SupplierReturn.aggregate<{ _id: Types.ObjectId; amount: number }>([
    { $match: { purchaseId: { $exists: false }, settlement: 'CREDIT' } },
    { $group: { _id: '$supplierId', amount: { $sum: '$totalCost' } } },
  ]);
  for (const u of [...unlinked, ...unlinkedReturns]) {
    const key = String(u._id);
    const row = bySupplier.get(key) ?? { supplierId: key, name: supName.get(key) ?? 'Unknown', purchases: 0, overdue: 0, ...emptyBuckets() };
    row.current -= u.amount;
    row.total -= u.amount;
    bySupplier.set(key, row);
  }
  const rows = [...bySupplier.values()].filter((r) => r.total !== 0).sort((a, b) => b.total - a.total);
  const totals = rows.reduce((t, r) => {
    for (const k of Object.keys(emptyBuckets()) as (keyof ReturnType<typeof emptyBuckets>)[]) t[k] += r[k];
    return t;
  }, emptyBuckets());
  const ap = (await accountTotals({ accounts: [ACCOUNTS.ACCOUNTS_PAYABLE] }))[0];
  const ledgerTotal = ap ? ap.credit - ap.debit : 0;
  return { rows, totals, purchases: open, ledgerTotal, reconciled: ledgerTotal === totals.total };
}

/* ------------------------------ Inventory ------------------------------ */

export async function inventoryReport() {
  const s = await getSettings();
  const [products, balances, layers, cats, lastSales] = await Promise.all([
    Product.find({ isActive: true }).lean(),
    InventoryBalance.find().lean(),
    CostLayer.aggregate<{ _id: Types.ObjectId; qty: number; value: number; oldest: Date }>([
      { $match: { remainingQty: { $gt: 0 } } },
      { $group: { _id: '$productId', qty: { $sum: '$remainingQty' }, value: { $sum: '$remainingCost' }, oldest: { $min: '$receivedAt' } } },
    ]),
    Category.find().lean(),
    Movement.aggregate<{ _id: Types.ObjectId; last: Date; sold90: number }>([
      { $match: { type: 'SALE' } },
      {
        $group: {
          _id: '$productId',
          last: { $max: '$at' },
          sold90: { $sum: { $cond: [{ $gte: ['$at', new Date(Date.now() - 90 * 86_400_000)] }, { $multiply: ['$qty', -1] }, 0] } },
        },
      },
    ]),
  ]);
  const balBy = new Map<string, { onHand: number; available: number; reserved: number }>();
  for (const b of balances) {
    const k = String(b.productId);
    const cur = balBy.get(k) ?? { onHand: 0, available: 0, reserved: 0 };
    cur.onHand += b.qtyOnHand;
    cur.available += b.qtyAvailable;
    cur.reserved += b.qtyReserved;
    balBy.set(k, cur);
  }
  const layerBy = new Map(layers.map((l) => [String(l._id), l]));
  const saleBy = new Map(lastSales.map((l) => [String(l._id), l]));
  const catName = new Map(cats.map((c) => [String(c._id), c.name]));
  const now = Date.now();
  const rows = products.map((p) => {
    const k = String(p._id);
    const bal = balBy.get(k) ?? { onHand: 0, available: 0, reserved: 0 };
    const layer = layerBy.get(k);
    const sale = saleBy.get(k);
    const ageDays = layer ? Math.floor((now - new Date(layer.oldest).getTime()) / 86_400_000) : null;
    const daysSinceSale = sale ? Math.floor((now - new Date(sale.last).getTime()) / 86_400_000) : null;
    const status = bal.available <= 0 ? 'OUT_OF_STOCK' : bal.available <= p.reorderPoint ? 'LOW_STOCK' : 'IN_STOCK';
    return {
      productId: p._id,
      sku: p.sku,
      name: p.name,
      category: p.categoryId ? (catName.get(String(p.categoryId)) ?? '—') : '—',
      categoryId: p.categoryId,
      onHand: bal.onHand,
      reserved: bal.reserved,
      available: bal.available,
      reorderPoint: p.reorderPoint,
      reorderQuantity: p.reorderQuantity,
      value: layer?.value ?? 0,
      avgUnitCost: layer && layer.qty > 0 ? Math.round(layer.value / layer.qty) : 0,
      sellingPrice: p.sellingPrice,
      oldestStockDays: ageDays,
      daysSinceLastSale: daysSinceSale,
      sold90: sale?.sold90 ?? 0,
      status,
      isDead: bal.onHand > 0 && (daysSinceSale == null ? (ageDays ?? 0) >= s.deadStockDays : daysSinceSale >= s.deadStockDays),
    };
  });
  const totalValue = layers.reduce((s2, l) => s2 + l.value, 0);
  const byCategory = new Map<string, { category: string; value: number; units: number }>();
  for (const r of rows) {
    const c = byCategory.get(r.category) ?? { category: r.category, value: 0, units: 0 };
    c.value += r.value;
    c.units += r.onHand;
    byCategory.set(r.category, c);
  }
  const aging = { d0_30: 0, d31_90: 0, d91_180: 0, d180_plus: 0 };
  const allLayers = await CostLayer.find({ remainingQty: { $gt: 0 } }, { receivedAt: 1, remainingCost: 1 }).lean();
  for (const l of allLayers) {
    const d = (now - new Date(l.receivedAt).getTime()) / 86_400_000;
    if (d <= 30) aging.d0_30 += l.remainingCost;
    else if (d <= 90) aging.d31_90 += l.remainingCost;
    else if (d <= 180) aging.d91_180 += l.remainingCost;
    else aging.d180_plus += l.remainingCost;
  }
  // Turnover (last 365 days) = COGS / average inventory (approximated by current value).
  const yearAgo = new Date(now - 365 * 86_400_000);
  const cogsYear = await accountTotals({ accounts: [ACCOUNTS.COGS], from: yearAgo });
  const cogs365 = cogsYear[0] ? cogsYear[0].debit - cogsYear[0].credit : 0;
  return {
    rows,
    totalValue,
    totalUnits: rows.reduce((s2, r) => s2 + r.onHand, 0),
    byCategory: [...byCategory.values()].sort((a, b) => b.value - a.value),
    aging,
    lowStock: rows.filter((r) => r.status === 'LOW_STOCK'),
    outOfStock: rows.filter((r) => r.status === 'OUT_OF_STOCK'),
    deadStock: rows.filter((r) => r.isDead),
    fastMoving: [...rows]
      .filter((r) => r.sold90 > 0)
      .sort((a, b) => b.sold90 - a.sold90)
      .slice(0, 20),
    slowMoving: [...rows]
      .filter((r) => r.onHand > 0)
      .sort((a, b) => a.sold90 - b.sold90)
      .slice(0, 20),
    turnover: totalValue > 0 ? Math.round((cogs365 / totalValue) * 100) / 100 : null,
    deadStockDays: s.deadStockDays,
  };
}

/* -------------------------------- Sales -------------------------------- */

function unitFormat(unit: 'day' | 'week' | 'month' | 'year') {
  return unit === 'day' ? '%Y-%m-%d' : unit === 'week' ? '%G-W%V' : unit === 'month' ? '%Y-%m' : '%Y';
}

/** Net sales / COGS / gross profit series from the ledger (includes returns and discounts). */
export async function salesSeries(range: { from: Date; to: Date }, unit: 'day' | 'week' | 'month' | 'year') {
  const tz = (await getSettings()).timezone;
  const accounts = [
    ACCOUNTS.SALES_REVENUE,
    ACCOUNTS.SALES_RETURNS,
    ACCOUNTS.SALES_DISCOUNTS,
    ACCOUNTS.COGS,
    ACCOUNTS.OPERATING_EXPENSES,
    ACCOUNTS.INVENTORY_LOSS,
    ACCOUNTS.OTHER_INCOME,
    ACCOUNTS.OTHER_EXPENSES,
  ];
  const rows = await JournalEntry.aggregate<{ _id: { k: string; a: string }; debit: number; credit: number }>([
    { $match: { date: { $gte: range.from, $lt: range.to }, 'lines.accountCode': { $in: accounts } } },
    { $unwind: '$lines' },
    { $match: { 'lines.accountCode': { $in: accounts } } },
    {
      $group: { _id: { k: { $dateToString: { date: '$date', format: unitFormat(unit), timezone: tz } }, a: '$lines.accountCode' }, debit: { $sum: '$lines.debit' }, credit: { $sum: '$lines.credit' } },
    },
  ]);
  const map = new Map<string, { period: string; netSales: number; cogs: number; grossProfit: number; expenses: number; netProfit: number }>();
  for (const r of rows) {
    const p = map.get(r._id.k) ?? { period: r._id.k, netSales: 0, cogs: 0, grossProfit: 0, expenses: 0, netProfit: 0 };
    const net = r.debit - r.credit;
    switch (r._id.a) {
      case ACCOUNTS.SALES_REVENUE:
      case ACCOUNTS.OTHER_INCOME:
        if (r._id.a === ACCOUNTS.SALES_REVENUE) p.netSales += -net;
        else p.netProfit += -net;
        break;
      case ACCOUNTS.SALES_RETURNS:
      case ACCOUNTS.SALES_DISCOUNTS:
        p.netSales -= net;
        break;
      case ACCOUNTS.COGS:
        p.cogs += net;
        break;
      case ACCOUNTS.OPERATING_EXPENSES:
      case ACCOUNTS.INVENTORY_LOSS:
        p.expenses += net;
        break;
      case ACCOUNTS.OTHER_EXPENSES:
        p.netProfit -= net;
        break;
    }
    map.set(r._id.k, p);
  }
  return [...map.values()].map((p) => ({ ...p, grossProfit: p.netSales - p.cogs, netProfit: p.netProfit + p.netSales - p.cogs - p.expenses })).sort((a, b) => a.period.localeCompare(b.period));
}

/** Profit by product (or category) from ledger lines tagged with the dimension. */
export async function profitBy(range: { from: Date; to: Date }, dim: 'productId' | 'categoryId') {
  const accounts = [ACCOUNTS.SALES_REVENUE, ACCOUNTS.SALES_RETURNS, ACCOUNTS.SALES_DISCOUNTS, ACCOUNTS.COGS];
  const rows = await JournalEntry.aggregate<{ _id: { d: Types.ObjectId | null; a: string }; net: number }>([
    { $match: { date: { $gte: range.from, $lt: range.to }, 'lines.accountCode': { $in: accounts } } },
    { $unwind: '$lines' },
    { $match: { 'lines.accountCode': { $in: accounts } } },
    { $group: { _id: { d: `$lines.${dim}`, a: '$lines.accountCode' }, net: { $sum: { $subtract: ['$lines.debit', '$lines.credit'] } } } },
  ]);
  const qtyRows =
    dim === 'productId'
      ? await Movement.aggregate<{ _id: Types.ObjectId; qty: number }>([
          { $match: { at: { $gte: range.from, $lt: range.to }, type: { $in: ['SALE', 'CUSTOMER_RETURN'] } } },
          { $group: { _id: '$productId', qty: { $sum: { $multiply: ['$qty', -1] } } } },
        ])
      : [];
  const qtyBy = new Map(qtyRows.map((q) => [String(q._id), q.qty]));
  const map = new Map<string, { id: string | null; netSales: number; cogs: number }>();
  for (const r of rows) {
    const key = String(r._id.d ?? 'none');
    const cur = map.get(key) ?? { id: r._id.d ? String(r._id.d) : null, netSales: 0, cogs: 0 };
    if (r._id.a === ACCOUNTS.COGS) cur.cogs += r.net;
    else cur.netSales -= r.net;
    map.set(key, cur);
  }
  const ids = [...map.values()].map((m) => m.id).filter(Boolean) as string[];
  const names =
    dim === 'productId'
      ? new Map((await Product.find({ _id: { $in: ids } }, { sku: 1, name: 1 }).lean()).map((p) => [String(p._id), `${p.sku} — ${p.name}`]))
      : new Map((await Category.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((c) => [String(c._id), c.name]));
  return [...map.values()]
    .map((m) => {
      const grossProfit = m.netSales - m.cogs;
      return {
        id: m.id,
        name: m.id ? (names.get(m.id) ?? 'Unknown') : 'Uncategorised',
        qty: m.id ? (qtyBy.get(m.id) ?? 0) : 0,
        netSales: m.netSales,
        cogs: m.cogs,
        grossProfit,
        marginPct: m.netSales > 0 ? Math.round((grossProfit / m.netSales) * 10_000) / 100 : null,
      };
    })
    .sort((a, b) => b.netSales - a.netSales);
}

export async function salesReport(range: { from: Date; to: Date }, unit: 'day' | 'week' | 'month' | 'year' = 'day') {
  const match = { date: { $gte: range.from, $lt: range.to } };
  const [series, byProduct, byCategory, byCustomer, byMethod, returns, summary] = await Promise.all([
    salesSeries(range, unit),
    profitBy(range, 'productId'),
    profitBy(range, 'categoryId'),
    Sale.aggregate<{ _id: string; customer: string; invoices: number; total: number; balanceDue: number }>([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: [{ $toString: '$customerId' }, 'walk-in'] },
          customer: { $first: '$customerName' },
          invoices: { $sum: 1 },
          total: { $sum: '$total' },
          balanceDue: { $sum: '$balanceDue' },
        },
      },
      { $sort: { total: -1 } },
      { $limit: 50 },
    ]),
    CustomerPayment.aggregate<{ _id: string; amount: number; count: number }>([
      { $match: match },
      { $group: { _id: '$method', amount: { $sum: { $cond: [{ $eq: ['$kind', 'REFUND'] }, { $multiply: ['$amount', -1] }, '$amount'] } }, count: { $sum: 1 } } },
    ]),
    CustomerReturn.aggregate<{ _id: null; count: number; amount: number }>([{ $match: match }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totalAmount' } } }]),
    Sale.aggregate<{ _id: null; invoices: number; total: number; tax: number; outstanding: number; creditSales: number }>([
      { $match: match },
      {
        $group: {
          _id: null,
          invoices: { $sum: 1 },
          total: { $sum: '$total' },
          tax: { $sum: '$taxTotal' },
          outstanding: { $sum: '$balanceDue' },
          creditSales: { $sum: { $cond: [{ $gt: ['$balanceDue', 0] }, 1, 0] } },
        },
      },
    ]),
  ]);
  const pl = await profitAndLoss(range);
  return {
    summary: {
      invoices: summary[0]?.invoices ?? 0,
      invoicedTotal: summary[0]?.total ?? 0,
      taxCollected: summary[0]?.tax ?? 0,
      outstanding: summary[0]?.outstanding ?? 0,
      grossSales: pl.grossSales,
      returns: pl.returns,
      discounts: pl.discounts,
      netSales: pl.netSales,
      cogs: pl.cogs,
      grossProfit: pl.grossProfit,
      grossMarginPct: pl.grossMarginPct,
      returnCount: returns[0]?.count ?? 0,
      averageSale: summary[0]?.invoices ? Math.round(summary[0].total / summary[0].invoices) : 0,
    },
    series,
    byProduct,
    byCategory,
    byCustomer,
    byPaymentMethod: byMethod.map((m) => ({ method: m._id, amount: m.amount, count: m.count })),
  };
}

/* ------------------------------ Purchases ------------------------------ */

export async function purchasesReport(range: { from: Date; to: Date }) {
  const match = { date: { $gte: range.from, $lt: range.to } };
  const [bySupplier, byProduct, costTrend, payments] = await Promise.all([
    PurchaseReceipt.aggregate<{ _id: Types.ObjectId; amount: number; receipts: number }>([
      { $match: match },
      { $group: { _id: '$supplierId', amount: { $sum: '$totalCost' }, receipts: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
    PurchaseReceipt.aggregate<{ _id: Types.ObjectId; qty: number; cost: number }>([
      { $match: match },
      { $unwind: '$lines' },
      { $group: { _id: '$lines.productId', qty: { $sum: '$lines.qty' }, cost: { $sum: '$lines.cost' } } },
      { $sort: { cost: -1 } },
      { $limit: 50 },
    ]),
    PurchaseReceipt.aggregate<{ _id: string; amount: number }>([
      { $match: match },
      { $group: { _id: { $dateToString: { date: '$date', format: '%Y-%m', timezone: (await getSettings()).timezone } }, amount: { $sum: '$totalCost' } } },
      { $sort: { _id: 1 } },
    ]),
    SupplierPayment.aggregate<{ _id: null; amount: number }>([{ $match: match }, { $group: { _id: null, amount: { $sum: '$amount' } } }]),
  ]);
  const sups = new Map((await Supplier.find({ _id: { $in: bySupplier.map((b) => b._id) } }).lean()).map((s) => [String(s._id), s.name]));
  const prods = new Map((await Product.find({ _id: { $in: byProduct.map((b) => b._id) } }).lean()).map((p) => [String(p._id), `${p.sku} — ${p.name}`]));
  const payables = await payablesReport();
  return {
    totalReceived: bySupplier.reduce((s, b) => s + b.amount, 0),
    totalPaid: payments[0]?.amount ?? 0,
    outstanding: payables.ledgerTotal,
    bySupplier: bySupplier.map((b) => ({ supplierId: b._id, supplier: sups.get(String(b._id)) ?? 'Unknown', amount: b.amount, receipts: b.receipts })),
    byProduct: byProduct.map((b) => ({ productId: b._id, product: prods.get(String(b._id)) ?? 'Unknown', qty: b.qty, cost: b.cost, avgUnitCost: b.qty ? Math.round(b.cost / b.qty) : 0 })),
    costTrend: costTrend.map((c) => ({ period: c._id, amount: c.amount })),
    outstandingPurchases: payables.purchases,
  };
}

/* ------------------------------- Expenses ------------------------------ */

export async function expensesReport(range: { from: Date; to: Date }) {
  const tz = (await getSettings()).timezone;
  const match = { date: { $gte: range.from, $lt: range.to }, status: 'POSTED' };
  const [byCategory, byMonth, byKind] = await Promise.all([
    Expense.aggregate<{ _id: Types.ObjectId; amount: number; count: number }>([
      { $match: match },
      { $group: { _id: '$categoryId', amount: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { amount: -1 } },
    ]),
    Expense.aggregate<{ _id: { m: string; kind: string }; amount: number }>([
      { $match: match },
      { $group: { _id: { m: { $dateToString: { date: '$date', format: '%Y-%m', timezone: tz } }, kind: '$kind' }, amount: { $sum: '$amount' } } },
      { $sort: { '_id.m': 1 } },
    ]),
    Expense.aggregate<{ _id: string; amount: number }>([{ $match: match }, { $group: { _id: '$kind', amount: { $sum: '$amount' } } }]),
  ]);
  const cats = new Map((await ExpenseCategory.find().lean()).map((c) => [String(c._id), c]));
  const months = new Map<string, Record<string, number | string>>();
  for (const r of byMonth) {
    const m = months.get(r._id.m) ?? { period: r._id.m };
    m[r._id.kind] = ((m[r._id.kind] as number) ?? 0) + r.amount;
    months.set(r._id.m, m);
  }
  return {
    byCategory: byCategory.map((c) => ({ categoryId: c._id, category: cats.get(String(c._id))?.name ?? 'Unknown', kind: cats.get(String(c._id))?.kind, amount: c.amount, count: c.count })),
    byMonth: [...months.values()],
    byKind: byKind.map((k) => ({ kind: k._id, amount: k.amount })),
  };
}

/* ------------------------------ Dashboard ------------------------------ */

export async function dashboardOverview(range: Range) {
  const s = await getSettings();
  const today = resolvePeriod('today', s.timezone);
  const month = resolvePeriod('thisMonth', s.timezone);
  const yesterday = resolvePeriod('yesterday', s.timezone);
  const [pl, todayPl, monthPl, yesterdayPl, purchases, inv, cash, totalsAll, productCount, supplierCount, customerCount, salesCount] = await Promise.all([
    profitAndLoss(range),
    profitAndLoss(today),
    profitAndLoss(month),
    profitAndLoss(yesterday),
    purchasesReport(range),
    CostLayer.aggregate<{ _id: null; value: number }>([{ $match: { remainingQty: { $gt: 0 } } }, { $group: { _id: null, value: { $sum: '$remainingCost' } } }]),
    cashPosition(),
    totalsByAccount(),
    Product.countDocuments({ isActive: true }),
    Supplier.countDocuments({ status: 'ACTIVE' }),
    Customer.countDocuments({ status: { $ne: 'INACTIVE' } }),
    Sale.countDocuments({ date: { $gte: range.from, $lt: range.to } }),
  ]);
  const stock = await stockStatusCounts();
  return {
    period: { from: range.from, to: range.to, label: range.label, timezone: s.timezone, currency: s.currency },
    todaySales: todayPl.netSales,
    monthSales: monthPl.netSales,
    yesterdaySales: yesterdayPl.netSales,
    /** Cost of goods received from suppliers in the period (purchases are recognised on receipt). */
    purchasesTotal: purchases.totalReceived,
    revenue: pl.netSales,
    grossSales: pl.grossSales,
    cogs: pl.cogs,
    grossProfit: pl.grossProfit,
    operatingExpenses: pl.totalOperatingExpenses,
    netProfit: pl.netProfit,
    grossMarginPct: pl.grossMarginPct,
    inventoryValue: inv[0]?.value ?? 0,
    receivables: dr(totalsAll, ACCOUNTS.ACCOUNTS_RECEIVABLE),
    payables: cr(totalsAll, ACCOUNTS.ACCOUNTS_PAYABLE),
    cash: cash.total,
    cashAccounts: cash.accounts,
    lowStock: stock.low,
    outOfStock: stock.out,
    totalProducts: productCount,
    totalSuppliers: supplierCount,
    totalCustomers: customerCount,
    salesCount,
  };
}

export async function stockStatusCounts() {
  const rows = await Product.aggregate<{ low: number; out: number }>([
    { $match: { isActive: true } },
    { $lookup: { from: 'inventory_balances', localField: '_id', foreignField: 'productId', as: 'b' } },
    { $project: { reorderPoint: 1, avail: { $sum: '$b.qtyAvailable' } } },
    { $group: { _id: null, out: { $sum: { $cond: [{ $lte: ['$avail', 0] }, 1, 0] } }, low: { $sum: { $cond: [{ $and: [{ $gt: ['$avail', 0] }, { $lte: ['$avail', '$reorderPoint'] }] }, 1, 0] } } } },
  ] as PipelineStage[]);
  return { low: rows[0]?.low ?? 0, out: rows[0]?.out ?? 0 };
}

export async function dashboardCharts(range: Range) {
  const s = await getSettings();
  const days = (range.to.getTime() - range.from.getTime()) / 86_400_000;
  const unit = days > 400 ? 'month' : days > 62 ? 'week' : 'day';
  const yearRange = resolvePeriod('thisYear', s.timezone);
  const [series, monthly, top, cats, purchases, inv, sales] = await Promise.all([
    salesSeries(range, unit),
    salesSeries({ from: new Date(yearRange.from.getTime() - 365 * 86_400_000), to: yearRange.to }, 'month'),
    profitBy(range, 'productId'),
    profitBy(range, 'categoryId'),
    purchasesReport(range),
    inventoryReport(),
    salesReport(range, unit),
  ]);
  return {
    unit,
    series,
    monthly: monthly.slice(-12),
    topProducts: [...top].sort((a, b) => b.qty - a.qty).slice(0, 10),
    topProfitProducts: [...top].sort((a, b) => b.grossProfit - a.grossProfit).slice(0, 10),
    salesByCategory: cats,
    purchasesBySupplier: purchases.bySupplier.slice(0, 10),
    inventoryByCategory: inv.byCategory,
    paymentMethods: sales.byPaymentMethod,
  };
}

export async function recentActivity(limit = 8) {
  const [sales, purchases, payments, supplierPayments, expenses, returns, adjustments] = await Promise.all([
    Sale.find().sort({ date: -1 }).limit(limit).select('invoiceNo date customerName total balanceDue status').lean(),
    PurchaseReceipt.find().sort({ date: -1 }).limit(limit).populate('supplierId', 'name').select('receiptNo date totalCost supplierId purchaseId').lean(),
    CustomerPayment.find().sort({ date: -1 }).limit(limit).select('paymentNo date amount method kind customerId').populate('customerId', 'name').lean(),
    SupplierPayment.find().sort({ date: -1 }).limit(limit).select('paymentNo date amount method supplierId').populate('supplierId', 'name').lean(),
    Expense.find({ status: 'POSTED' }).sort({ date: -1 }).limit(limit).populate('categoryId', 'name').select('expenseNo date amount description categoryId').lean(),
    CustomerReturn.find().sort({ date: -1 }).limit(limit).select('returnNo date invoiceNo totalAmount').lean(),
    (await import('../inventory/inventory.models.js')).StockAdjustment.find().sort({ createdAt: -1 }).limit(limit).populate('productId', 'sku name').lean(),
  ]);
  const inv = await inventoryReport();
  return { sales, purchases, payments, supplierPayments, expenses, returns, adjustments, lowStock: [...inv.outOfStock, ...inv.lowStock].slice(0, limit) };
}

/* --------------------------- Reconciliation ---------------------------- */

/** Independent integrity checks run against source records. */
export async function reconciliation() {
  const checks: { name: string; ok: boolean; expected?: number; actual?: number; detail?: string }[] = [];

  const unbalanced = await JournalEntry.countDocuments({ $expr: { $ne: ['$totalDebit', '$totalCredit'] } });
  checks.push({ name: 'Every journal entry is balanced', ok: unbalanced === 0, actual: unbalanced, detail: `${unbalanced} unbalanced entries` });

  const tb = await trialBalance();
  checks.push({ name: 'Trial balance debits equal credits', ok: tb.balanced, expected: tb.totalDebit, actual: tb.totalCredit });

  const bs = await balanceSheet();
  checks.push({ name: 'Balance sheet balances (Assets = Liabilities + Equity)', ok: bs.balanced, expected: bs.totalAssets, actual: bs.totalLiabilities + bs.totalEquity });

  const t = await totalsByAccount();
  const layerValue = (await CostLayer.aggregate([{ $group: { _id: null, v: { $sum: '$remainingCost' } } }]))[0]?.v ?? 0;
  checks.push({ name: 'Inventory ledger account equals Σ FIFO layer cost', ok: dr(t, ACCOUNTS.INVENTORY) === layerValue, expected: layerValue, actual: dr(t, ACCOUNTS.INVENTORY) });

  const balQty = await InventoryBalance.aggregate([{ $group: { _id: '$productId', q: { $sum: '$qtyOnHand' } } }]);
  const layerQty = await CostLayer.aggregate([{ $group: { _id: '$productId', q: { $sum: '$remainingQty' } } }]);
  const movQty = await Movement.aggregate([{ $group: { _id: '$productId', q: { $sum: '$qty' } } }]);
  const lq = new Map(layerQty.map((r) => [String(r._id), r.q]));
  const mq = new Map(movQty.map((r) => [String(r._id), r.q]));
  const qtyMismatch = balQty.filter((b) => (lq.get(String(b._id)) ?? 0) !== b.q || (mq.get(String(b._id)) ?? 0) !== b.q);
  checks.push({
    name: 'Stock balances equal Σ movements and Σ FIFO layer quantities',
    ok: qtyMismatch.length === 0,
    actual: qtyMismatch.length,
    detail: qtyMismatch.length ? `Products: ${qtyMismatch.map((m) => String(m._id)).join(', ')}` : undefined,
  });

  const negative = await InventoryBalance.countDocuments({ $or: [{ qtyOnHand: { $lt: 0 } }, { qtyAvailable: { $lt: 0 } }] });
  checks.push({ name: 'No negative stock', ok: negative === 0, actual: negative });

  const ar = await receivablesReport();
  checks.push({ name: 'Accounts receivable ledger equals open invoice balances', ok: ar.reconciled, expected: ar.totals.total, actual: ar.ledgerTotal });

  // Per-customer AR from ledger equals Σ sale balances.
  const arParty = await accountTotals({ accounts: [ACCOUNTS.ACCOUNTS_RECEIVABLE] }, 'party');
  const saleBal = await Sale.aggregate([{ $group: { _id: '$customerId', b: { $sum: '$balanceDue' } } }]);
  const sb = new Map(saleBal.map((r) => [String(r._id ?? null), r.b]));
  const custMismatch = arParty.filter((r) => r.debit - r.credit !== (sb.get(String(r._id ?? null)) ?? 0));
  checks.push({ name: 'Each customer ledger balance equals their invoice balances', ok: custMismatch.length === 0, actual: custMismatch.length });

  const ap = await payablesReport();
  checks.push({ name: 'Accounts payable ledger equals purchase balances', ok: ap.reconciled, expected: ap.totals.total, actual: ap.ledgerTotal });

  // Sale cached payments equal payment allocations.
  const allocs = await CustomerPayment.aggregate([{ $unwind: '$allocations' }, { $match: { kind: 'PAYMENT' } }, { $group: { _id: '$allocations.saleId', a: { $sum: '$allocations.amount' } } }]);
  const allocBy = new Map(allocs.map((r) => [String(r._id), r.a]));
  const sales = await Sale.find({}, { amountPaid: 1, invoiceNo: 1 }).lean();
  const paidMismatch = sales.filter((s) => (allocBy.get(String(s._id)) ?? 0) !== s.amountPaid);
  checks.push({
    name: 'Invoice paid amounts equal recorded payment allocations',
    ok: paidMismatch.length === 0,
    actual: paidMismatch.length,
    detail:
      paidMismatch
        .slice(0, 5)
        .map((s) => s.invoiceNo)
        .join(', ') || undefined,
  });

  const sp = await SupplierPayment.aggregate([{ $match: { purchaseId: { $exists: true } } }, { $group: { _id: '$purchaseId', a: { $sum: '$amount' } } }]);
  const spBy = new Map(sp.map((r) => [String(r._id), r.a]));
  const purchases = await Purchase.find({}, { amountPaid: 1, purchaseNo: 1 }).lean();
  const purMismatch = purchases.filter((p) => (spBy.get(String(p._id)) ?? 0) !== p.amountPaid);
  checks.push({ name: 'Purchase paid amounts equal supplier payments', ok: purMismatch.length === 0, actual: purMismatch.length });

  return { ok: checks.every((c) => c.ok), checkedAt: new Date(), checks };
}
