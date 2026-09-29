import { describe, expect, it } from 'vitest';
import {
  StockError,
  allocateFefo,
  balanceFromMovements,
  daysUntil,
  expiryStatus,
  formatMixedQty,
  signedQty,
  toBaseQty,
  type StockBatch,
} from './stock';

const TODAY = '2026-10-05';
const batch = (
  id: string,
  expiryDate: string,
  available: number,
  over: Partial<StockBatch> = {},
): StockBatch => ({
  id,
  batchNo: `B-${id}`,
  expiryDate,
  available,
  costUnitMicro: 1_000_000,
  ...over,
});

describe('expiry', () => {
  it('counts days, treats the printed expiry day as still sellable, and the day after as expired', () => {
    expect(daysUntil('2026-10-15', TODAY)).toBe(10);
    expect(expiryStatus('2026-10-05', TODAY)).toMatchObject({
      state: 'near',
      daysLeft: 0,
      window: 30,
    });
    expect(expiryStatus('2026-10-04', TODAY)).toMatchObject({ state: 'expired', daysLeft: -1 });
  });

  it('puts a batch in the smallest matching window, and ok beyond the largest', () => {
    expect(expiryStatus('2026-11-04', TODAY).window).toBe(30);
    expect(expiryStatus('2026-11-05', TODAY).window).toBe(60);
    expect(expiryStatus('2027-01-03', TODAY).window).toBe(90);
    expect(expiryStatus('2027-04-01', TODAY).window).toBe(180);
    expect(expiryStatus('2028-01-01', TODAY)).toMatchObject({ state: 'ok', window: null });
  });

  it('supports configurable windows and crosses month, year and leap-day boundaries', () => {
    expect(expiryStatus('2026-10-20', TODAY, [7, 14]).window).toBeNull();
    expect(expiryStatus('2026-10-12', TODAY, [7, 14]).window).toBe(7);
    expect(daysUntil('2028-03-01', '2028-02-28')).toBe(2); // 2028 is a leap year
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1);
  });

  it('rejects malformed dates', () => {
    expect(() => daysUntil('05/10/2026', TODAY)).toThrow(SyntaxError);
  });
});

