/**
 * Phase 2 (SQLite): purchase orders and supplier payments. Must stay in parity with pg-purchasing.ts.
 * The supplier ledger is derived (opening balance + bills - payments), never stored as a number.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { branches, syncCols, tenants } from './sqlite';
import { items, paymentModes, suppliers, units } from './sqlite-pharmacy';

export const purchaseOrders = sqliteTable(
  'purchase_orders',
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
    /** draft | approved | partial | received | cancelled */
    status: text('status').notNull().default('draft'),
    expectedDate: text('expected_date'),
    note: text('note'),
    /** Estimated goods value from the ordered prices, in paisa. */
    subTotalMinor: integer('sub_total_minor').notNull().default(0),
    createdBy: text('created_by'),
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
    cancelReason: text('cancel_reason'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('purchase_orders_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('purchase_orders_branch_status_idx').on(t.branchId, t.status),
    index('purchase_orders_supplier_idx').on(t.supplierId),
  ],
);

export const poLines = sqliteTable(
  'po_lines',
  {
    id: text('id').primaryKey(),
    poId: text('po_id')
      .notNull()
      .references(() => purchaseOrders.id),
    lineNo: integer('line_no').notNull(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    qtyUnits: integer('qty_units').notNull(),
    /** Ordered quantity in the smallest unit. */
    orderedBase: integer('ordered_base').notNull(),
    /** Expected price of one ordered unit, micro-PKR. */
    unitPriceMicro: integer('unit_price_micro').notNull().default(0),
    /** Received so far in the smallest unit (paid + bonus), updated by goods receipts. */
    receivedBase: integer('received_base').notNull().default(0),
  },
  (t) => [index('po_lines_po_idx').on(t.poId), index('po_lines_item_idx').on(t.itemId)],
);

/** Money paid to a supplier. Posted documents are immutable: a wrong payment is fixed by a new entry. */
export const supplierPayments = sqliteTable(
  'supplier_payments',
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
    /** The bill this pays. Null = payment on account (advance or opening balance). */
    grnId: text('grn_id'),
    amountMinor: integer('amount_minor').notNull(),
    modeId: text('mode_id')
      .notNull()
      .references(() => paymentModes.id),
    reference: text('reference'),
    note: text('note'),
    paidAt: text('paid_at').notNull(),
    createdBy: text('created_by'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('supplier_payments_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('supplier_payments_supplier_idx').on(t.supplierId, t.paidAt),
    index('supplier_payments_grn_idx').on(t.grnId),
  ],
);
