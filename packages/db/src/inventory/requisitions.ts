import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { nextDocNo } from '../pharmacy/common';
import { items, stockRequisitionLines, stockRequisitions } from '../schema/sqlite-all';
import {
  branchMap,
  clampPage,
  headOfficeBranch,
  itemInfoMap,
  ownBranch,
  positiveInt,
  type ItemInfo,
} from './common';

export type RequisitionStatus = 'submitted' | 'approved' | 'fulfilled' | 'cancelled';

export type RequisitionRow = typeof stockRequisitions.$inferSelect;
export type RequisitionLineRow = typeof stockRequisitionLines.$inferSelect;

/** The whole document as it travels through sync: header and lines. */
export interface RequisitionAggregate extends RequisitionRow {
  lines: RequisitionLineRow[];
}

export function requisitionAggregate(tx: DbOrTx, id: string): RequisitionAggregate {
  const header = tx.select().from(stockRequisitions).where(eq(stockRequisitions.id, id)).get();
  if (!header) throw new DomainError('NOT_FOUND', 'Requisition not found');
  const lines = tx
    .select()
    .from(stockRequisitionLines)
    .where(eq(stockRequisitionLines.requisitionId, id))
    .orderBy(stockRequisitionLines.lineNo)
    .all();
  return { ...header, lines };
}

function loadForBranch(tx: DbOrTx, ctx: WriteContext, id: string): RequisitionRow {
  const row = tx
    .select()
    .from(stockRequisitions)
    .where(and(eq(stockRequisitions.id, id), eq(stockRequisitions.tenantId, ctx.tenantId)))
    .get();
  if (!row || (row.fromBranchId !== ctx.branchId && row.toBranchId !== ctx.branchId))
    throw new DomainError('NOT_FOUND', 'Requisition not found');
  return row;
}

export interface RequisitionInput {
  neededBy?: string | null;
  note?: string;
  lines: { itemId: string; qtyBase: number }[];
}

