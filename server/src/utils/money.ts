/**
 * Money helpers. All amounts are integer minor units (cents).
 * Never use floating point to accumulate money: only integer addition and
 * explicitly rounded proportional splits (BigInt based) are allowed.
 */
export function assertCents(n: number, label = 'amount'): number {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be an integer number of cents`);
  return n;
}

/** Round-half-away-from-zero of (amount * num / den), computed with BigInt. */
export function mulDiv(amount: number, num: number, den: number): number {
  if (den === 0) throw new Error('Division by zero');
  const a = BigInt(amount) * BigInt(num);
  const d = BigInt(den);
  const neg = a < 0n !== d < 0n;
  const absA = a < 0n ? -a : a;
  const absD = d < 0n ? -d : d;
  const q = (absA * 2n + absD) / (2n * absD);
  return Number(neg ? -q : q);
}

/** Percentage in basis points (1500 = 15.00%) of an amount, rounded. */
export function percentOf(amount: number, basisPoints: number): number {
  return mulDiv(amount, basisPoints, 10_000);
}

/**
 * Split `total` cents across non-negative integer weights so that the parts sum
 * exactly to `total` (largest-remainder method). Used for landed-cost and
 * cart-discount allocation.
 */
export function allocate(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const w = weights.map((x) => BigInt(Math.max(0, Math.round(x))));
  const sumW = w.reduce((s, x) => s + x, 0n);
  if (sumW === 0n)
    return allocate(
      total,
      weights.map(() => 1),
    );
  const T = BigInt(total);
  const floors = w.map((x) => (T * x) / sumW);
  const rems = w.map((x, i) => ({ i, r: T * x - floors[i] * sumW }));
  let remainder = total - Number(floors.reduce((s, x) => s + x, 0n));
  const out = floors.map(Number);
  rems.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (let k = 0; remainder > 0; k = (k + 1) % out.length, remainder--) out[rems[k].i] += 1;
  return out;
}

export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Markup % = (price − cost) / cost × 100. */
export function markupPercent(price: number, cost: number): number | null {
  if (cost <= 0) return null;
  return Math.round(((price - cost) / cost) * 10_000) / 100;
}

/** Gross margin % = (price − cost) / price × 100. */
export function marginPercent(price: number, cost: number): number | null {
  if (price <= 0) return null;
  return Math.round(((price - cost) / price) * 10_000) / 100;
}
