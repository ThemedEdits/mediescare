/**
 * Appliers for requisitions and transfer notes pulled from the cloud (docs/transfers.md, "Sync").
 *
 * Every event carries the whole document (header and lines), so an event stands on its own and the
 * order of delivery does not matter: a state only ever moves forward, an older state is skipped.
 *
 * What a pulled event may do:
 * - It writes documents only. It never writes a stock movement and never writes the outbox. The
 *   shipping branch posted its own transfer_out, the receiving branch posts its own transfer_in when
 *   it receives, and each branch's ledger stays its own.
 * - A requisition created at a branch is applied at Head Office (and the approval comes back to the
 *   branch). A dispatched transfer is applied at the receiving branch as a document to receive, with
 *   every line needed to count the goods. A receipt is applied at the shipping branch.
 * - A draft or cancelled transfer is private to Head Office: the receiving branch ignores it.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../../client';
import {
  branches,
  items,
  stockRequisitionLines,
  stockRequisitions,
  stockTransferLines,
  stockTransfers,
} from '../../schema/sqlite-all';
import {
  APPLY_ORDER,
  DependencyMissing,
  getApplier,
  registerApplier,
  type ApplyDetail,
  type ApplyEnv,
  type EntityApplier,
} from './registry';

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const int = (v: unknown): number | null =>
  typeof v === 'number' && Number.isSafeInteger(v) ? v : null;

class Malformed extends Error {}
const need = <T>(value: T | null, what: string): T => {
  if (value === null) throw new Malformed(what);
  return value;
};

/** Each applier rejects a payload it cannot read by skipping it: a bad event must not block the feed. */
const guarded =
  (
    apply: (tx: DbOrTx, change: Parameters<EntityApplier>[1], env: ApplyEnv) => ApplyDetail,
  ): EntityApplier =>
  (tx, change, env) => {
    try {
      return apply(tx, change, env);
    } catch (error) {
      if (error instanceof Malformed) return { outcome: 'skipped' };
      throw error;
    }
  };

function requireBranches(tx: DbOrTx, ids: string[]): void {
  for (const id of ids)
    if (!tx.select({ id: branches.id }).from(branches).where(eq(branches.id, id)).get())
      throw new DependencyMissing('branches', id);
}

function requireItems(tx: DbOrTx, ids: string[]): void {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  const have = new Set(
    tx
      .select({ id: items.id })
      .from(items)
      .where(inArray(items.id, unique))
      .all()
      .map((r) => r.id),
  );
  for (const id of unique) if (!have.has(id)) throw new DependencyMissing('items', id);
}

// ------------------------------------------------------------------ requisitions

const REQ_PATH: Record<string, Record<string, string[]>> = {
  submitted: {
    approved: ['approved'],
    cancelled: ['cancelled'],
    fulfilled: ['approved', 'fulfilled'],
  },
  approved: { fulfilled: ['fulfilled'] },
};

function parseRequisition(payload: unknown) {
  if (!isObject(payload) || !Array.isArray(payload.lines)) throw new Malformed('requisition');
  const header = {
    id: need(str(payload.id), 'id'),
    tenantId: need(str(payload.tenantId), 'tenantId'),
    fromBranchId: need(str(payload.fromBranchId), 'fromBranchId'),
    toBranchId: need(str(payload.toBranchId), 'toBranchId'),
    docNo: need(str(payload.docNo), 'docNo'),
    status: need(str(payload.status), 'status'),
    neededBy: str(payload.neededBy),
    note: str(payload.note),
    createdBy: str(payload.createdBy),
    approvedBy: str(payload.approvedBy),
    approvedAt: str(payload.approvedAt),
    transferId: str(payload.transferId),
    cancelReason: str(payload.cancelReason),
    createdAt: need(str(payload.createdAt), 'createdAt'),
    updatedAt: need(str(payload.updatedAt), 'updatedAt'),
    hlc: need(str(payload.hlc), 'hlc'),
    version: need(int(payload.version), 'version'),
  };
  const lines = payload.lines.map((l: unknown) => {
    if (!isObject(l)) throw new Malformed('line');
    return {
      id: need(str(l.id), 'line id'),
      requisitionId: header.id,
      lineNo: need(int(l.lineNo), 'lineNo'),
      itemId: need(str(l.itemId), 'itemId'),
      qtyRequestedBase: need(int(l.qtyRequestedBase), 'qtyRequestedBase'),
      qtyApprovedBase: int(l.qtyApprovedBase),
    };
  });
  return { header, lines };
}

