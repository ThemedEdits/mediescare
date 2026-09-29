/**
 * Sale totals, profit and payment settlement. Pure and heavily tested: all money maths lives here,
 * never in route handlers or React (CLAUDE.md §4.2). See ADR-0002 for the rounding rules.
 */
import {
  allocateLargestRemainder,
  extractInclusiveTax,
  lineAmountMinor,
  percentOfMinor,
  roundMinorTo,
} from './money';
import type { Allocation } from './stock';

export type Rounding = 'none' | 'rupee' | 'half_rupee';
const ROUND_UNIT: Record<Rounding, number> = { none: 1, rupee: 100, half_rupee: 50 };

export interface PricedLine {
  /** Quantity in the smallest unit. */
  qtyBase: number;
  /** Selling price per smallest unit, in micro-PKR. */
  rateUnitMicro: number;
  /** Line discount as basis points (percent) or a fixed amount in paisa. Not both. */
  discountBp?: number;
  discountMinor?: number;
  /** Tax rate in basis points (1800 = 18 %). */
  taxBp: number;
  /** True when the price already contains the tax. */
  taxInclusive?: boolean;
}

export type BillDiscount = { kind: 'percent'; bp: number } | { kind: 'amount'; minor: number };

export interface BillInput {
  lines: readonly PricedLine[];
  billDiscount?: BillDiscount;
  rounding?: Rounding;
}

export interface LineTotals {
  /** qty x rate, before any discount. */
  grossMinor: number;
  lineDiscountMinor: number;
  /** This line's share of the bill-level discount. */
  billDiscountShareMinor: number;
  /** What the customer pays for the goods on this line, tax included. */
  netMinor: number;
  taxMinor: number;
  /** Revenue without tax. Used for profit. */
  revenueExTaxMinor: number;
}

export interface BillTotals {
  lines: LineTotals[];
  grossMinor: number;
  lineDiscountMinor: number;
  billDiscountMinor: number;
  totalDiscountMinor: number;
  taxMinor: number;
  /** Sum of line nets before bill rounding. */
  rawTotalMinor: number;
  roundingMinor: number;
  grandTotalMinor: number;
}

/** Discount as a fraction of line gross must be sane. Throws on anything that would make a line negative. */
function lineDiscount(gross: number, line: PricedLine): number {
  if (line.discountBp !== undefined && line.discountMinor !== undefined)
    throw new RangeError('Use a percent or an amount discount on a line, not both');
  if (line.discountBp !== undefined) {
    if (line.discountBp < 0 || line.discountBp > 10_000)
      throw new RangeError('Discount must be between 0% and 100%');
    return percentOfMinor(gross, line.discountBp);
  }
  if (line.discountMinor !== undefined) {
    if (line.discountMinor < 0) throw new RangeError('Discount cannot be negative');
    if (line.discountMinor > gross)
      throw new RangeError('Discount cannot be more than the line amount');
    return line.discountMinor;
  }
  return 0;
}

/**
 * Compute a bill. Order: line discount, then the bill discount spread across lines (largest remainder,
 * so the parts add up exactly), then tax on each line, then optional bill rounding as its own line.
 * The total is the sum of rounded line values (ADR-0002 rule 4), never recomputed from unrounded parts.
 */
