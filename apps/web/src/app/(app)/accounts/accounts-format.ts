import { tryMinor } from '../../../lib/format';

export const EXPENSE_KINDS = ['operating', 'payroll', 'rent', 'utilities', 'other'] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

export interface ExpenseFilterState {
  from: string;
  to: string;
  categoryId: string;
  modeId: string;
  status: '' | 'posted' | 'void';
  page: number;
}

/** Query string for /api/expenses: empty filters are left out. */
export function expenseQuery(f: ExpenseFilterState, pageSize: number): string {
  const p = new URLSearchParams({ from: f.from, to: f.to, pageSize: String(pageSize) });
  if (f.categoryId) p.set('categoryId', f.categoryId);
  if (f.modeId) p.set('modeId', f.modeId);
  if (f.status) p.set('status', f.status);
  if (f.page > 1) p.set('page', String(f.page));
  return p.toString();
}

/** Paisa from what was typed, or null when it is empty, not money, or not above zero. */
export function parseExpenseAmount(text: string): number | null {
  const minor = tryMinor(text);
  return minor !== null && minor > 0 ? minor : null;
}

/** Number of pages for a list, never below one. */
export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}