const applyRequisition = guarded((tx, change, env) => {
  const { header, lines } = parseRequisition(change.event.payload);
  if (header.tenantId !== env.tenantId) return { outcome: 'skipped' };
  if (header.fromBranchId !== env.branchId && header.toBranchId !== env.branchId)
    return { outcome: 'skipped' };

  const local = tx
    .select()
    .from(stockRequisitions)
    .where(eq(stockRequisitions.id, header.id))
    .get();

  if (!local) {
    requireBranches(tx, [header.fromBranchId, header.toBranchId]);
    requireItems(
      tx,
      lines.map((l) => l.itemId),
    );
    tx.insert(stockRequisitions).values(header).run();
    if (lines.length > 0) tx.insert(stockRequisitionLines).values(lines).run();
    return { outcome: 'applied', created: true };
  }

  const path = REQ_PATH[local.status]?.[header.status];
  if (!path) return { outcome: 'skipped' }; // same or older state, or a lost race (first state wins)

  // Granted quantities first: lines can only change while the requisition is still submitted.
  if (local.status === 'submitted') {
    for (const l of lines)
      if (l.qtyApprovedBase !== null)
        tx.update(stockRequisitionLines)
          .set({ qtyApprovedBase: l.qtyApprovedBase })
          .where(eq(stockRequisitionLines.id, l.id))
          .run();
  }
  for (const step of path) {
    tx.update(stockRequisitions)
      .set(
        step === header.status
          ? {
              status: step,
              approvedBy: header.approvedBy,
              approvedAt: header.approvedAt,
              transferId: header.transferId,
              cancelReason: header.cancelReason,
              version: header.version,
              updatedAt: header.updatedAt,
              hlc: header.hlc,
            }
          : { status: step },
      )
      .where(eq(stockRequisitions.id, header.id))
      .run();
  }
  return {
    outcome: 'applied',
    oldValue: { status: local.status },
    newValue: { status: header.status, docNo: header.docNo },
  };
});

// ------------------------------------------------------------------ transfers

function parseTransfer(payload: unknown) {
  if (!isObject(payload) || !Array.isArray(payload.lines)) throw new Malformed('transfer');
  const header = {
    id: need(str(payload.id), 'id'),
    tenantId: need(str(payload.tenantId), 'tenantId'),
    fromBranchId: need(str(payload.fromBranchId), 'fromBranchId'),
    toBranchId: need(str(payload.toBranchId), 'toBranchId'),
    docNo: need(str(payload.docNo), 'docNo'),
    requisitionId: str(payload.requisitionId),
    status: need(str(payload.status), 'status'),
    note: str(payload.note),
    createdBy: str(payload.createdBy),
    dispatchedBy: str(payload.dispatchedBy),
    dispatchedAt: str(payload.dispatchedAt),
    receivedBy: str(payload.receivedBy),
    receivedAt: str(payload.receivedAt),
    receiveNote: str(payload.receiveNote),
    cancelReason: str(payload.cancelReason),
    dispatchedCostMinor: need(int(payload.dispatchedCostMinor), 'dispatchedCostMinor'),
    receivedCostMinor: need(int(payload.receivedCostMinor), 'receivedCostMinor'),
    damagedCostMinor: need(int(payload.damagedCostMinor), 'damagedCostMinor'),
    shortCostMinor: need(int(payload.shortCostMinor), 'shortCostMinor'),
    createdAt: need(str(payload.createdAt), 'createdAt'),
    updatedAt: need(str(payload.updatedAt), 'updatedAt'),
    hlc: need(str(payload.hlc), 'hlc'),
    version: need(int(payload.version), 'version'),
  };
  const lines = payload.lines.map((l: unknown) => {
    if (!isObject(l)) throw new Malformed('line');
    return {
      id: need(str(l.id), 'line id'),
      transferId: header.id,
      lineNo: need(int(l.lineNo), 'lineNo'),
      itemId: need(str(l.itemId), 'itemId'),
      sourceBatchId: need(str(l.sourceBatchId), 'sourceBatchId'),
      batchNo: need(str(l.batchNo), 'batchNo'),
      mfgDate: str(l.mfgDate),
      expiryDate: need(str(l.expiryDate), 'expiryDate'),
      mrpUnitMicro: need(int(l.mrpUnitMicro), 'mrpUnitMicro'),
      costUnitMicro: need(int(l.costUnitMicro), 'costUnitMicro'),
      qtyDispatched: need(int(l.qtyDispatched), 'qtyDispatched'),
      qtyReceived: need(int(l.qtyReceived), 'qtyReceived'),
      qtyDamaged: need(int(l.qtyDamaged), 'qtyDamaged'),
      qtyShort: need(int(l.qtyShort), 'qtyShort'),
      receivedBatchId: str(l.receivedBatchId),
    };
  });
  return { header, lines };
}

