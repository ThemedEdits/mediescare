import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { branches, syncCols, tenants } from './pg';
import { batches, items, suppliers } from './pg-pharmacy';

const big = (name: string) => bigint(name, { mode: 'number' });

export const purchaseReturns = pgTable(
  'purchase_returns',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    grnId: text('grn_id'),
    reason: text('reason').notNull(),
    note: text('note'),
    creditNoteNo: text('credit_note_no'),
    totalMinor: big('total_minor').notNull(),
    status: text('status').notNull().default('posted'),
    createdBy: text('created_by'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('purchase_returns_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('purchase_returns_supplier_idx').on(t.supplierId, t.createdAt),
  ],
);

export const purchaseReturnLines = pgTable(
  'purchase_return_lines',
  {
    id: uuid('id').primaryKey(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => purchaseReturns.id),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id),
    qtyBase: big('qty_base').notNull(),
    costUnitMicro: big('cost_unit_micro').notNull(),
    lineTotalMinor: big('line_total_minor').notNull(),
  },
  (t) => [index('purchase_return_lines_return_idx').on(t.returnId)],
);

export const stockTakes = pgTable(
  'stock_takes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    title: text('title').notNull(),
    status: text('status').notNull().default('open'),
    note: text('note'),
    startedBy: text('started_by'),
    postedBy: text('posted_by'),
    postedAt: text('posted_at'),
    cancelReason: text('cancel_reason'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('stock_takes_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('stock_takes_branch_status_idx').on(t.branchId, t.status),
  ],
);

export const stockTakeLines = pgTable(
  'stock_take_lines',
  {
    id: uuid('id').primaryKey(),
    takeId: uuid('take_id')
      .notNull()
      .references(() => stockTakes.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id),
    systemQtyBase: big('system_qty_base').notNull(),
    countedQtyBase: big('counted_qty_base'),
    costUnitMicro: big('cost_unit_micro').notNull(),
    countedBy: text('counted_by'),
    countedAt: text('counted_at'),
  },
  (t) => [
    index('stock_take_lines_take_idx').on(t.takeId),
    uniqueIndex('stock_take_lines_take_batch_uq').on(t.takeId, t.batchId),
  ],
);
