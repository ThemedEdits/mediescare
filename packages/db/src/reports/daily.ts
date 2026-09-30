import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import type { WriteContext } from '../context';
import { num, type ReportRange } from './util';

/**
 * One day of trading at a branch, all in paisa.
 *
 * Only posted invoices count as sales. Returns are taken off on the day the return was made:
 * refunds reduce revenue (minus the tax that goes back), and the cost of goods put back on the shelf
 * (restocked lines only; damaged goods stay a loss) reduces the cost of goods. Net revenue is ex tax.
 *   netRevenue = (billed - tax) - (refunds - returnedTax)
 *   cost       = costOfSales - costOfRestockedReturns
 *   profit     = netRevenue - cost
 */
export interface DailyFigures {
  date: string;
  invoices: number;
  gross: number;
  discount: number;
  tax: number;
  billed: number;
  returns: number;
  netRevenue: number;
  voids: number;
  cost: number;
  profit: number;
}

export function dailyFigures(db: DbOrTx, ctx: WriteContext, range: ReportRange): DailyFigures[] {
  const mod = range.localMod;
  const sold = db.all<{
    d: string;
    inv: number;
    gross: number;
    disc: number;
    tax: number;
    billed: number;
    cost: number;
    voids: number;
  }>(sql`
    SELECT date(created_at, ${mod}) AS d,
      SUM(status = 'posted') AS inv,
      SUM(CASE WHEN status = 'posted' THEN gross_minor ELSE 0 END) AS gross,
      SUM(CASE WHEN status = 'posted' THEN discount_minor ELSE 0 END) AS disc,
      SUM(CASE WHEN status = 'posted' THEN tax_minor ELSE 0 END) AS tax,
      SUM(CASE WHEN status = 'posted' THEN grand_total_minor ELSE 0 END) AS billed,
      SUM(CASE WHEN status = 'posted' THEN cost_minor ELSE 0 END) AS cost,
      SUM(status = 'void') AS voids
    FROM sales
    WHERE branch_id = ${ctx.branchId} AND created_at >= ${range.startIso} AND created_at < ${range.endIso}
    GROUP BY d`);
  const returned = db.all<{ d: string; refund: number; tax: number; cost: number }>(sql`
    SELECT date(r.created_at, ${mod}) AS d,
      SUM(rl.refund_minor) AS refund,
      SUM(sl.tax_minor * rl.qty_base / sl.qty_base) AS tax,
      SUM(CASE WHEN rl.restock = 1 THEN sl.cost_minor * rl.qty_base / sl.qty_base ELSE 0 END) AS cost
    FROM sale_returns r
    JOIN sale_return_lines rl ON rl.return_id = r.id
    JOIN sale_lines sl ON sl.id = rl.sale_line_id
    WHERE r.branch_id = ${ctx.branchId} AND r.created_at >= ${range.startIso} AND r.created_at < ${range.endIso}
    GROUP BY d`);

  const days = new Map<string, DailyFigures>();
  const day = (date: string): DailyFigures => {
    let f = days.get(date);
    if (!f) {
      f = {
        date,
        invoices: 0,
        gross: 0,
        discount: 0,
        tax: 0,
        billed: 0,
        returns: 0,
        netRevenue: 0,
        voids: 0,
        cost: 0,
        profit: 0,
      };
      days.set(date, f);
    }
    return f;
  };
  for (const s of sold) {
    const f = day(s.d);
    f.invoices = num(s.inv);
    f.gross = num(s.gross);
    f.discount = num(s.disc);
    f.tax = num(s.tax);
    f.billed = num(s.billed);
    f.cost = num(s.cost);
    f.voids = num(s.voids);
    f.netRevenue = f.billed - f.tax;
  }
  for (const r of returned) {
    const f = day(r.d);
    f.returns = num(r.refund);
    f.netRevenue -= num(r.refund) - num(r.tax);
    f.cost -= num(r.cost);
  }
  for (const f of days.values()) f.profit = f.netRevenue - f.cost;
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}
