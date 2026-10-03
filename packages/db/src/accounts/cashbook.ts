import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import type { WriteContext } from '../context';
import { resolveRange, type ReportRange } from '../reports/util';

/**
 * Where the money moved. Every figure is integer paisa.
 *   sale     money taken on posted invoices (after change; sales on account are not money yet)
 *   refund   money given back on returns (void invoices never counted in the first place)
 *   expense  posted expenses (void ones are left out)
 *   supplier payments made to suppliers
 *   adj_in / adj_out  cash book entries (opening balance and corrections), positive and negative
 */
export type MoveSource = 'sale' | 'refund' | 'expense' | 'supplier' | 'adj_in' | 'adj_out';

interface Move {
  source: MoveSource;
  date: string;
  modeId: string;
  amount: number;
}

interface Bounds {
  /** UTC ISO, inclusive and exclusive; '' sorts before every timestamp. */
  fromIso: string;
  toIso: string;
  /** Branch-local dates, inclusive start and exclusive end. */
  fromDate: string;
  toDateExcl: string;
}

const dayAfter = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** Every cash-relevant movement of the branch inside the bounds, grouped by day, mode and source. Credit is not money. */
function moves(db: DbOrTx, ctx: WriteContext, mod: string, b: Bounds): Move[] {
  const rows = db.all<{ source: MoveSource; d: string; mode_id: string; amt: number }>(sql`
    SELECT 'sale' AS source, date(s.created_at, ${mod}) AS d, p.mode_id AS mode_id, SUM(p.amount_minor) AS amt
      FROM sale_payments p JOIN sales s ON s.id = p.sale_id JOIN payment_modes m ON m.id = p.mode_id
      WHERE s.branch_id = ${ctx.branchId} AND s.status = 'posted' AND m.kind <> 'credit'
        AND s.created_at >= ${b.fromIso} AND s.created_at < ${b.toIso}
      GROUP BY d, p.mode_id
    UNION ALL
    SELECT 'refund', date(r.created_at, ${mod}), r.refund_mode_id, SUM(r.refund_minor)
      FROM sale_returns r JOIN payment_modes m ON m.id = r.refund_mode_id
      WHERE r.branch_id = ${ctx.branchId} AND m.kind <> 'credit'
        AND r.created_at >= ${b.fromIso} AND r.created_at < ${b.toIso}
      GROUP BY 2, 3
    UNION ALL
    SELECT 'expense', e.expense_date, e.mode_id, SUM(e.amount_minor)
      FROM expenses e
      WHERE e.branch_id = ${ctx.branchId} AND e.status = 'posted'
        AND e.expense_date >= ${b.fromDate} AND e.expense_date < ${b.toDateExcl}
      GROUP BY 2, 3
    UNION ALL
    SELECT 'supplier', date(p.paid_at, ${mod}), p.mode_id, SUM(p.amount_minor)
      FROM supplier_payments p
      WHERE p.branch_id = ${ctx.branchId}
        AND p.paid_at >= ${b.fromIso} AND p.paid_at < ${b.toIso}
      GROUP BY 2, 3
    UNION ALL
    SELECT CASE WHEN a.amount_minor > 0 THEN 'adj_in' ELSE 'adj_out' END, a.entry_date, a.mode_id, SUM(ABS(a.amount_minor))
      FROM cash_adjustments a
      WHERE a.branch_id = ${ctx.branchId} AND a.status = 'posted'
        AND a.entry_date >= ${b.fromDate} AND a.entry_date < ${b.toDateExcl}
      GROUP BY 1, 2, 3`);
  return rows.map((r) => ({
    source: r.source,
    date: r.d,
    modeId: r.mode_id,
    amount: Number(r.amt),
  }));
}

const IN: readonly MoveSource[] = ['sale', 'adj_in'];

export interface CashModeRow {
  modeId: string;
  name: string;
  kind: string;
  salesMinor: number;
  refundsMinor: number;
  expensesMinor: number;
  supplierPaymentsMinor: number;
  /** Cash book entries (opening balance, corrections), signed. */
  adjustmentsMinor: number;
  /** salesMinor + adjustmentsMinor - refundsMinor - expensesMinor - supplierPaymentsMinor */
  netMinor: number;
}

export interface CashDayRow {
  date: string;
  inMinor: number;
  outMinor: number;
  netMinor: number;
  closingMinor: number;
}

export interface CashFlow {
  range: { from: string; to: string };
  /** Cash on hand at the start of the first day: all cash taken minus all cash paid out before it. */
  openingCashMinor: number;
  closingCashMinor: number;
  /** Cash only (payment modes of kind cash). */
  /** Sales plus cash book entries that add cash. */
  cashIn: { salesMinor: number; adjustmentsMinor: number; totalMinor: number };
  cashOut: {
    refundsMinor: number;
    /** Cash book entries that remove cash. */
    adjustmentsMinor: number;
    expensesMinor: number;
    supplierPaymentsMinor: number;
    totalMinor: number;
  };
  byMode: CashModeRow[];
  expensesByCategory: { categoryId: string; name: string; amountMinor: number }[];
  daily: CashDayRow[];
}

/**
 * Cash book and cash flow for a date range.
 *   cash in  = cash taken on posted invoices + cash book entries that add cash (opening balance, corrections)
 *   cash out = cash refunds + cash expenses + cash supplier payments + cash book entries that remove cash
 *   closing  = opening + in - out, opening = (in - out) over everything before the range
 * Shift floats are moved between the safe and the till, so they are neither income nor expense.
 * Bank, wallet and card movements are shown by mode but have no opening or closing figure.
 */