export function computeBill(input: BillInput): BillTotals {
  if (input.lines.length === 0) throw new RangeError('A bill needs at least one line');
  const grosses = input.lines.map((l) => lineAmountMinor(l.qtyBase, l.rateUnitMicro));
  const lineDiscounts = input.lines.map((l, i) => lineDiscount(grosses[i] as number, l));
  const afterLine = grosses.map((g, i) => g - (lineDiscounts[i] as number));
  const afterLineTotal = afterLine.reduce((a, b) => a + b, 0);

  let billDiscount = 0;
  if (input.billDiscount) {
    if (input.billDiscount.kind === 'percent') {
      if (input.billDiscount.bp < 0 || input.billDiscount.bp > 10_000)
        throw new RangeError('Discount must be between 0% and 100%');
      billDiscount = percentOfMinor(afterLineTotal, input.billDiscount.bp);
    } else {
      if (input.billDiscount.minor < 0) throw new RangeError('Discount cannot be negative');
      if (input.billDiscount.minor > afterLineTotal)
        throw new RangeError('Discount cannot be more than the bill total');
      billDiscount = input.billDiscount.minor;
    }
  }
  const shares =
    billDiscount > 0 && afterLineTotal > 0
      ? allocateLargestRemainder(billDiscount, afterLine)
      : afterLine.map(() => 0);

  const lines: LineTotals[] = input.lines.map((l, i) => {
    const taxable = (afterLine[i] as number) - (shares[i] as number);
    let netMinor: number;
    let taxMinor: number;
    let revenueExTaxMinor: number;
    if (l.taxInclusive) {
      const split = extractInclusiveTax(taxable, l.taxBp);
      netMinor = taxable;
      taxMinor = split.taxMinor;
      revenueExTaxMinor = split.netMinor;
    } else {
      taxMinor = percentOfMinor(taxable, l.taxBp);
      netMinor = taxable + taxMinor;
      revenueExTaxMinor = taxable;
    }
    return {
      grossMinor: grosses[i] as number,
      lineDiscountMinor: lineDiscounts[i] as number,
      billDiscountShareMinor: shares[i] as number,
      netMinor,
      taxMinor,
      revenueExTaxMinor,
    };
  });

  const rawTotalMinor = lines.reduce((s, l) => s + l.netMinor, 0);
  const grandTotalMinor = roundMinorTo(rawTotalMinor, ROUND_UNIT[input.rounding ?? 'none']);
  const lineDiscountMinor = lineDiscounts.reduce((a, b) => a + b, 0);
  return {
    lines,
    grossMinor: grosses.reduce((a, b) => a + b, 0),
    lineDiscountMinor,
    billDiscountMinor: billDiscount,
    totalDiscountMinor: lineDiscountMinor + billDiscount,
    taxMinor: lines.reduce((s, l) => s + l.taxMinor, 0),
    rawTotalMinor,
    roundingMinor: grandTotalMinor - rawTotalMinor,
    grandTotalMinor,
  };
}

/** Cost of sale for one line from the batches it was taken from (batch cost, not an average). */
export function costOfSaleMinor(
  allocations: readonly Pick<Allocation, 'qty' | 'costUnitMicro'>[],
): number {
  return allocations.reduce((sum, a) => sum + lineAmountMinor(a.qty, a.costUnitMicro), 0);
}

/** Profit = revenue without tax minus batch cost. Shown only to roles with view_profit. */
export function profitMinor(bill: BillTotals, costs: readonly number[]): number {
  if (costs.length !== bill.lines.length)
    throw new RangeError('One cost per bill line is required');
  return bill.lines.reduce((s, l, i) => s + l.revenueExTaxMinor - (costs[i] as number), 0);
}

export type PaymentKind = 'cash' | 'card' | 'wallet' | 'bank' | 'qr' | 'credit';

export interface TenderedPayment {
  kind: PaymentKind;
  amountMinor: number;
}

export interface Settlement {
  /** Payments as recorded: cash is stored net of change. */
  applied: TenderedPayment[];
  paidMinor: number;
  dueMinor: number;
  changeMinor: number;
}

export class PaymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentError';
  }
}

/**
 * Turn what the customer handed over into recorded payments. Only cash can produce change: a card or
 * wallet payment can never exceed what is still owed. `credit` (sell on account) needs a customer and
 * counts as paid on the bill but is recorded as an amount owed by the caller.
 */
export function settlePayments(
  grandTotalMinor: number,
  tendered: readonly TenderedPayment[],
  options: { allowDue: boolean },
): Settlement {
  for (const p of tendered) {
    if (!Number.isSafeInteger(p.amountMinor) || p.amountMinor <= 0)
      throw new PaymentError('Each payment must be a positive amount');
  }
  const noncash = tendered.filter((p) => p.kind !== 'cash');
  const cash = tendered.filter((p) => p.kind === 'cash').reduce((s, p) => s + p.amountMinor, 0);
  const noncashTotal = noncash.reduce((s, p) => s + p.amountMinor, 0);
  if (noncashTotal > grandTotalMinor)
    throw new PaymentError('Card, wallet and bank payments cannot be more than the bill');

  const cashOwed = grandTotalMinor - noncashTotal;
  const cashApplied = Math.min(cash, cashOwed);
  const changeMinor = cash - cashApplied;
  const paidMinor = noncashTotal + cashApplied;
  const dueMinor = grandTotalMinor - paidMinor;
  if (dueMinor > 0 && !options.allowDue) throw new PaymentError('The bill is not fully paid');

  const applied: TenderedPayment[] = [...noncash];
  if (cashApplied > 0) applied.unshift({ kind: 'cash', amountMinor: cashApplied });
  return { applied, paidMinor, dueMinor, changeMinor };
}
