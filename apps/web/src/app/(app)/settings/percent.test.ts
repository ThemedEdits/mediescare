import { describe, expect, it } from 'vitest';
import { bpToPercent, percentToBp } from './percent';

describe('percent helpers', () => {
  it('converts basis points to text without floats', () => {
    expect(bpToPercent(0)).toBe('0');
    expect(bpToPercent(1700)).toBe('17');
    expect(bpToPercent(50)).toBe('0.5');
    expect(bpToPercent(1725)).toBe('17.25');
    expect(bpToPercent(5)).toBe('0.05');
  });
  it('parses typed percentages and rejects bad input', () => {
    expect(percentToBp('17')).toBe(1700);
    expect(percentToBp('0.5')).toBe(50);
    expect(percentToBp('17.25')).toBe(1725);
    expect(percentToBp('')).toBe(0);
    expect(percentToBp('100')).toBe(10_000);
    expect(percentToBp('100.01')).toBeNull();
    expect(percentToBp('-1')).toBeNull();
    expect(percentToBp('abc')).toBeNull();
    expect(percentToBp('1.234')).toBeNull();
  });
});
