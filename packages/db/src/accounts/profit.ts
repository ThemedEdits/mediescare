import { sql } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import type { WriteContext } from '../context';
import { dailyFigures } from '../reports/daily';
import { resolveRange, type ReportRange } from '../reports/util';
import { listSupplierBalances } from '../purchasing/ledger';
import { expensesByCategory } from './cashbook';

export interface NetProfit {
  range: { from: string; to: string };
  /** Revenue without tax, after returns (same figure as the Profit and loss report). */
  netRevenueMinor: number;
  costOfGoodsMinor: number;
  grossProfitMinor: number;
  expensesByCategory: { categoryId: string; name: string; amountMinor: number }[];
  expensesTotalMinor: number;
  netProfitMinor: number;
  /** Goods bought in the range less goods sent back. Stock, not an expense: it reaches profit only when sold. */
  purchasesMinor: number;
  /** What we owe suppliers today (suppliers we owe, advances not netted off). */
  supplierPayablesMinor: number;
}

/**
 * Basic profit and loss for a branch and date range, all integer paisa.
 *   gross profit = net revenue (ex tax, after returns) - batch cost of goods sold   (reuses dailyFigures)
 *   net profit   = gross profit - posted expenses dated in the range
 * Purchases are not subtracted: stock is an asset until it is sold. Payroll is not built, so salaries
 * count only when entered as expenses.
 */
export function netProfit(
  db: DbOrTx,
  ctx: WriteContext,
  filters: { from?: string; to?: string },
  prepared?: ReportRange,
): NetProfit {
  const range = prepared ?? resolveRange(db, ctx, filters, 30);
  const days = dailyFigures(db, ctx, range);
  const netRevenueMinor = days.reduce((s, d) => s + d.netRevenue, 0);
  const costOfGoodsMinor = days.reduce((s, d) => s + d.cost, 0);
  const byCategory = expensesByCategory(db, ctx, range.from, range.to);
  const expensesTotalMinor = byCategory.reduce((s, c) => s + c.amountMinor, 0);
  const grossProfitMinor = netRevenueMinor - costOfGoodsMinor;

  const bought = db.get<{ v: number }>(sql`
    SELECT COALESCE((SELECT SUM(total_minor) FROM grns
        WHERE branch_id = ${ctx.branchId} AND status = 'posted'
          AND created_at >= ${range.startIso} AND created_at < ${range.endIso}), 0)
      - COALESCE((SELECT SUM(total_minor) FROM purchase_returns
        WHERE branch_id = ${ctx.branchId}
          AND created_at >= ${range.startIso} AND created_at < ${range.endIso}), 0) AS v`);
  const supplierPayablesMinor = listSupplierBalances(db, ctx, { onlyOwing: true })
    .filter((s) => s.balanceMinor > 0)
    .reduce((s, r) => s + r.balanceMinor, 0);

  return {
    range: { from: range.from, to: range.to },
    netRevenueMinor,
    costOfGoodsMinor,
    grossProfitMinor,
    expensesByCategory: byCategory,
    expensesTotalMinor,
    netProfitMinor: grossProfitMinor - expensesTotalMinor,
    purchasesMinor: Number(bought?.v ?? 0),
    supplierPayablesMinor,
  };
}
