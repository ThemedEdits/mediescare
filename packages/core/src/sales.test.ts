import { describe, expect, it } from 'vitest';
import { extractInclusiveTax, parseRateToMicro, roundMinorTo } from './money';
import {
  PaymentError,
  computeBill,
  costOfSaleMinor,
  profitMinor,
  settlePayments,
  type PricedLine,
} from './sales';

const rate = parseRateToMicro;
const line = (over: Partial<PricedLine> = {}): PricedLine => ({
  qtyBase: 1,
  rateUnitMicro: rate('100'),
  taxBp: 0,
  ...over,
});

describe('money additions', () => {
  it('splits inclusive tax so net + tax equals the amount', () => {
    expect(extractInclusiveTax(11_800, 1_800)).toEqual({ netMinor: 10_000, taxMinor: 1_800 });
    for (const a of [1, 99, 12_345, 99_999]) {
      const { netMinor, taxMinor } = extractInclusiveTax(a, 1_800);
      expect(netMinor + taxMinor).toBe(a);
    }
  });

  it('rounds to a unit, half up', () => {
    expect(roundMinorTo(12_349, 100)).toBe(12_300);
    expect(roundMinorTo(12_350, 100)).toBe(12_400);
    expect(roundMinorTo(12_325, 50)).toBe(12_350);
    expect(roundMinorTo(-12_350, 100)).toBe(-12_400);
  });
});

describe('computeBill', () => {
  it('prices a simple bill', () => {
    const bill = computeBill({ lines: [line({ qtyBase: 5, rateUnitMicro: rate('40.70') })] });
    expect(bill.lines[0]?.grossMinor).toBe(20_350);
    expect(bill.grandTotalMinor).toBe(20_350);
    expect(bill.totalDiscountMinor).toBe(0);
  });

  it('applies line discounts by percent or amount, never both', () => {
    const bill = computeBill({
      lines: [line({ discountBp: 1_000 }), line({ discountMinor: 250 })],
    });
    expect(bill.lineDiscountMinor).toBe(1_000 + 250);
    expect(bill.grandTotalMinor).toBe(20_000 - 1_250);
    expect(() => computeBill({ lines: [line({ discountBp: 100, discountMinor: 1 })] })).toThrow(
      /not both/,
    );
    expect(() => computeBill({ lines: [line({ discountMinor: 10_001 })] })).toThrow(
      /more than the line/,
    );
    expect(() => computeBill({ lines: [line({ discountBp: 10_001 })] })).toThrow(RangeError);
  });

  it('spreads a bill discount over lines exactly, whatever the split', () => {
    const lines = [
      line({ qtyBase: 1, rateUnitMicro: rate('33.33') }),
      line({ qtyBase: 1, rateUnitMicro: rate('66.67') }),
      line({ qtyBase: 3, rateUnitMicro: rate('10.01') }),
    ];
    for (const minor of [1, 7, 333, 1_000, 12_345]) {
      const bill = computeBill({ lines, billDiscount: { kind: 'amount', minor } });
      expect(bill.lines.reduce((s, l) => s + l.billDiscountShareMinor, 0)).toBe(minor);
      expect(bill.grandTotalMinor).toBe(bill.grossMinor - minor);
    }
  });

  it('bill percent discount is taken after line discounts', () => {
    const bill = computeBill({
      lines: [line({ discountBp: 1_000 })],
      billDiscount: { kind: 'percent', bp: 1_000 },
    });
    expect(bill.grandTotalMinor).toBe(8_100); // 100 -> 90 -> 81
    expect(bill.totalDiscountMinor).toBe(1_900);
  });

  it('adds exclusive tax per line after discount, and the total equals the sum of line nets', () => {
    const bill = computeBill({
      lines: [line({ taxBp: 1_800, discountBp: 1_000 }), line({ taxBp: 0 })],
    });
    expect(bill.lines[0]).toMatchObject({ taxMinor: 1_620, netMinor: 10_620 });
    expect(bill.taxMinor).toBe(1_620);
    expect(bill.grandTotalMinor).toBe(bill.lines.reduce((s, l) => s + l.netMinor, 0));
  });

  it('handles tax-inclusive prices: tax is inside the price and revenue excludes it', () => {
    const bill = computeBill({
      lines: [line({ rateUnitMicro: rate('118'), taxBp: 1_800, taxInclusive: true })],
    });
    expect(bill.grandTotalMinor).toBe(11_800);
    expect(bill.lines[0]).toMatchObject({ taxMinor: 1_800, revenueExTaxMinor: 10_000 });
  });

  it('rounds the total to the rupee as a separate visible amount', () => {
    const bill = computeBill({
      lines: [line({ qtyBase: 3, rateUnitMicro: rate('33.35') })],
      rounding: 'rupee',
    });
    expect(bill.rawTotalMinor).toBe(10_005);
    expect(bill.grandTotalMinor).toBe(10_000);
    expect(bill.roundingMinor).toBe(-5);
    expect(
      computeBill({ lines: [line({ rateUnitMicro: rate('99.50') })], rounding: 'half_rupee' })
        .roundingMinor,
    ).toBe(0);
    expect(
      computeBill({ lines: [line({ rateUnitMicro: rate('99.60') })], rounding: 'rupee' })
        .grandTotalMinor,
    ).toBe(10_000);
  });

  it('never produces a negative total and rejects an empty bill', () => {
    expect(
      computeBill({ lines: [line()], billDiscount: { kind: 'percent', bp: 10_000 } })
        .grandTotalMinor,
    ).toBe(0);
    expect(() => computeBill({ lines: [] })).toThrow(RangeError);
    expect(() =>
      computeBill({ lines: [line()], billDiscount: { kind: 'amount', minor: 10_001 } }),
    ).toThrow(/more than the bill/);
  });

  it('is the same whichever order lines are entered in', () => {
    const a = [
      line({ rateUnitMicro: rate('12.34'), qtyBase: 7, taxBp: 800 }),
      line({ rateUnitMicro: rate('56.78'), qtyBase: 3, taxBp: 1_800 }),
    ];
    const t1 = computeBill({ lines: a, billDiscount: { kind: 'amount', minor: 777 } });
    const t2 = computeBill({
      lines: [...a].reverse(),
      billDiscount: { kind: 'amount', minor: 777 },
    });
    expect(t1.grandTotalMinor).toBe(t2.grandTotalMinor);
  });
});

