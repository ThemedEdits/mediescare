/**
 * Head Office to branch stock transfers (SQLite). Must stay in parity with pg-transfers.ts.
 *
 * A requisition is the branch's request. A transfer note is Head Office's shipment, batch by batch, at
 * batch cost. Goods between dispatch and receipt are "in transit": they exist only on the document,
 * never in a branch's stock ledger. Both documents are copied to the other branch through sync, so the
 * branch columns say which branch asks (from) and which branch serves (to) on a requisition, and which
 * branch ships (from) and which receives (to) on a transfer.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { branches, syncCols, tenants } from './sqlite';
import { items } from './sqlite-pharmacy';

export const stockRequisitions = sqliteTable(
  'stock_requisitions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The branch that asks for stock. */
    fromBranchId: text('from_branch_id')
      .notNull()
      .references(() => branches.id),
    /** The branch that serves the request (Head Office). */
    toBranchId: text('to_branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    /** submitted | approved | fulfilled | cancelled */
    status: text('status').notNull().default('submitted'),
    neededBy: text('needed_by'),
    note: text('note'),
    createdBy: text('created_by'),
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
    /** The transfer note that shipped this requisition. */
    transferId: text('transfer_id'),
    cancelReason: text('cancel_reason'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('stock_requisitions_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('stock_requisitions_from_status_idx').on(t.fromBranchId, t.status),
    index('stock_requisitions_to_status_idx').on(t.toBranchId, t.status),
  ],
);

export const stockRequisitionLines = sqliteTable(
  'stock_requisition_lines',
  {
    id: text('id').primaryKey(),
    requisitionId: text('requisition_id')
      .notNull()
      .references(() => stockRequisitions.id),
    lineNo: integer('line_no').notNull(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    /** Asked for, smallest unit. */
    qtyRequestedBase: integer('qty_requested_base').notNull(),
    /** Granted by Head Office, smallest unit. Null until approved. */
    qtyApprovedBase: integer('qty_approved_base'),
  },
  (t) => [
    index('stock_requisition_lines_req_idx').on(t.requisitionId),
    uniqueIndex('stock_requisition_lines_req_line_uq').on(t.requisitionId, t.lineNo),
  ],
);

export const stockTransfers = sqliteTable(
  'stock_transfers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The shipping branch (Head Office). */
    fromBranchId: text('from_branch_id')
      .notNull()
      .references(() => branches.id),
    /** The receiving branch. */
    toBranchId: text('to_branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    requisitionId: text('requisition_id'),
    /** draft | dispatched | received | cancelled */
    status: text('status').notNull().default('draft'),
    note: text('note'),
    createdBy: text('created_by'),
    dispatchedBy: text('dispatched_by'),
    dispatchedAt: text('dispatched_at'),
    receivedBy: text('received_by'),
    receivedAt: text('received_at'),
    receiveNote: text('receive_note'),
    cancelReason: text('cancel_reason'),
    /** Value at batch cost, paisa. Dispatch value is set when the goods leave; the rest at receipt. */
    dispatchedCostMinor: integer('dispatched_cost_minor').notNull().default(0),
    receivedCostMinor: integer('received_cost_minor').notNull().default(0),
    damagedCostMinor: integer('damaged_cost_minor').notNull().default(0),
    shortCostMinor: integer('short_cost_minor').notNull().default(0),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('stock_transfers_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('stock_transfers_from_status_idx').on(t.fromBranchId, t.status),
    index('stock_transfers_to_status_idx').on(t.toBranchId, t.status),
    index('stock_transfers_requisition_idx').on(t.requisitionId),
  ],
);

export const stockTransferLines = sqliteTable(
  'stock_transfer_lines',
  {
    id: text('id').primaryKey(),
    transferId: text('transfer_id')
      .notNull()
      .references(() => stockTransfers.id),
    lineNo: integer('line_no').notNull(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    /** The batch at the shipping branch. A plain id: the receiving branch has its own batch rows. */
    sourceBatchId: text('source_batch_id').notNull(),
    batchNo: text('batch_no').notNull(),
    mfgDate: text('mfg_date'),
    expiryDate: text('expiry_date').notNull(),
    mrpUnitMicro: integer('mrp_unit_micro').notNull().default(0),
    costUnitMicro: integer('cost_unit_micro').notNull(),
    qtyDispatched: integer('qty_dispatched').notNull(),
    qtyReceived: integer('qty_received').notNull().default(0),
    qtyDamaged: integer('qty_damaged').notNull().default(0),
    qtyShort: integer('qty_short').notNull().default(0),
    /** The receiving branch's batch that got the good units, set at receipt. */
    receivedBatchId: text('received_batch_id'),
  },
  (t) => [
    index('stock_transfer_lines_transfer_idx').on(t.transferId),
    uniqueIndex('stock_transfer_lines_transfer_line_uq').on(t.transferId, t.lineNo),
    index('stock_transfer_lines_item_idx').on(t.itemId),
  ],
);
