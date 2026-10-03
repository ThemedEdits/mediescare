import { cashFlow } from '../accounts/cashbook';
import { listExpenses } from '../accounts/expenses';
import { netProfit } from '../accounts/profit';
import type { ReportRow, ReportRunner, Sensitivity } from './types';
import { clampLimit, resolveRange } from './util';

const DEFAULT_ROWS = 5_000;

export const expensesReport: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters, 30);
  const cap = clampLimit(filters.limit, DEFAULT_ROWS);
  const list = listExpenses(db, ctx, { from: range.from, to: range.to, pageSize: cap });
  const rows: ReportRow[] = list.rows.map((r) => ({
    date: r.expenseDate,
    docNo: r.docNo,
    category: r.categoryName,
    payee: r.payee,
    mode: r.modeName,
    reference: r.reference,
    amount: r.amountMinor,
    status: r.status === 'void' ? 'Void' : 'Posted',
    note: r.status === 'void' ? r.voidReason : r.note,
  }));
  const truncated = list.total > rows.length;
  return {
    id: 'expenses',
    title: 'Expenses',
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'docNo', label: 'Voucher', type: 'text' },
      { key: 'category', label: 'Category', type: 'text' },
      { key: 'payee', label: 'Payee', type: 'text' },
      { key: 'mode', label: 'Paid by', type: 'text' },
      { key: 'reference', label: 'Reference', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money', align: 'end' },
      { key: 'status', label: 'Status', type: 'text' },
      { key: 'note', label: 'Note', type: 'text' },
    ],
    rows,
    totals: { amount: list.postedTotalMinor },
    kpis: [{ label: 'Total expenses', value: list.postedTotalMinor, type: 'money' }],
    truncated,
    note: 'Totals count posted expenses only. Void expenses are listed with their reason in the note column and are not added up.',
  };
};

export const cashFlowReport: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters, 30);
  const cf = cashFlow(db, ctx, filters, range);
  const rows: ReportRow[] = cf.daily.map((d) => ({
    date: d.date,
    cashIn: d.inMinor,
    cashOut: d.outMinor,
    net: d.netMinor,
    closing: d.closingMinor,
  }));
  return {
    id: 'cash-flow',
    title: 'Cash flow',
    columns: [
      { key: 'date', label: 'Date', type: 'date' },
      { key: 'cashIn', label: 'Cash in', type: 'money', align: 'end' },
      { key: 'cashOut', label: 'Cash out', type: 'money', align: 'end' },
      { key: 'net', label: 'Net', type: 'money', align: 'end' },
      { key: 'closing', label: 'Closing cash', type: 'money', align: 'end' },
    ],
    rows,
    totals: {
      cashIn: cf.cashIn.totalMinor,
      cashOut: cf.cashOut.totalMinor,
      net: cf.cashIn.totalMinor - cf.cashOut.totalMinor,
    },
    kpis: [
      { label: 'Opening cash', value: cf.openingCashMinor, type: 'money' },
      { label: 'Cash in', value: cf.cashIn.totalMinor, type: 'money' },
      { label: 'Cash out', value: cf.cashOut.totalMinor, type: 'money' },
      { label: 'Closing cash', value: cf.closingCashMinor, type: 'money' },
    ],
    note: 'Cash only. In = cash taken on posted invoices. Out = cash refunds, cash expenses and cash supplier payments. Shift floats are moves between safe and till, not income. Bank and wallet movements are on the Accounts screen.',
  };
};

export const netProfitReport: ReportRunner = (db, ctx, filters) => {
  const range = resolveRange(db, ctx, filters, 30);
  const p = netProfit(db, ctx, filters, range);
  const rows: ReportRow[] = [];
  const sens: (Sensitivity | null)[] = [];
  const add = (line: string, amount: number, s: Sensitivity | null = null) => {
    rows.push({ line, amount });
    sens.push(s);
  };
  add('Net revenue', p.netRevenueMinor);
  add('Cost of goods sold', p.costOfGoodsMinor, 'cost');
  add('Gross profit', p.grossProfitMinor, 'profit');
  for (const c of p.expensesByCategory) add(c.name, c.amountMinor);
  add('Total expenses', p.expensesTotalMinor);
  add('Net profit', p.netProfitMinor, 'profit');
  add('Purchases of stock (not an expense)', p.purchasesMinor);
  add('Owed to suppliers today', p.supplierPayablesMinor);
  return {
    id: 'net-profit',
    title: 'Net profit',
    columns: [
      { key: 'line', label: 'Line', type: 'text' },
      { key: 'amount', label: 'Amount', type: 'money', align: 'end' },
    ],
    rows,
    rowSensitivity: sens,
    kpis: [
      { label: 'Net revenue', value: p.netRevenueMinor, type: 'money' },
      { label: 'Gross profit', value: p.grossProfitMinor, type: 'money', sensitivity: 'profit' },
      { label: 'Total expenses', value: p.expensesTotalMinor, type: 'money' },
      { label: 'Net profit', value: p.netProfitMinor, type: 'money', sensitivity: 'profit' },
    ],
    note: 'Net profit = revenue without tax (after returns) - cost of goods sold - expenses. Buying stock is not an expense: it becomes cost when sold. Salaries appear only when entered as expenses.',
  };
};
