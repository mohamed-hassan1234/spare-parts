import { describe, expect, it } from 'vitest';
import { allocate, marginPercent, markupPercent, mulDiv, percentOf } from '../../utils/money.js';
import { allocatePayment, paymentStatusOf, priceCart, returnShare } from '../../modules/sales/pricing.js';
import { allocateLandedCost } from '../../modules/purchases/purchases.service.js';
import { resolvePeriod, localDateKey } from '../../utils/dates.js';
import { totpCode, verifyTotp, base32Decode, base32Encode } from '../../modules/auth/totp.js';
import { parseToCents, formatCents } from '@autoparts/shared';
import { parseCsv, toCsv } from '../../utils/export.js';

describe('money primitives', () => {
  it('mulDiv rounds half away from zero with integers only', () => {
    expect(mulDiv(1000, 1, 3)).toBe(333);
    expect(mulDiv(1000, 2, 3)).toBe(667);
    expect(mulDiv(5, 1, 2)).toBe(3);
    expect(mulDiv(-5, 1, 2)).toBe(-3);
  });
  it('allocate always sums exactly to the total', () => {
    for (const [total, weights] of [
      [100, [1, 1, 1]],
      [1, [5, 5]],
      [99_999, [3, 7, 11, 13]],
      [0, [1, 2]],
      [10, [0, 0]],
    ] as [number, number[]][]) {
      const parts = allocate(total, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts.every((p) => p >= 0)).toBe(true);
    }
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
  });
  it('percentOf uses basis points', () => {
    expect(percentOf(10_000, 500)).toBe(500);
    expect(percentOf(333, 1500)).toBe(50);
  });
  it('markup and margin are different calculations', () => {
    expect(markupPercent(150, 100)).toBe(50);
    expect(marginPercent(150, 100)).toBe(33.33);
    expect(markupPercent(100, 0)).toBeNull();
    expect(marginPercent(0, 10)).toBeNull();
  });
  it('parses and formats money without float drift', () => {
    expect(parseToCents('0.1')).toBe(10);
    expect(parseToCents('19.99')).toBe(1999);
    expect(parseToCents('1234')).toBe(123400);
    expect(() => parseToCents('1.234')).toThrow();
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-5)).toBe('-$0.05');
  });
});

describe('cart pricing', () => {
  it('computes discounts and exclusive tax with an exact journal identity', () => {
    const r = priceCart(
      [
        { qty: 2, unitPrice: 4500, discount: 500 },
        { qty: 3, unitPrice: 850, discount: 0 },
      ],
      300,
      1000,
      false,
    );
    expect(r.subtotal).toBe(11_550);
    expect(r.discountTotal).toBe(800);
    expect(r.netSales).toBe(10_750);
    expect(r.taxTotal).toBe(1075);
    expect(r.total).toBe(11_825);
    for (const l of r.lines) expect(l.revenueEx - l.discountEx + l.tax).toBe(l.lineTotal);
  });
  it('handles tax-inclusive prices', () => {
    const r = priceCart([{ qty: 1, unitPrice: 1100, discount: 0 }], 0, 1000, true);
    expect(r.total).toBe(1100);
    expect(r.taxTotal).toBe(100);
    expect(r.netSales).toBe(1000);
    for (const l of r.lines) expect(l.revenueEx - l.discountEx + l.tax).toBe(l.lineTotal);
  });
  it('rejects discounts larger than the value', () => {
    expect(() => priceCart([{ qty: 1, unitPrice: 100, discount: 101 }], 0, 0, false)).toThrow();
    expect(() => priceCart([{ qty: 1, unitPrice: 100, discount: 0 }], 101, 0, false)).toThrow();
  });
  it('without tax, total equals net sales', () => {
    const r = priceCart([{ qty: 3, unitPrice: 333, discount: 0 }], 1, 0, false);
    expect(r.total).toBe(998);
    expect(r.taxTotal).toBe(0);
  });
});

