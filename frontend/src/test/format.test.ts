import { describe, expect, it } from 'vitest';
import { centsToInput, inputToCents, money, pct } from '@/lib/format';
import { cartTotals, type CartLine } from '@/pages/pos';

describe('money formatting and parsing (integer cents, no floats)', () => {
  it('formats cents as USD', () => {
    expect(money(123456)).toBe('$1,234.56');
    expect(money(5)).toBe('$0.05');
    expect(money(-2000)).toBe('-$20.00');
    expect(money(0)).toBe('$0.00');
    expect(money(null)).toBe('—');
  });
  it('parses user input exactly', () => {
    expect(inputToCents('12.5')).toBe(1250);
    expect(inputToCents('0.10')).toBe(10);
    expect(inputToCents('$1,234.56')).toBe(123456);
    expect(inputToCents('19.99')).toBe(1999); // 19.99 * 100 in floats is 1998.9999…
    expect(inputToCents('')).toBeNull();
  });
  it('rejects invalid amounts', () => {
    expect(inputToCents('1.234')).toBeNull();
    expect(inputToCents('abc')).toBeNull();
    expect(inputToCents('1e3')).toBeNull();
  });
  it('round-trips cents to input text', () => {
    for (const c of [0, 1, 99, 100, 1999, 123456]) expect(inputToCents(centsToInput(c))).toBe(c);
    expect(centsToInput(-150)).toBe('-1.50');
  });
  it('formats percentages', () => {
    expect(pct(37.37)).toBe('37.4%');
    expect(pct(null)).toBe('—');
  });
});

describe('POS cart preview totals', () => {
  const p = (price: number) => ({
    _id: String(price),
    sku: 'S',
    name: 'N',
    sellingPrice: price,
    minimumSellingPrice: 0,
    reorderPoint: 0,
    oemPartNumbers: [],
    alternativePartNumbers: [],
    unit: 'pcs',
    warrantyMonths: 0,
    reorderQuantity: 0,
    condition: 'NEW',
    isActive: true,
  });
  const line = (price: number, qty: number, unitPrice = price, discount = 0): CartLine => ({ product: p(price), qty, unitPrice, discount });

  it('sums quantities × prices', () => {
    expect(cartTotals([line(800, 30)], 0).net).toBe(24_000);
  });
  it('applies line and cart discounts and reports total discount against list price', () => {
    const t = cartTotals([line(1000, 2, 900, 100), line(500, 1)], 50);
    expect(t.gross).toBe(2500);
    expect(t.net).toBe(2 * 900 - 100 + 500 - 50);
    expect(t.discountTotal).toBe(2500 - t.net);
  });
  it('handles an empty cart', () => {
    expect(cartTotals([], 0)).toEqual({ gross: 0, subtotal: 0, lineDiscounts: 0, discountTotal: 0, net: 0 });
  });
});
