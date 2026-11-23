import { allocate, mulDiv, percentOf, sum } from '../../utils/money.js';

export interface PriceLineInput {
  qty: number;
  unitPrice: number;
  discount: number;
}

export interface PricedLine {
  gross: number;
  cartDiscountShare: number;
  revenueEx: number;
  discountEx: number;
  tax: number;
  lineTotal: number;
}

/**
 * Price a cart. Pure function — the single source of truth for invoice maths.
 *
 *  gross        = qty × unitPrice
 *  netCharged   = gross − lineDiscount − share of cart discount
 *  exclusive tax: tax = netCharged × rate ;  lineTotal = netCharged + tax
 *  inclusive tax: lineTotal = netCharged ;    tax = lineTotal − lineTotal / (1 + rate)
 *
 * revenueEx − discountEx + tax = lineTotal holds exactly for every line, which is
 * what keeps the sale journal balanced.
 */
export function priceCart(lines: PriceLineInput[], cartDiscount: number, taxRateBps: number, pricesIncludeTax: boolean) {
  const gross = lines.map((l) => l.qty * l.unitPrice);
  const afterLine = lines.map((l, i) => gross[i] - l.discount);
  if (afterLine.some((x) => x < 0)) throw new Error('Line discount cannot exceed line value');
  const preCart = sum(afterLine);
  if (cartDiscount > preCart) throw new Error('Cart discount cannot exceed the cart value');
  const shares = allocate(cartDiscount, afterLine);
  const priced: PricedLine[] = lines.map((l, i) => {
    const netCharged = afterLine[i] - shares[i];
    const totalDisc = l.discount + shares[i];
    if (!pricesIncludeTax || taxRateBps === 0) {
      const tax = percentOf(netCharged, taxRateBps);
      return { gross: gross[i], cartDiscountShare: shares[i], revenueEx: gross[i], discountEx: totalDisc, tax, lineTotal: netCharged + tax };
    }
    const lineTotal = netCharged;
    const netEx = mulDiv(lineTotal, 10_000, 10_000 + taxRateBps);
    const tax = lineTotal - netEx;
    const revenueEx = mulDiv(gross[i], 10_000, 10_000 + taxRateBps);
    const discountEx = revenueEx - netEx;
    return { gross: gross[i], cartDiscountShare: shares[i], revenueEx, discountEx, tax, lineTotal };
  });
  const subtotal = sum(priced.map((p) => p.revenueEx));
  const discountTotal = sum(priced.map((p) => p.discountEx));
  const taxTotal = sum(priced.map((p) => p.tax));
  const total = sum(priced.map((p) => p.lineTotal));
  return { lines: priced, subtotal, discountTotal, netSales: subtotal - discountTotal, taxTotal, total };
}

/** Allocate a payment to open invoices oldest-first. Returns allocations and the unallocated remainder. */
export function allocatePayment(amount: number, open: { id: string; balanceDue: number }[]) {
  let left = amount;
  const out: { id: string; amount: number }[] = [];
  for (const inv of open) {
    if (left <= 0) break;
    if (inv.balanceDue <= 0) continue;
    const a = Math.min(left, inv.balanceDue);
    out.push({ id: inv.id, amount: a });
    left -= a;
  }
  return { allocations: out, remainder: left };
}

/** Proportional share of a line amount for a partial return; the final return takes the exact remainder. */
export function returnShare(total: number, alreadyReturned: number, qty: number, qtyReturnedBefore: number, qtyTotal: number) {
  if (qtyReturnedBefore + qty === qtyTotal) return total - alreadyReturned;
  return mulDiv(total, qty, qtyTotal);
}

export function paymentStatusOf(total: number, balanceDue: number): 'PAID' | 'PARTIAL' | 'UNPAID' {
  if (balanceDue <= 0) return 'PAID';
  return balanceDue < total ? 'PARTIAL' : 'UNPAID';
}
