/**
 * Purchase returns and stock takes (SQLite). Must stay in parity with pg-inventory.ts.
 * Both post append-only stock movements; the documents themselves are immutable once posted.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { branches, syncCols, tenants } from './sqlite';
import { batches, items, suppliers } from './sqlite-pharmacy';

/** Goods sent back to a supplier. Reduces stock and what we owe the supplier (a credit on the ledger). */
export const purchaseReturns = sqliteTable(
  'purchase_returns',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    /** The bill the goods came in on, when known (reference only). */
    grnId: text('grn_id'),
    /** damaged | expired | near_expiry | wrong_item | overstock | recall | other */
    reason: text('reason').notNull(),
    note: text('note'),
    /** The supplier's credit note number, when they have issued one. */
    creditNoteNo: text('credit_note_no'),
    /** Value of the goods at batch cost, in paisa. This is the credit given by the supplier. */
    totalMinor: integer('total_minor').notNull(),
    status: text('status').notNull().default('posted'),
    createdBy: text('created_by'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('purchase_returns_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('purchase_returns_supplier_idx').on(t.supplierId, t.createdAt),
  ],
);

export const purchaseReturnLines = sqliteTable(
  'purchase_return_lines',
  {
    id: text('id').primaryKey(),
    returnId: text('return_id')
      .notNull()
      .references(() => purchaseReturns.id),
    lineNo: integer('line_no').notNull(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    /** Returned quantity in the smallest unit. */
    qtyBase: integer('qty_base').notNull(),
    costUnitMicro: integer('cost_unit_micro').notNull(),
    lineTotalMinor: integer('line_total_minor').notNull(),
  },
  (t) => [index('purchase_return_lines_return_idx').on(t.returnId)],
);

/**
 * A physical count. Opening a count freezes what the system says per batch; counting fills in what
 * was found; posting writes the differences to the ledger as adjustments (counted minus frozen), so
 * sales made during the count are not undone.
 */
export const stockTakes = sqliteTable(
  'stock_takes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    /** Free text describing what is being counted (a rack, a category, "everything"). */
    title: text('title').notNull(),
    /** open | posted | cancelled */
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

export const stockTakeLines = sqliteTable(
  'stock_take_lines',
  {
    id: text('id').primaryKey(),
    takeId: text('take_id')
      .notNull()
      .references(() => stockTakes.id),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    /** On hand when the count was opened, smallest unit. */
    systemQtyBase: integer('system_qty_base').notNull(),
    /** What was counted, smallest unit. Null until counted. */
    countedQtyBase: integer('counted_qty_base'),
    costUnitMicro: integer('cost_unit_micro').notNull(),
    countedBy: text('counted_by'),
    countedAt: text('counted_at'),
  },
  (t) => [
    index('stock_take_lines_take_idx').on(t.takeId),
    uniqueIndex('stock_take_lines_take_batch_uq').on(t.takeId, t.batchId),
  ],
);
