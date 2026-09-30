import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { branches, syncCols, tenants } from './pg';
import { items, paymentModes, suppliers, units } from './pg-pharmacy';

const big = (name: string) => bigint(name, { mode: 'number' });

export const purchaseOrders = pgTable(
  'purchase_orders',
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
    status: text('status').notNull().default('draft'),
    expectedDate: text('expected_date'),
    note: text('note'),
    subTotalMinor: big('sub_total_minor').notNull().default(0),
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

export const poLines = pgTable(
  'po_lines',
  {
    id: uuid('id').primaryKey(),
    poId: uuid('po_id')
      .notNull()
      .references(() => purchaseOrders.id),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    qtyUnits: big('qty_units').notNull(),
    orderedBase: big('ordered_base').notNull(),
    unitPriceMicro: big('unit_price_micro').notNull().default(0),
    receivedBase: big('received_base').notNull().default(0),
  },
  (t) => [index('po_lines_po_idx').on(t.poId), index('po_lines_item_idx').on(t.itemId)],
);

export const supplierPayments = pgTable(
  'supplier_payments',
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
    amountMinor: big('amount_minor').notNull(),
    modeId: uuid('mode_id')
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