export function cashFlow(
  db: DbOrTx,
  ctx: WriteContext,
  filters: { from?: string; to?: string },
  prepared?: ReportRange,
): CashFlow {
  const range = prepared ?? resolveRange(db, ctx, filters, 30);
  const mod = range.localMod;
  const modeRows = db.all<{ id: string; name: string; kind: string }>(sql`
    SELECT id, name, kind FROM payment_modes WHERE tenant_id = ${ctx.tenantId} AND kind <> 'credit'
    ORDER BY sort_order, name`);
  const kindOf = new Map(modeRows.map((m) => [m.id, m.kind]));

  const before = moves(db, ctx, mod, {
    fromIso: '',
    toIso: range.startIso,
    fromDate: '0000-00-00',
    toDateExcl: range.from,
  });
  const inside = moves(db, ctx, mod, {
    fromIso: range.startIso,
    toIso: range.endIso,
    fromDate: range.from,
    toDateExcl: dayAfter(range.to),
  });

  const signed = (m: Move): number => (IN.includes(m.source) ? m.amount : -m.amount);
  const isCash = (m: Move): boolean => kindOf.get(m.modeId) === 'cash';
  const openingCashMinor = before.filter(isCash).reduce((s, m) => s + signed(m), 0);

  const byMode = new Map<string, CashModeRow>();
  for (const m of modeRows)
    byMode.set(m.id, {
      modeId: m.id,
      name: m.name,
      kind: m.kind,
      salesMinor: 0,
      refundsMinor: 0,
      expensesMinor: 0,
      supplierPaymentsMinor: 0,
      adjustmentsMinor: 0,
      netMinor: 0,
    });
  const cash = { sales: 0, refunds: 0, expenses: 0, supplier: 0, adjIn: 0, adjOut: 0 };
  const perDay = new Map<string, { in: number; out: number }>();
  for (const m of inside) {
    const row = byMode.get(m.modeId);
    if (!row) continue;
    if (m.source === 'sale') row.salesMinor += m.amount;
    else if (m.source === 'refund') row.refundsMinor += m.amount;
    else if (m.source === 'expense') row.expensesMinor += m.amount;
    else if (m.source === 'adj_in') row.adjustmentsMinor += m.amount;
    else if (m.source === 'adj_out') row.adjustmentsMinor -= m.amount;
    else row.supplierPaymentsMinor += m.amount;
    row.netMinor += signed(m);
    if (!isCash(m)) continue;
    if (m.source === 'sale') cash.sales += m.amount;
    else if (m.source === 'refund') cash.refunds += m.amount;
    else if (m.source === 'expense') cash.expenses += m.amount;
    else if (m.source === 'adj_in') cash.adjIn += m.amount;
    else if (m.source === 'adj_out') cash.adjOut += m.amount;
    else cash.supplier += m.amount;
    const d = perDay.get(m.date) ?? { in: 0, out: 0 };
    if (IN.includes(m.source)) d.in += m.amount;
    else d.out += m.amount;
    perDay.set(m.date, d);
  }
  const inTotal = cash.sales + cash.adjIn;
  const outTotal = cash.refunds + cash.expenses + cash.supplier + cash.adjOut;

  let running = openingCashMinor;
  const daily: CashDayRow[] = [...perDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => {
      running += d.in - d.out;
      return {
        date,
        inMinor: d.in,
        outMinor: d.out,
        netMinor: d.in - d.out,
        closingMinor: running,
      };
    });

  return {
    range: { from: range.from, to: range.to },
    openingCashMinor,
    closingCashMinor: openingCashMinor + inTotal - outTotal,
    cashIn: { salesMinor: cash.sales, adjustmentsMinor: cash.adjIn, totalMinor: inTotal },
    cashOut: {
      refundsMinor: cash.refunds,
      adjustmentsMinor: cash.adjOut,
      expensesMinor: cash.expenses,
      supplierPaymentsMinor: cash.supplier,
      totalMinor: outTotal,
    },
    byMode: [...byMode.values()].filter(
      (r) =>
        r.kind === 'cash' ||
        r.salesMinor ||
        r.refundsMinor ||
        r.expensesMinor ||
        r.supplierPaymentsMinor ||
        r.adjustmentsMinor,
    ),
    expensesByCategory: expensesByCategory(db, ctx, range.from, range.to),
    daily,
  };
}

/** Posted expenses of the branch by category in a date range, largest first (void ones are left out). */
export function expensesByCategory(
  db: DbOrTx,
  ctx: WriteContext,
  from: string,
  to: string,
): { categoryId: string; name: string; amountMinor: number }[] {
  return db
    .all<{ id: string; name: string; amt: number }>(
      sql`SELECT c.id, c.name, SUM(e.amount_minor) AS amt
        FROM expenses e JOIN expense_categories c ON c.id = e.category_id
        WHERE e.branch_id = ${ctx.branchId} AND e.status = 'posted'
          AND e.expense_date >= ${from} AND e.expense_date <= ${to}
        GROUP BY c.id, c.name ORDER BY amt DESC, c.name`,
    )
    .map((r) => ({ categoryId: r.id, name: r.name, amountMinor: Number(r.amt) }));
}
