import { dailyFigures } from './daily';
import type { ReportRow, ReportRunner } from './types';
import { num, percent, resolveRange, sumRows } from './util';

export const profitLoss: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters, 30);
  const rows: ReportRow[] = dailyFigures(db, ctx, range).map((d) => ({
    date: d.date,
    netRevenue: d.netRevenue,
    cost: d.cost,
    profit: d.profit,
    marginPct: percent(d.profit, d.netRevenue),
  }));
  const totals = sumRows(rows, ['netRevenue', 'cost', 'profit']);
  totals.marginPct = percent(num(totals.profit), num(totals.netRevenue));
  return {
    id: 'profit-loss',
    title: 'Profit and loss',
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'netRevenue', label: 'Net revenue', type: 'money', align: 'end' },
      { key: 'cost', label: 'Cost of goods', type: 'money', align: 'end', sensitivity: 'cost' },
      { key: 'profit', label: 'Gross profit', type: 'money', align: 'end', sensitivity: 'profit' },
      { key: 'marginPct', label: 'Margin %', type: 'percent', align: 'end', sensitivity: 'profit' },
    ],
    rows,
    totals,
    kpis: [
      { label: 'Net revenue', value: num(totals.netRevenue), type: 'money' },
      { label: 'Gross profit', value: num(totals.profit), type: 'money', sensitivity: 'profit' },
      { label: 'Margin', value: num(totals.marginPct), type: 'percent', sensitivity: 'profit' },
    ],
    note: 'Gross profit = revenue without tax, minus the batch cost of what was sold. Returns reduce revenue and, for goods put back on the shelf, cost. Expenses are not included.',
  };
};