describe('payments and returns', () => {
  it('allocates payments oldest-first and reports the remainder', () => {
    const r = allocatePayment(1500, [
      { id: 'a', balanceDue: 1000 },
      { id: 'b', balanceDue: 1000 },
    ]);
    expect(r.allocations).toEqual([
      { id: 'a', amount: 1000 },
      { id: 'b', amount: 500 },
    ]);
    expect(r.remainder).toBe(0);
    expect(allocatePayment(3000, [{ id: 'a', balanceDue: 1000 }]).remainder).toBe(2000);
  });
  it('partial returns are proportional and the final return takes the exact remainder', () => {
    const first = returnShare(1000, 0, 1, 0, 3);
    const second = returnShare(1000, first, 1, 1, 3);
    const third = returnShare(1000, first + second, 1, 2, 3);
    expect(first + second + third).toBe(1000);
  });
  it('payment status', () => {
    expect(paymentStatusOf(100, 0)).toBe('PAID');
    expect(paymentStatusOf(100, 40)).toBe('PARTIAL');
    expect(paymentStatusOf(100, 100)).toBe('UNPAID');
  });
});

describe('landed cost allocation', () => {
  const lines = [
    { lineNet: 50_000, qty: 20, weightGrams: 1000 },
    { lineNet: 20_000, qty: 50, weightGrams: 200 },
    { lineNet: 30_000, qty: 30, weightGrams: 500 },
  ];
  it('by value', () => {
    expect(allocateLandedCost(lines, 10_000, 'VALUE')).toEqual([5000, 2000, 3000]);
  });
  it('by quantity', () => {
    const r = allocateLandedCost(lines, 10_000, 'QUANTITY');
    expect(r.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(r).toEqual([2000, 5000, 3000]);
  });
  it('by weight', () => {
    const r = allocateLandedCost(lines, 10_000, 'WEIGHT');
    expect(r.reduce((a, b) => a + b, 0)).toBe(10_000);
    expect(r[0]).toBeGreaterThan(r[2]);
  });
  it('manual must match the total', () => {
    expect(() =>
      allocateLandedCost(
        lines.map((l) => ({ ...l, manualExtraCost: 1 })),
        10_000,
        'MANUAL',
      ),
    ).toThrow();
    expect(
      allocateLandedCost(
        lines.map((l, i) => ({ ...l, manualExtraCost: [4000, 3000, 3000][i] })),
        10_000,
        'MANUAL',
      ),
    ).toEqual([4000, 3000, 3000]);
  });
});

describe('dates and periods', () => {
  it('resolves "today" in Africa/Mogadishu (UTC+3)', () => {
    const now = new Date('2026-03-10T22:30:00Z'); // 01:30 on 11 March local
    const r = resolvePeriod('today', 'Africa/Mogadishu', undefined, undefined, now);
    expect(r.from.toISOString()).toBe('2026-03-10T21:00:00.000Z');
    expect(r.to.toISOString()).toBe('2026-03-11T21:00:00.000Z');
    expect(localDateKey(now, 'Africa/Mogadishu')).toBe('2026-03-11');
  });
  it('resolves months and custom ranges', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    const prev = resolvePeriod('prevMonth', 'Africa/Mogadishu', undefined, undefined, now);
    expect(prev.from.toISOString()).toBe('2025-11-30T21:00:00.000Z');
    const c = resolvePeriod('custom', 'UTC', '2026-01-01', '2026-01-31');
    expect(c.to.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('TOTP', () => {
  it('matches the RFC 6238 SHA-1 test vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    expect(totpCode(secret, 59_000)).toBe('287082');
    expect(verifyTotp(secret, '287082', 59_000)).toBe(true);
    expect(verifyTotp(secret, '000000', 59_000)).toBe(false);
  });
});

describe('CSV', () => {
  it('round-trips quoted values and neutralises formulas', () => {
    const csv = toCsv([{ header: 'name', value: (r: { n: string }) => r.n }], [{ n: 'Pad, "front"' }, { n: '=HYPERLINK("x")' }]);
    const rows = parseCsv(csv);
    expect(rows[0].name).toBe('Pad, "front"');
    expect(rows[1].name.startsWith("'=")).toBe(true);
  });
});
