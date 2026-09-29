import { describe, expect, it } from 'vitest';
import { afterFailover, formatDocNo, parseDocNo, takeNumber } from './numbering';

describe('document numbers', () => {
  it('formats and parses', () => {
    expect(formatDocNo('KHI01', 'INV', 123)).toBe('KHI01-INV-000123');
    expect(parseDocNo('KHI01-INV-000123')).toEqual({ branchCode: 'KHI01', type: 'INV', seq: 123 });
  });

  it('keeps growing past six digits', () => {
    expect(formatDocNo('HO', 'GRN', 1_234_567)).toBe('HO-GRN-1234567');
    expect(parseDocNo('HO-GRN-1234567').seq).toBe(1_234_567);
  });

  it('rejects bad input', () => {
    expect(() => formatDocNo('khi', 'INV', 1)).toThrow();
    expect(() => formatDocNo('KHI01', 'INV', 0)).toThrow(RangeError);
    expect(() => parseDocNo('nope')).toThrow(SyntaxError);
    expect(() => parseDocNo('KHI01-ZZZ-000001')).toThrow(SyntaxError);
  });

  it('two branches never collide', () => {
    expect(formatDocNo('KHI01', 'INV', 5)).not.toBe(formatDocNo('KHI02', 'INV', 5));
  });
});

describe('counter blocks', () => {
  it('hands out consecutive numbers and reserves a block', () => {
    const first = takeNumber({ next: 1, blockEnd: 0 }, 100);
    expect(first.seq).toBe(1);
    expect(first.state).toEqual({ next: 2, blockEnd: 100 });
    const second = takeNumber(first.state, 100);
    expect(second.seq).toBe(2);
    expect(second.state.blockEnd).toBe(100);
  });

  it('reserves a fresh block when exhausted', () => {
    const r = takeNumber({ next: 101, blockEnd: 100 }, 100);
    expect(r.seq).toBe(101);
    expect(r.state.blockEnd).toBe(200);
  });

  it('never reuses numbers after failover', () => {
    const promoted = afterFailover(120);
    expect(promoted.next).toBeGreaterThan(120);
    expect(promoted.next).toBe(621);
  });
});
