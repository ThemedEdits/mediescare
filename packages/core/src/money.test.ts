import { describe, expect, it } from 'vitest';
import {
  allocateLargestRemainder,
  formatMinor,
  lineAmountMinor,
  minorToMicro,
  parseMoneyToMinor,
  parseRateToMicro,
  percentOfMinor,
} from './money';

describe('lineAmountMinor', () => {
  it('multiplies quantity by a per-unit rate and rounds once', () => {
    // 5 tablets at PKR 6.25 = PKR 31.25
    expect(lineAmountMinor(5, parseRateToMicro('6.25'))).toBe(3125);
  });

  it('rounds half up at exactly half a paisa', () => {
    // 1 unit at PKR 0.005 = 0.5 paisa, rounds to 1
    expect(lineAmountMinor(1, 5_000)).toBe(1);
    expect(lineAmountMinor(1, 4_999)).toBe(0);
  });

  it('rounds half away from zero for negatives (returns)', () => {
    expect(lineAmountMinor(-1, 5_000)).toBe(-1);
    expect(lineAmountMinor(-1, 4_999)).toBe(0);
  });

  it('handles sub-paisa unit costs on large quantities without drift', () => {
    // PKR 4.1667 per tablet x 3000 tablets = PKR 12,500.10
    expect(lineAmountMinor(3000, parseRateToMicro('4.1667'))).toBe(1_250_010);
  });

  it('never returns negative zero', () => {
    expect(Object.is(lineAmountMinor(-1, 1), -0)).toBe(false);
    expect(lineAmountMinor(-1, 1)).toBe(0);
  });

  it('rejects non-integers', () => {
    expect(() => lineAmountMinor(1.5, 100)).toThrow(RangeError);
    expect(() => lineAmountMinor(1, 0.1)).toThrow(RangeError);
  });
});

describe('percentOfMinor', () => {
  it('computes tax and discount from basis points', () => {
    expect(percentOfMinor(10_000, 1_800)).toBe(1_800); // 18 % of PKR 100
    expect(percentOfMinor(3_333, 1_800)).toBe(600); // 599.94 rounds to 600
  });

  it('rounds half up', () => {
    expect(percentOfMinor(1, 5_000)).toBe(1); // 0.5 paisa
  });
});

describe('minorToMicro', () => {
  it('is exact', () => {
    expect(minorToMicro(1)).toBe(10_000);
  });
});

describe('allocateLargestRemainder', () => {
  it('always adds up to the total', () => {
    const parts = allocateLargestRemainder(100, [1, 1, 1]);
    expect(parts).toEqual([34, 33, 33]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it('follows the weights', () => {
    expect(allocateLargestRemainder(1000, [203_50, 0, 796_50])).toEqual([204, 0, 796]);
  });

  it('adds up for many random cases', () => {
    for (let i = 1; i < 200; i++) {
      const weights = [i, i * 3 + 1, 7, 13 + i];
      const parts = allocateLargestRemainder(i * 97, weights);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(i * 97);
    }
  });

  it('rejects invalid input', () => {
    expect(() => allocateLargestRemainder(-1, [1])).toThrow(RangeError);
    expect(() => allocateLargestRemainder(10, [0, 0])).toThrow(RangeError);
    expect(() => allocateLargestRemainder(10, [])).toThrow(RangeError);
  });
});

describe('format and parse', () => {
  it('formats with grouping and two decimals', () => {
    expect(formatMinor(0)).toBe('0.00');
    expect(formatMinor(5)).toBe('0.05');
    expect(formatMinor(123_450)).toBe('1,234.50');
    expect(formatMinor(-123_450)).toBe('-1,234.50');
    expect(formatMinor(548_544_577)).toBe('5,485,445.77');
  });

  it('parses back exactly', () => {
    expect(parseMoneyToMinor('1,234.50')).toBe(123_450);
    expect(parseMoneyToMinor('203.5')).toBe(20_350);
    expect(parseMoneyToMinor('-0.05')).toBe(-5);
    expect(parseMoneyToMinor('7')).toBe(700);
  });

  it('round-trips format and parse', () => {
    for (const v of [0, 1, 99, 100, 101, 999_999_999, -12_345]) {
      expect(parseMoneyToMinor(formatMinor(v))).toBe(v);
    }
  });

  it('rejects more than two decimals instead of rounding', () => {
    expect(() => parseMoneyToMinor('1.005')).toThrow(SyntaxError);
  });

  it('rejects garbage', () => {
    expect(() => parseMoneyToMinor('abc')).toThrow(SyntaxError);
    expect(() => parseMoneyToMinor('1,23')).toThrow(SyntaxError);
    expect(() => parseMoneyToMinor('')).toThrow(SyntaxError);
  });

  it('parses per-unit rates with up to six decimals', () => {
    expect(parseRateToMicro('6.25')).toBe(6_250_000);
    expect(parseRateToMicro('0.000001')).toBe(1);
    expect(() => parseRateToMicro('0.0000001')).toThrow(SyntaxError);
  });
});