/** A branch asks Head Office for stock. Head Office itself has no one to ask. */
export function createRequisition(
  db: Db,
  ctx: WriteContext,
  input: RequisitionInput,
): { id: string; docNo: string } {
  if (input.lines.length === 0) throw new DomainError('INVALID', 'Add at least one item');
  const ids = input.lines.map((l) => l.itemId);
  if (new Set(ids).size !== ids.length)
    throw new DomainError('INVALID', 'Each item can appear only once on a requisition');
  if (input.neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(input.neededBy))
    throw new DomainError('INVALID', 'Needed-by date is not valid');

  return db.transaction((tx) => {
    const me = ownBranch(tx, ctx);
    if (me.isHeadOffice)
      throw new DomainError(
        'INVALID',
        'Head Office does not send requisitions. Create a transfer note instead',
      );
    const ho = headOfficeBranch(tx, ctx.tenantId);
    if (!ho) throw new DomainError('INVALID', 'Head Office is not known here yet. Sync first');

    const known = tx
      .select({ id: items.id, name: items.name, active: items.isActive })
      .from(items)
      .where(and(eq(items.tenantId, ctx.tenantId), inArray(items.id, ids)))
      .all();
    input.lines.forEach((l, i) => {
      const item = known.find((k) => k.id === l.itemId);
      if (!item || !item.active) throw new DomainError('INVALID', `Line ${i + 1}: item not found`);
      positiveInt(l.qtyBase, `Line ${i + 1}: enter a quantity above zero`);
    });

    const id = newId();
    const docNo = nextDocNo(tx, ctx, 'REQ');
    const now = isoNow(ctx);
    const header = {
      id,
      tenantId: ctx.tenantId,
      fromBranchId: ctx.branchId,
      toBranchId: ho.id,
      docNo,
      status: 'submitted',
      neededBy: input.neededBy ?? null,
      note: input.note?.trim() || null,
      createdBy: ctx.userId,
      approvedBy: null,
      approvedAt: null,
      transferId: null,
      cancelReason: null,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    const lines = input.lines.map((l, index) => ({
      id: newId(),
      requisitionId: id,
      lineNo: index + 1,
      itemId: l.itemId,
      qtyRequestedBase: l.qtyBase,
      qtyApprovedBase: null,
    }));
    tx.insert(stockRequisitions).values(header).run();
    tx.insert(stockRequisitionLines).values(lines).run();
    recordChange(tx, ctx, {
      entityType: 'stock_requisitions',
      entityId: id,
      op: 'insert',
      payload: { ...header, lines },
    });
    appendAudit(tx, ctx, {
      action: 'requisition.create',
      entityType: 'stock_requisition',
      entityId: id,
      newValue: { docNo, toBranchId: ho.id, lines: lines.length },
    });
    return { id, docNo };
  });
}

function emitUpdate(tx: DbOrTx, ctx: WriteContext, id: string): void {
  recordChange(tx, ctx, {
    entityType: 'stock_requisitions',
    entityId: id,
    op: 'update',
    payload: requisitionAggregate(tx, id),
  });
}

/** Cancel before approval. Either side may do it. Approved requisitions are not cancelled, they are simply not shipped. */
export function cancelRequisition(db: Db, ctx: WriteContext, id: string, reason: string): void {
  if (reason.trim().length < 3) throw new DomainError('INVALID', 'Give a reason for cancelling');
  db.transaction((tx) => {
    const row = loadForBranch(tx, ctx, id);
    if (row.status !== 'submitted')
      throw new DomainError('CONFLICT', `A ${row.status} requisition cannot be cancelled`);
    tx.update(stockRequisitions)
      .set({
        status: 'cancelled',
        cancelReason: reason.trim(),
        version: row.version + 1,
        updatedAt: isoNow(ctx),
        hlc: ctx.clock.tick(),
      })
      .where(eq(stockRequisitions.id, id))
      .run();
    emitUpdate(tx, ctx, id);
    appendAudit(tx, ctx, {
      action: 'requisition.cancel',
      entityType: 'stock_requisition',
      entityId: id,
      oldValue: { status: row.status },
      newValue: { status: 'cancelled', reason: reason.trim() },
    });
  });
}

export interface ApproveInput {
  /** Granted quantity per line, smallest unit. Lines left out are granted as asked. */
  lines?: { lineId: string; qtyApprovedBase: number }[];
}

/**
 * Head Office approves a branch requisition, optionally changing quantities. A quantity can be lowered
 * (down to zero for an item that will not be sent) but not raised above what the branch asked for.
 */
export function approveRequisition(
  db: Db,
  ctx: WriteContext,
  id: string,
  input: ApproveInput = {},
): { approvedLines: number } {
  return db.transaction((tx) => {
    const row = loadForBranch(tx, ctx, id);
    if (row.toBranchId !== ctx.branchId)
      throw new DomainError('INVALID', 'Only Head Office can approve this requisition');
    if (row.status !== 'submitted')
      throw new DomainError('CONFLICT', `A ${row.status} requisition cannot be approved`);
    const lines = tx
      .select()
      .from(stockRequisitionLines)
      .where(eq(stockRequisitionLines.requisitionId, id))
      .all();
    const chosen = new Map<string, number>();
    for (const l of input.lines ?? []) {
      const line = lines.find((x) => x.id === l.lineId);
      if (!line) throw new DomainError('INVALID', 'A line does not belong to this requisition');
      if (!Number.isSafeInteger(l.qtyApprovedBase) || l.qtyApprovedBase < 0)
        throw new DomainError('INVALID', 'Approved quantity must be zero or more');
      if (l.qtyApprovedBase > line.qtyRequestedBase)
        throw new DomainError('INVALID', 'Approved quantity is more than the branch asked for');
      chosen.set(l.lineId, l.qtyApprovedBase);
    }
    let total = 0;
    for (const line of lines) {
      const qty = chosen.get(line.id) ?? line.qtyRequestedBase;
      total += qty;
      tx.update(stockRequisitionLines)
        .set({ qtyApprovedBase: qty })
        .where(eq(stockRequisitionLines.id, line.id))
        .run();
    }
    if (total === 0)
      throw new DomainError('INVALID', 'Nothing is approved. Cancel the requisition instead');
    const now = isoNow(ctx);
    tx.update(stockRequisitions)
      .set({
        status: 'approved',
        approvedBy: ctx.userId,
        approvedAt: now,
        version: row.version + 1,
        updatedAt: now,
        hlc: ctx.clock.tick(),
      })
      .where(eq(stockRequisitions.id, id))
      .run();
    emitUpdate(tx, ctx, id);
    appendAudit(tx, ctx, {
      action: 'requisition.approve',
      entityType: 'stock_requisition',
      entityId: id,
      oldValue: { status: 'submitted' },
      newValue: { status: 'approved', docNo: row.docNo, totalApprovedBase: total },
    });
    return {
      approvedLines: lines.filter((l) => (chosen.get(l.id) ?? l.qtyRequestedBase) > 0).length,
    };
  });
}

/** Marks an approved requisition as shipped. Called by dispatch inside its transaction. */
export function markRequisitionFulfilled(
  tx: DbOrTx,
  ctx: WriteContext,
  requisitionId: string,
  transferId: string,
): void {
  const row = tx
    .select()
    .from(stockRequisitions)
    .where(eq(stockRequisitions.id, requisitionId))
    .get();
  if (!row || row.status !== 'approved') return;
  tx.update(stockRequisitions)
    .set({
      status: 'fulfilled',
      transferId,
      version: row.version + 1,
      updatedAt: isoNow(ctx),
      hlc: ctx.clock.tick(),
    })
    .where(eq(stockRequisitions.id, requisitionId))
    .run();
  emitUpdate(tx, ctx, requisitionId);
}

export interface RequisitionListFilter {
  status?: RequisitionStatus;
  /** Matches the document number. */
  q?: string;
  page?: number;
  pageSize?: number;
}

export interface RequisitionListRow {
  id: string;
  docNo: string;
  status: RequisitionStatus;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  neededBy: string | null;
  lineCount: number;
  createdAt: string;
  transferId: string | null;
  /** True when this branch is the one that has to act (Head Office: approve; branch: nothing). */
  incoming: boolean;
}

export function listRequisitions(
  db: DbOrTx,
  ctx: WriteContext,
  filter: RequisitionListFilter = {},
): { rows: RequisitionListRow[]; total: number } {
  const { size, offset } = clampPage(filter.page, filter.pageSize);
  const where = and(
    eq(stockRequisitions.tenantId, ctx.tenantId),
    or(
      eq(stockRequisitions.fromBranchId, ctx.branchId),
      eq(stockRequisitions.toBranchId, ctx.branchId),
    ),
    filter.status ? eq(stockRequisitions.status, filter.status) : undefined,
    filter.q?.trim()
      ? sql`${stockRequisitions.docNo} LIKE ${'%' + filter.q.trim().replace(/[%_]/g, '') + '%'}`
      : undefined,
  );
  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(stockRequisitions)
    .where(where)
    .get();
  const rows = db
    .select()
    .from(stockRequisitions)
    .where(where)
    .orderBy(desc(stockRequisitions.createdAt), desc(stockRequisitions.docNo))
    .limit(size)
    .offset(offset)
    .all();
  const counts = new Map(
    rows.length
      ? db
          .select({ id: stockRequisitionLines.requisitionId, n: sql<number>`count(*)` })
          .from(stockRequisitionLines)
          .where(
            inArray(
              stockRequisitionLines.requisitionId,
              rows.map((r) => r.id),
            ),
          )
          .groupBy(stockRequisitionLines.requisitionId)
          .all()
          .map((c) => [c.id, Number(c.n)])
      : [],
  );
  const names = branchMap(
    db,
    ctx.tenantId,
    rows.flatMap((r) => [r.fromBranchId, r.toBranchId]),
  );
  return {
    total: Number(total?.n ?? 0),
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.docNo,
      status: r.status as RequisitionStatus,
      fromBranchId: r.fromBranchId,
      fromBranchName: names.get(r.fromBranchId)?.name ?? '',
      toBranchId: r.toBranchId,
      toBranchName: names.get(r.toBranchId)?.name ?? '',
      neededBy: r.neededBy,
      lineCount: counts.get(r.id) ?? 0,
      createdAt: r.createdAt,
      transferId: r.transferId,
      incoming: r.toBranchId === ctx.branchId,
    })),
  };
}

