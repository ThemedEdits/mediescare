/**
 * Money helpers (ADR-0002).
 *
 * - Posted amounts are integer paisa ("minor", 1 PKR = 100).
 * - Per-unit rates and costs are integer micro-PKR (1 paisa = 10,000 micro).
 * - Percentages are integer basis points (1 bp = 0.01 %).
 * - All products use BigInt and round half up (away from zero) exactly once.
 * No floats are ever used for money.
 */

export const PAISA_PER_PKR = 100;
export const MICRO_PER_PAISA = 10_000;
export const BP_DENOMINATOR = 10_000;

function assertInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${name} must be a safe integer, got ${value}`);
  }
}

/** Integer division of n by d (d > 0), rounding half away from zero. */
function divRoundHalfUp(n: bigint, d: bigint): bigint {
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const quotient = abs / d;
  const rounded = (abs % d) * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function toSafeNumber(value: bigint): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError('Money value exceeds the safe integer range');
  return n === 0 ? 0 : n; // never return negative zero
}

/** Line amount in paisa = qty (smallest unit) x rate (micro-PKR per unit), rounded once. */
export function lineAmountMinor(qtyBase: number, rateUnitMicro: number): number {
  assertInt(qtyBase, 'qtyBase');
  assertInt(rateUnitMicro, 'rateUnitMicro');
  return toSafeNumber(divRoundHalfUp(BigInt(qtyBase) * BigInt(rateUnitMicro), BigInt(MICRO_PER_PAISA)));
}

/** Amount x basis points, rounded once to paisa (tax, discount percentage, WHT). */
export function percentOfMinor(amountMinor: number, bp: number): number {
  assertInt(amountMinor, 'amountMinor');
  assertInt(bp, 'bp');
  return toSafeNumber(divRoundHalfUp(BigInt(amountMinor) * BigInt(bp), BigInt(BP_DENOMINATOR)));
}

/** Convert a whole-paisa amount to micro-PKR (exact). */
export function minorToMicro(amountMinor: number): number {
  assertInt(amountMinor, 'amountMinor');
  return toSafeNumber(BigInt(amountMinor) * BigInt(MICRO_PER_PAISA));
}

/**
 * Split a non-negative total across weights so the parts add up exactly
 * (largest remainder method). Ties go to the earliest index.
 */
export function allocateLargestRemainder(totalMinor: number, weights: readonly number[]): number[] {
  assertInt(totalMinor, 'totalMinor');
  if (totalMinor < 0) throw new RangeError('totalMinor must not be negative');
  if (weights.length === 0) throw new RangeError('weights must not be empty');
  weights.forEach((w, i) => {
    assertInt(w, `weights[${i}]`);
    if (w < 0) throw new RangeError('weights must not be negative');
  });
  const sum = weights.reduce((a, b) => a + BigInt(b), 0n);
  if (sum === 0n) throw new RangeError('weights must not all be zero');

  const total = BigInt(totalMinor);
  const shares = weights.map((w) => (total * BigInt(w)) / sum);
  const remainders = weights.map((w, index) => ({ index, rem: (total * BigInt(w)) % sum }));
  let leftover = total - shares.reduce((a, b) => a + b, 0n);
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const { index } of remainders) {
    if (leftover === 0n) break;
    shares[index] = (shares[index] ?? 0n) + 1n;
    leftover -= 1n;
  }
  return shares.map(toSafeNumber);
}

/** Format paisa as "1,234.50". Western digits in every language (ADR-0002). */
export function formatMinor(amountMinor: number): string {
  assertInt(amountMinor, 'amountMinor');
  const negative = amountMinor < 0;
  const abs = BigInt(negative ? -amountMinor : amountMinor);
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

const DECIMAL = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/;

function parseDecimal(text: string, maxFraction: number, unitsPerWhole: bigint): number {
  const match = DECIMAL.exec(text.trim());
  if (!match) throw new SyntaxError(`Not a valid amount: "${text}"`);
  const [, sign, wholeRaw = '0', fraction = ''] = match;
  if (fraction.length > maxFraction) {
    throw new SyntaxError(`Too many decimal places (max ${maxFraction}): "${text}"`);
  }
  const whole = BigInt(wholeRaw.replace(/,/g, ''));
  const frac = BigInt(fraction.padEnd(maxFraction, '0') || '0');
  const value = whole * unitsPerWhole + frac;
  return toSafeNumber(sign ? -value : value);
}

/** Parse "1,234.50" into paisa. More than two decimals is rejected, never silently rounded. */
export function parseMoneyToMinor(text: string): number {
  return parseDecimal(text, 2, 100n);
}

/** Parse a per-unit rate such as "6.2500" into micro-PKR (up to six decimals). */
export function parseRateToMicro(text: string): number {
  return parseDecimal(text, 6, 1_000_000n);
}
