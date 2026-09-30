import { bigint, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { branches, syncCols, tenants } from './pg';
import { items } from './pg-pharmacy';

const big = (name: string) => bigint(name, { mode: 'number' });

export const stockRequisitions = pgTable(
  'stock_requisitions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    fromBranchId: uuid('from_branch_id')
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid('to_branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    status: text('status').notNull().default('submitted'),
    neededBy: text('needed_by'),
    note: text('note'),
    createdBy: text('created_by'),
    approvedBy: text('approved_by'),
    approvedAt: text('approved_at'),
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

export const stockRequisitionLines = pgTable(
  'stock_requisition_lines',
  {
    id: uuid('id').primaryKey(),
    requisitionId: uuid('requisition_id')
      .notNull()
      .references(() => stockRequisitions.id),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    qtyRequestedBase: big('qty_requested_base').notNull(),
    qtyApprovedBase: big('qty_approved_base'),
  },
  (t) => [
    index('stock_requisition_lines_req_idx').on(t.requisitionId),
    uniqueIndex('stock_requisition_lines_req_line_uq').on(t.requisitionId, t.lineNo),
  ],
);

export const stockTransfers = pgTable(
  'stock_transfers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    fromBranchId: uuid('from_branch_id')
      .notNull()
      .references(() => branches.id),
    toBranchId: uuid('to_branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    requisitionId: text('requisition_id'),
    status: text('status').notNull().default('draft'),
    note: text('note'),
    createdBy: text('created_by'),
    dispatchedBy: text('dispatched_by'),
    dispatchedAt: text('dispatched_at'),
    receivedBy: text('received_by'),
    receivedAt: text('received_at'),
    receiveNote: text('receive_note'),
    cancelReason: text('cancel_reason'),
    dispatchedCostMinor: big('dispatched_cost_minor').notNull().default(0),
    receivedCostMinor: big('received_cost_minor').notNull().default(0),
    damagedCostMinor: big('damaged_cost_minor').notNull().default(0),
    shortCostMinor: big('short_cost_minor').notNull().default(0),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('stock_transfers_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('stock_transfers_from_status_idx').on(t.fromBranchId, t.status),
    index('stock_transfers_to_status_idx').on(t.toBranchId, t.status),
    index('stock_transfers_requisition_idx').on(t.requisitionId),
  ],
);

export const stockTransferLines = pgTable(
  'stock_transfer_lines',
  {
    id: uuid('id').primaryKey(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => stockTransfers.id),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    sourceBatchId: text('source_batch_id').notNull(),
    batchNo: text('batch_no').notNull(),
    mfgDate: text('mfg_date'),
    expiryDate: text('expiry_date').notNull(),
    mrpUnitMicro: big('mrp_unit_micro').notNull().default(0),
    costUnitMicro: big('cost_unit_micro').notNull(),
    qtyDispatched: big('qty_dispatched').notNull(),
    qtyReceived: big('qty_received').notNull().default(0),
    qtyDamaged: big('qty_damaged').notNull().default(0),
    qtyShort: big('qty_short').notNull().default(0),
    receivedBatchId: text('received_batch_id'),
  },
  (t) => [
    index('stock_transfer_lines_transfer_idx').on(t.transferId),
    uniqueIndex('stock_transfer_lines_transfer_line_uq').on(t.transferId, t.lineNo),
    index('stock_transfer_lines_item_idx').on(t.itemId),
  ],
);
