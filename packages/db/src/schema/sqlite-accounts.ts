/**
 * Basic accounts (SQLite): expense categories and expenses. Must stay in parity with pg-accounts.ts.
 * There is no ledger of accounts: the cash book and the profit report are derived from sales,
 * returns, supplier payments and these expenses.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { branches, syncCols, tenants } from './sqlite';
import { paymentModes } from './sqlite-pharmacy';

export const expenseCategories = sqliteTable(
  'expense_categories',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    /** operating | payroll | rent | utilities | other. A label for grouping; every kind counts against profit. */
    kind: text('kind').notNull().default('operating'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...syncCols(),
  },
  (t) => [uniqueIndex('expense_categories_tenant_name_uq').on(t.tenantId, t.name)],
);

/**
 * Money spent that is not stock: rent, salaries, electricity, repairs. Posted expenses are immutable
 * (triggers); a wrong one is voided with a reason and stays in the reports as void.
 */
export const expenses = sqliteTable(
  'expenses',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    /** Branch-local calendar date the expense belongs to, 'YYYY-MM-DD'. */
    expenseDate: text('expense_date').notNull(),
    categoryId: text('category_id')
      .notNull()
      .references(() => expenseCategories.id),
    amountMinor: integer('amount_minor').notNull(),
    modeId: text('mode_id')
      .notNull()
      .references(() => paymentModes.id),
    payee: text('payee'),
    reference: text('reference'),
    note: text('note'),
    /** Set when the cash was taken from the till of this open shift: it then lowers that shift's expected cash. */
    shiftId: text('shift_id'),
    /** posted | void */
    status: text('status').notNull().default('posted'),
    voidReason: text('void_reason'),
    voidedBy: text('voided_by'),
    voidedAt: text('voided_at'),
    createdBy: text('created_by'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('expenses_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('expenses_branch_date_idx').on(t.branchId, t.expenseDate),
    index('expenses_category_idx').on(t.categoryId),
    index('expenses_shift_idx').on(t.shiftId),
  ],
);
