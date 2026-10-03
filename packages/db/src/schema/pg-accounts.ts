import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { branches, syncCols, tenants } from './pg';
import { paymentModes } from './pg-pharmacy';

const big = (name: string) => bigint(name, { mode: 'number' });

export const expenseCategories = pgTable(
  'expense_categories',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('operating'),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...syncCols(),
  },
  (t) => [uniqueIndex('expense_categories_tenant_name_uq').on(t.tenantId, t.name)],
);

export const expenses = pgTable(
  'expenses',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    expenseDate: text('expense_date').notNull(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => expenseCategories.id),
    amountMinor: big('amount_minor').notNull(),
    modeId: uuid('mode_id')
      .notNull()
      .references(() => paymentModes.id),
    payee: text('payee'),
    reference: text('reference'),
    note: text('note'),
    shiftId: text('shift_id'),
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

export const cashAdjustments = pgTable(
  'cash_adjustments',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    entryDate: text('entry_date').notNull(),
    kind: text('kind').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'number' }).notNull(),
    modeId: uuid('mode_id')
      .notNull()
      .references(() => paymentModes.id),
    note: text('note').notNull(),
    status: text('status').notNull().default('posted'),
    voidReason: text('void_reason'),
    voidedBy: text('voided_by'),
    voidedAt: text('voided_at'),
    createdBy: text('created_by'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('cash_adjustments_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('cash_adjustments_branch_date_idx').on(t.branchId, t.entryDate),
  ],
);