export interface RequisitionDetail extends RequisitionListRow {
  note: string | null;
  approvedAt: string | null;
  cancelReason: string | null;
  lines: {
    id: string;
    lineNo: number;
    item: Pick<ItemInfo, 'id' | 'sku' | 'name' | 'units'>;
    qtyRequestedBase: number;
    qtyApprovedBase: number | null;
  }[];
}

export function getRequisition(db: DbOrTx, ctx: WriteContext, id: string): RequisitionDetail {
  const row = loadForBranch(db, ctx, id);
  const lines = db
    .select()
    .from(stockRequisitionLines)
    .where(eq(stockRequisitionLines.requisitionId, id))
    .orderBy(stockRequisitionLines.lineNo)
    .all();
  const names = branchMap(db, ctx.tenantId, [row.fromBranchId, row.toBranchId]);
  const info = itemInfoMap(
    db,
    ctx.tenantId,
    lines.map((l) => l.itemId),
  );
  return {
    id: row.id,
    docNo: row.docNo,
    status: row.status as RequisitionStatus,
    fromBranchId: row.fromBranchId,
    fromBranchName: names.get(row.fromBranchId)?.name ?? '',
    toBranchId: row.toBranchId,
    toBranchName: names.get(row.toBranchId)?.name ?? '',
    neededBy: row.neededBy,
    lineCount: lines.length,
    createdAt: row.createdAt,
    transferId: row.transferId,
    incoming: row.toBranchId === ctx.branchId,
    note: row.note,
    approvedAt: row.approvedAt,
    cancelReason: row.cancelReason,
    lines: lines.map((l) => ({
      id: l.id,
      lineNo: l.lineNo,
      item: info.get(l.itemId) ?? { id: l.itemId, sku: '', name: 'Unknown item', units: [] },
      qtyRequestedBase: l.qtyRequestedBase,
      qtyApprovedBase: l.qtyApprovedBase,
    })),
  };
}
