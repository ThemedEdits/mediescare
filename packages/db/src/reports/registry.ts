import type { Db } from '../client';
import type { WriteContext } from '../context';
import { DomainError } from '../errors';
import { cashFlowReport, expensesReport, netProfitReport } from './accounts';
import { missedSales, narcoticRegister } from './compliance';
import { profitLoss } from './profit';
import {
  discounts,
  salesByCashier,
  salesByItem,
  salesByPaymentMode,
  salesDaily,
  salesInvoices,
} from './sales';
import { expiry, lowStock, stockCurrent, stockValuation } from './stock';
import type {
  FilterKey,
  ReportDefinition,
  ReportFilters,
  ReportGroup,
  ReportResult,
  ReportRunner,
} from './types';

function def(
  id: string,
  title: string,
  group: ReportGroup,
  area: 'sales' | 'stock' | 'profit' | 'expiry' | 'narcotic' | 'financial',
  filters: FilterKey[],
  run: ReportRunner,
): ReportDefinition {
  return {
    id,
    title,
    group,
    requiredPermission: `reports.${area}.view`,
    exportPermission: `reports.${area}.export`,
    filters,
    run,
  };
}

export const REPORTS: readonly ReportDefinition[] = [
  def('sales-daily', 'Sales by day', 'sales', 'sales', ['range'], salesDaily),
  def('sales-invoices', 'Invoices', 'sales', 'sales', ['range', 'q', 'limit'], salesInvoices),
  def('sales-by-item', 'Sales by item', 'sales', 'sales', ['range', 'q', 'limit'], salesByItem),
  def('sales-by-cashier', 'Sales by cashier', 'sales', 'sales', ['range'], salesByCashier),
  def(
    'sales-by-payment-mode',
    'Sales by payment mode',
    'sales',
    'sales',
    ['range'],
    salesByPaymentMode,
  ),
  def('discounts', 'Discounts given', 'sales', 'sales', ['range', 'q', 'limit'], discounts),
  def('stock-current', 'Current stock', 'stock', 'stock', ['q', 'limit'], stockCurrent),
  def('stock-valuation', 'Stock valuation', 'stock', 'stock', [], stockValuation),
  def('low-stock', 'Low stock', 'stock', 'stock', ['range', 'q', 'limit'], lowStock),
  def('expiry', 'Expiry', 'expiry', 'expiry', ['q', 'bucket', 'limit'], expiry),
  def('profit-loss', 'Profit and loss', 'profit', 'profit', ['range'], profitLoss),
  def('net-profit', 'Net profit', 'profit', 'profit', ['range'], netProfitReport),
  def('expenses', 'Expenses', 'finance', 'financial', ['range', 'limit'], expensesReport),
  def('cash-flow', 'Cash flow', 'finance', 'financial', ['range'], cashFlowReport),
  def(
    'narcotic-register',
    'Narcotic register',
    'compliance',
    'narcotic',
    ['range', 'q', 'limit'],
    narcoticRegister,
  ),
  def('missed-sales', 'Missed sales', 'compliance', 'stock', ['range', 'q', 'limit'], missedSales),
];

export function getReport(id: string): ReportDefinition | undefined {
  return REPORTS.find((r) => r.id === id);
}

/** Run a report for the branch in `ctx`. Column rights are applied by the caller (see applyColumnRights). */
export function runReport(
  db: Db,
  ctx: WriteContext,
  id: string,
  filters: ReportFilters,
): ReportResult {
  const report = getReport(id);
  if (!report) throw new DomainError('NOT_FOUND', 'Report not found');
  return report.run(db, ctx, filters);
}