describe('FEFO allocation', () => {
  it('takes the earliest expiry first and spans batches', () => {
    const res = allocateFefo(
      [
        batch('late', '2027-06-30', 100),
        batch('early', '2026-12-31', 30),
        batch('mid', '2027-01-31', 50),
      ],
      70,
      TODAY,
    );
    expect(res.allocations).toEqual([
      { batchId: 'early', qty: 30, costUnitMicro: 1_000_000 },
      { batchId: 'mid', qty: 40, costUnitMicro: 1_000_000 },
    ]);
  });

  it('never sells expired or blocked batches', () => {
    const res = allocateFefo(
      [
        batch('expired', '2026-10-04', 500),
        batch('recalled', '2026-11-01', 500, { blocked: true }),
        batch('good', '2027-05-01', 10),
      ],
      10,
      TODAY,
    );
    expect(res.allocations.map((a) => a.batchId)).toEqual(['good']);
    expect(() => allocateFefo([batch('expired', '2026-10-04', 500)], 1, TODAY)).toThrow(StockError);
  });

  it('reports insufficient stock with the numbers, and does not sell partially', () => {
    try {
      allocateFefo([batch('a', '2027-01-01', 5)], 8, TODAY);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(StockError);
      expect((e as StockError).code).toBe('INSUFFICIENT_STOCK');
      expect((e as StockError).details).toMatchObject({ available: 5, requested: 8, shortfall: 3 });
    }
  });

  it('honours a manually chosen batch first, but still refuses expired or blocked choices', () => {
    const batches = [batch('early', '2026-12-01', 10), batch('chosen', '2027-08-01', 10)];
    const res = allocateFefo(batches, 15, TODAY, { preferredBatchId: 'chosen' });
    expect(res.allocations).toEqual([
      { batchId: 'chosen', qty: 10, costUnitMicro: 1_000_000 },
      { batchId: 'early', qty: 5, costUnitMicro: 1_000_000 },
    ]);
    const bad = [batch('old', '2026-09-01', 10), batch('rec', '2027-01-01', 10, { blocked: true })];
    expect(() => allocateFefo(bad, 1, TODAY, { preferredBatchId: 'old' })).toThrow(/expired/);
    expect(() => allocateFefo(bad, 1, TODAY, { preferredBatchId: 'rec' })).toThrow(/blocked/);
    expect(() => allocateFefo(bad, 1, TODAY, { preferredBatchId: 'nope' })).toThrow(
      /does not exist/,
    );
  });

  it('records a shortage on a valid batch only when negative stock is allowed', () => {
    const batches = [batch('a', '2027-01-01', 5, { costUnitMicro: 2_000_000 })];
    const res = allocateFefo(batches, 8, TODAY, { allowNegativeOnBatchId: 'a' });
    expect(res.allocations).toEqual([{ batchId: 'a', qty: 8, costUnitMicro: 2_000_000 }]);
    expect(() =>
      allocateFefo([batch('x', '2026-01-01', 0)], 1, TODAY, { allowNegativeOnBatchId: 'x' }),
    ).toThrow(/no valid batch/);
  });

  it('total allocated always equals the quantity asked for', () => {
    const batches = Array.from({ length: 8 }, (_, i) =>
      batch(`b${i}`, `2027-0${(i % 9) + 1}-15`, 7 + i),
    );
    for (let q = 1; q <= 60; q += 7) {
      expect(allocateFefo(batches, q, TODAY).allocations.reduce((s, a) => s + a.qty, 0)).toBe(q);
    }
  });

  it('rejects non-positive or fractional quantities', () => {
    expect(() => allocateFefo([], 0, TODAY)).toThrow(RangeError);
    expect(() => allocateFefo([], 1.5, TODAY)).toThrow(RangeError);
  });
});

describe('units', () => {
  const units = [
    { id: 't', name: 'tablet', factorToBase: 1 },
    { id: 's', name: 'strip', factorToBase: 10 },
    { id: 'b', name: 'box', factorToBase: 100 },
  ];

  it('converts to the smallest unit and refuses fractions of it', () => {
    expect(toBaseQty(3, units[1] as { factorToBase: number })).toBe(30);
    expect(toBaseQty(2, units[2] as { factorToBase: number })).toBe(200);
    expect(() => toBaseQty(0.5, units[0] as { factorToBase: number })).toThrow(/whole number/);
    expect(() => toBaseQty(0, units[0] as { factorToBase: number })).toThrow(RangeError);
    expect(toBaseQty(0.5, units[1] as { factorToBase: number })).toBe(5); // half a strip is 5 tablets
  });

  it('formats a base quantity as mixed units', () => {
    expect(formatMixedQty(234, units)).toBe('2 box + 3 strip + 4 tablet');
    expect(formatMixedQty(100, units)).toBe('1 box');
    expect(formatMixedQty(0, units)).toBe('0');
    expect(formatMixedQty(-15, units)).toBe('-1 strip + 5 tablet');
  });
});

describe('ledger', () => {
  it('signs movements by kind and sums to a balance', () => {
    expect(signedQty('sale', 5)).toBe(-5);
    expect(signedQty('sale', -5)).toBe(-5);
    expect(signedQty('purchase', -7)).toBe(7);
    expect(signedQty('adjustment', -3)).toBe(-3);
    expect(() => signedQty('sale', 0)).toThrow(RangeError);
    expect(
      balanceFromMovements([
        { qtyBase: 100 },
        { qtyBase: signedQty('sale', 30) },
        { qtyBase: signedQty('sale_return', 5) },
        { qtyBase: signedQty('adjustment', -2) },
      ]),
    ).toBe(73);
  });
});