const applyTransfer = guarded((tx, change, env) => {
  const { header, lines } = parseTransfer(change.event.payload);
  if (header.tenantId !== env.tenantId) return { outcome: 'skipped' };
  const isDestination = header.toBranchId === env.branchId;
  const isSource = header.fromBranchId === env.branchId;
  if (isDestination === isSource) return { outcome: 'skipped' }; // not ours, or a transfer to itself

  const local = tx.select().from(stockTransfers).where(eq(stockTransfers.id, header.id)).get();

  if (isDestination) {
    // Only a dispatched transfer is a document to receive. Drafts and cancelled notes stay at Head Office,
    // and this branch's own receipt is never applied back onto itself: its ledger rows are its own.
    if (header.status !== 'dispatched' || local) return { outcome: 'skipped' };
    requireBranches(tx, [header.fromBranchId, header.toBranchId]);
    requireItems(
      tx,
      lines.map((l) => l.itemId),
    );
    tx.insert(stockTransfers).values(header).run();
    if (lines.length > 0) tx.insert(stockTransferLines).values(lines).run();
    return { outcome: 'applied', created: true };
  }

  // Shipping branch: the only thing that comes back is the receipt.
  if (header.status !== 'received') return { outcome: 'skipped' };
  if (!local) {
    // This branch has no record of shipping it (a rebuilt database): keep the receipt as a document copy.
    requireBranches(tx, [header.fromBranchId, header.toBranchId]);
    requireItems(
      tx,
      lines.map((l) => l.itemId),
    );
    tx.insert(stockTransfers).values(header).run();
    if (lines.length > 0) tx.insert(stockTransferLines).values(lines).run();
    return { outcome: 'applied', created: true };
  }
  if (local.status !== 'dispatched') return { outcome: 'skipped' }; // already received (duplicate) or not shipped

  for (const l of lines)
    tx.update(stockTransferLines)
      .set({
        qtyReceived: l.qtyReceived,
        qtyDamaged: l.qtyDamaged,
        qtyShort: l.qtyShort,
        receivedBatchId: l.receivedBatchId,
      })
      .where(and(eq(stockTransferLines.id, l.id), eq(stockTransferLines.transferId, header.id)))
      .run();
  tx.update(stockTransfers)
    .set({
      status: 'received',
      receivedBy: header.receivedBy,
      receivedAt: header.receivedAt,
      receiveNote: header.receiveNote,
      receivedCostMinor: header.receivedCostMinor,
      damagedCostMinor: header.damagedCostMinor,
      shortCostMinor: header.shortCostMinor,
      version: header.version,
      updatedAt: header.updatedAt,
      hlc: header.hlc,
    })
    .where(eq(stockTransfers.id, header.id))
    .run();
  return {
    outcome: 'applied',
    oldValue: { status: 'dispatched' },
    newValue: {
      status: 'received',
      docNo: header.docNo,
      receivedCostMinor: header.receivedCostMinor,
      damagedCostMinor: header.damagedCostMinor,
      shortCostMinor: header.shortCostMinor,
    },
  };
});

/** Registers both appliers once. Safe to call again. */
export function registerTransferAppliers(): void {
  if (!getApplier('stock_requisitions'))
    registerApplier('stock_requisitions', applyRequisition, { order: APPLY_ORDER.documents });
  if (!getApplier('stock_transfers'))
    registerApplier('stock_transfers', applyTransfer, { order: APPLY_ORDER.documents });
}

registerTransferAppliers();