describe('cost and profit', () => {
  it('uses the cost of the batches sold, and profit ignores tax', () => {
    const bill = computeBill({
      lines: [line({ qtyBase: 10, rateUnitMicro: rate('4.07'), taxBp: 1_800 })],
    });
    const cost = costOfSaleMinor([
      { qty: 4, costUnitMicro: rate('3.10') },
      { qty: 6, costUnitMicro: rate('3.40') },
    ]);
    expect(cost).toBe(1_240 + 2_040);
    expect(profitMinor(bill, [cost])).toBe(4_070 - 3_280);
    expect(() => profitMinor(bill, [])).toThrow(RangeError);
  });

  it('can show a loss', () => {
    const bill = computeBill({ lines: [line({ rateUnitMicro: rate('10') })] });
    expect(profitMinor(bill, [1_500])).toBe(-500);
  });
});

describe('settlePayments', () => {
  it('gives change only on cash', () => {
    const s = settlePayments(20_350, [{ kind: 'cash', amountMinor: 50_000 }], { allowDue: false });
    expect(s).toMatchObject({ paidMinor: 20_350, dueMinor: 0, changeMinor: 29_650 });
    expect(s.applied).toEqual([{ kind: 'cash', amountMinor: 20_350 }]);
  });

  it('supports split tender and records cash net of change', () => {
    const s = settlePayments(
      10_000,
      [
        { kind: 'wallet', amountMinor: 4_000 },
        { kind: 'cash', amountMinor: 7_000 },
      ],
      { allowDue: false },
    );
    expect(s.applied).toEqual([
      { kind: 'cash', amountMinor: 6_000 },
      { kind: 'wallet', amountMinor: 4_000 },
    ]);
    expect(s.changeMinor).toBe(1_000);
    expect(s.applied.reduce((a, p) => a + p.amountMinor, 0)).toBe(10_000);
  });

  it('refuses card or wallet amounts above the bill', () => {
    expect(() =>
      settlePayments(10_000, [{ kind: 'card', amountMinor: 10_001 }], { allowDue: false }),
    ).toThrow(PaymentError);
    expect(() =>
      settlePayments(
        10_000,
        [
          { kind: 'card', amountMinor: 6_000 },
          { kind: 'wallet', amountMinor: 5_000 },
        ],
        { allowDue: false },
      ),
    ).toThrow(/cannot be more/);
  });

  it('short payment is an error unless the customer may owe (credit sale)', () => {
    expect(() =>
      settlePayments(10_000, [{ kind: 'cash', amountMinor: 9_000 }], { allowDue: false }),
    ).toThrow(/not fully paid/);
    const s = settlePayments(10_000, [{ kind: 'cash', amountMinor: 9_000 }], { allowDue: true });
    expect(s).toMatchObject({ paidMinor: 9_000, dueMinor: 1_000, changeMinor: 0 });
    expect(settlePayments(10_000, [], { allowDue: true }).dueMinor).toBe(10_000);
  });

  it('rejects zero or negative payments', () => {
    expect(() =>
      settlePayments(10_000, [{ kind: 'cash', amountMinor: 0 }], { allowDue: true }),
    ).toThrow(PaymentError);
    expect(() =>
      settlePayments(10_000, [{ kind: 'cash', amountMinor: -5 }], { allowDue: true }),
    ).toThrow(PaymentError);
  });
});
