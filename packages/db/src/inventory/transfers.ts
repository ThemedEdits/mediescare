import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  allocateFefo,
  allocateLargestRemainder,
  daysUntil,
  lineAmountMinor,
  type StockBatch,
} from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { branchToday, nextDocNo } from '../pharmacy/common';
import {
  getBatchStock,
  postMovement,
  type BatchStock,
  type PostedMovement,
} from '../pharmacy/stock';
import {
  batches,
  items,
  stockRequisitionLines,
  stockRequisitions,
  stockTransferLines,
  stockTransfers,
} from '../schema/sqlite-all';
import {
  branchMap,
  clampPage,
  getBranchInfo,
  itemInfoMap,
  ownBranch,
  positiveInt,
  type ItemInfo,
} from './common';
import { markRequisitionFulfilled } from './requisitions';

export type TransferStatus = 'draft' | 'dispatched' | 'received' | 'cancelled';
export type TransferRow = typeof stockTransfers.$inferSelect;
export type TransferLineRow = typeof stockTransferLines.$inferSelect;

/** The whole document as it travels through sync: header, lines and (for information) the ledger rows it posted. */
export interface TransferAggregate extends TransferRow {
  lines: TransferLineRow[];
  movements?: PostedMovement[];
}

export function transferAggregate(tx: DbOrTx, id: string): TransferAggregate {
  const header = tx.select().from(stockTransfers).where(eq(stockTransfers.id, id)).get();
  if (!header) throw new DomainError('NOT_FOUND', 'Transfer not found');
  const lines = tx
    .select()
    .from(stockTransferLines)
    .where(eq(stockTransferLines.transferId, id))
    .orderBy(stockTransferLines.lineNo)
    .all();
  return { ...header, lines };
}

function loadForBranch(tx: DbOrTx, ctx: WriteContext, id: string): TransferRow {
  const row = tx
    .select()
    .from(stockTransfers)
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.tenantId, ctx.tenantId)))
    .get();
  if (!row || (row.fromBranchId !== ctx.branchId && row.toBranchId !== ctx.branchId))
    throw new DomainError('NOT_FOUND', 'Transfer not found');
  return row;
}

// ---------------------------------------------------------------- batch picking

export interface BatchChoice {
  batchId: string;
  batchNo: string;
  expiryDate: string;
  availableBase: number;
  costUnitMicro: number;
  /** false for expired, blocked or empty batches: they cannot be shipped. */
  eligible: boolean;
  reason: 'expired' | 'blocked' | 'empty' | null;
}

/** Every batch of an item at this branch for the batch picker, first-expiry-first, with why a batch cannot be shipped. */
export function listTransferBatches(db: DbOrTx, ctx: WriteContext, itemId: string): BatchChoice[] {
  const today = branchToday(db, ctx);
  return getBatchStock(db, ctx.branchId, itemId)
    .map((b) => {
      const reason: BatchChoice['reason'] =
        daysUntil(b.expiryDate, today) < 0
          ? 'expired'
          : b.isBlocked
            ? 'blocked'
            : b.available <= 0
              ? 'empty'
              : null;
      return {
        batchId: b.id,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        availableBase: b.available,
        costUnitMicro: b.costUnitMicro,
        eligible: reason === null,
        reason,
      };
    })
    .sort((a, b) =>
      a.expiryDate === b.expiryDate
        ? a.batchNo.localeCompare(b.batchNo)
        : a.expiryDate < b.expiryDate
          ? -1
          : 1,
    );
}

export interface BatchSuggestion {
  picks: {
    batchId: string;
    batchNo: string;
    expiryDate: string;
    qtyBase: number;
    costUnitMicro: number;
  }[];
  /** What the eligible batches cannot cover. */
  shortfallBase: number;
}

/**
 * First-expiry-first pick for one item. Expired and blocked batches are never offered. When the
 * branch cannot cover the whole quantity it returns what it can and reports the shortfall.
 */
export function suggestTransferBatches(
  db: DbOrTx,
  ctx: WriteContext,
  itemId: string,
  qtyBase: number,
): BatchSuggestion {
  positiveInt(qtyBase, 'Enter a quantity above zero');
  const today = branchToday(db, ctx);
  const stock: BatchStock[] = getBatchStock(db, ctx.branchId, itemId);
  const eligible = stock.filter(
    (b) => !b.isBlocked && b.available > 0 && daysUntil(b.expiryDate, today) >= 0,
  );
  const coverable = Math.min(
    qtyBase,
    eligible.reduce((s, b) => s + b.available, 0),
  );
  if (coverable === 0) return { picks: [], shortfallBase: qtyBase };
  const { allocations } = allocateFefo(stock as StockBatch[], coverable, today);
  return {
    picks: allocations.map((a) => {
      const b = stock.find((s) => s.id === a.batchId) as BatchStock;
      return {
        batchId: b.id,
        batchNo: b.batchNo,
        expiryDate: b.expiryDate,
        qtyBase: a.qty,
        costUnitMicro: b.costUnitMicro,
      };
    }),
    shortfallBase: qtyBase - coverable,
  };
}

/** Throws when this batch cannot be shipped in this quantity: wrong item, expired, blocked or not enough on hand. */
function assertShippable(
  tx: DbOrTx,
  ctx: WriteContext,
  today: string,
  label: string,
  batchId: string,
  itemId: string,
  qty: number,
): typeof batches.$inferSelect {
  const batch = tx
    .select()
    .from(batches)
    .where(and(eq(batches.id, batchId), eq(batches.branchId, ctx.branchId)))
    .get();
  if (!batch || batch.itemId !== itemId)
    throw new DomainError('NOT_FOUND', `${label}: batch not found`);
  if (daysUntil(batch.expiryDate, today) < 0)
    throw new DomainError(
      'EXPIRED_BATCH',
      `${label}: batch ${batch.batchNo} is expired and cannot be sent`,
    );
  if (batch.isBlocked)
    throw new DomainError(
      'INVALID',
      `${label}: batch ${batch.batchNo} is blocked and cannot be sent`,
    );
  const onHand =
    getBatchStock(tx, ctx.branchId, itemId, { includeEmpty: true }).find((b) => b.id === batchId)
      ?.available ?? 0;
  if (qty > onHand)
    throw new DomainError(
      'INSUFFICIENT_STOCK',
      `${label}: only ${onHand} of batch ${batch.batchNo} is in stock`,
    );
  return batch;
}

// ---------------------------------------------------------------- create

export interface TransferInput {
  /** Ship against an approved requisition. The receiving branch is the branch that asked. */
  requisitionId?: string | null;
  /** Direct transfer without a requisition. Ignored when a requisition is given. */
  toBranchId?: string | null;
  note?: string;
  /**
   * The batches to send. Optional for a transfer from a requisition: the approved quantities are
   * then picked first-expiry-first, and only what is in stock is included.
   */
  lines?: { itemId: string; batchId: string; qtyBase: number }[];
}

/** Head Office writes a transfer note (a draft). Nothing leaves the ledger until it is dispatched. */
export function createTransfer(
  db: Db,
  ctx: WriteContext,
  input: TransferInput,
): { id: string; docNo: string } {
  return db.transaction((tx) => {
    const me = ownBranch(tx, ctx);
    if (!me.isHeadOffice)
      throw new DomainError('INVALID', 'Only Head Office sends stock to branches');
    const today = branchToday(tx, ctx);

    let toBranchId = input.toBranchId ?? null;
    let requisitionId: string | null = null;
    let approvedByItem: Map<string, number> | null = null;
    if (input.requisitionId) {
      const req = tx
        .select()
        .from(stockRequisitions)
        .where(
          and(
            eq(stockRequisitions.id, input.requisitionId),
            eq(stockRequisitions.tenantId, ctx.tenantId),
            eq(stockRequisitions.toBranchId, ctx.branchId),
          ),
        )
        .get();
      if (!req) throw new DomainError('NOT_FOUND', 'Requisition not found');
      if (req.status !== 'approved')
        throw new DomainError('CONFLICT', `A ${req.status} requisition cannot be shipped`);
      const open = tx
        .select({ docNo: stockTransfers.docNo })
        .from(stockTransfers)
        .where(
          and(
            eq(stockTransfers.requisitionId, req.id),
            inArray(stockTransfers.status, ['draft', 'dispatched', 'received']),
          ),
        )
        .get();
      if (open)
        throw new DomainError(
          'CONFLICT',
          `Transfer note ${open.docNo} already covers this requisition`,
        );
      requisitionId = req.id;
      toBranchId = req.fromBranchId;
      approvedByItem = new Map(
        tx
          .select()
          .from(stockRequisitionLines)
          .where(eq(stockRequisitionLines.requisitionId, req.id))
          .all()
          .map((l) => [l.itemId, l.qtyApprovedBase ?? l.qtyRequestedBase]),
      );
    }
    if (!toBranchId) throw new DomainError('INVALID', 'Choose the receiving branch');
    if (toBranchId === ctx.branchId)
      throw new DomainError('INVALID', 'A branch cannot send stock to itself');
    const dest = getBranchInfo(tx, ctx.tenantId, toBranchId);
    if (!dest || dest.status !== 'active')
      throw new DomainError('INVALID', 'The receiving branch was not found or is not active');

    let picks = input.lines ?? [];
    if (picks.length === 0) {
      if (!approvedByItem) throw new DomainError('INVALID', 'Add at least one batch to send');
      picks = [];
      for (const [itemId, qty] of approvedByItem) {
        if (qty <= 0) continue;
        for (const p of suggestTransferBatches(tx, ctx, itemId, qty).picks)
          picks.push({ itemId, batchId: p.batchId, qtyBase: p.qtyBase });
      }
      if (picks.length === 0)
        throw new DomainError('INSUFFICIENT_STOCK', 'None of the requested items is in stock');
    }
    const batchIds = picks.map((l) => l.batchId);
    if (new Set(batchIds).size !== batchIds.length)
      throw new DomainError('INVALID', 'Each batch can appear only once on a transfer note');

    if (approvedByItem) {
      const sent = new Map<string, number>();
      for (const l of picks) sent.set(l.itemId, (sent.get(l.itemId) ?? 0) + l.qtyBase);
      for (const [itemId, qty] of sent) {
        const allowed = approvedByItem.get(itemId);
        if (allowed === undefined)
          throw new DomainError('INVALID', 'An item on the note was not on the requisition');
        if (qty > allowed)
          throw new DomainError('INVALID', 'A quantity is more than Head Office approved');
      }
    }

    const itemRows = tx
      .select({ id: items.id, name: items.name, active: items.isActive })
      .from(items)
      .where(
        and(
          eq(items.tenantId, ctx.tenantId),
          inArray(items.id, [...new Set(picks.map((l) => l.itemId))]),
        ),
      )
      .all();

    const id = newId();
    const docNo = nextDocNo(tx, ctx, 'TRF');
    const now = isoNow(ctx);
    let total = 0;
    const lines = picks.map((l, index) => {
      const label = `Line ${index + 1}`;
      positiveInt(l.qtyBase, `${label}: enter a quantity above zero`);
      if (!itemRows.some((i) => i.id === l.itemId))
        throw new DomainError('INVALID', `${label}: item not found`);
      const batch = assertShippable(tx, ctx, today, label, l.batchId, l.itemId, l.qtyBase);
      total += lineAmountMinor(l.qtyBase, batch.costUnitMicro);
      return {
        id: newId(),
        transferId: id,
        lineNo: index + 1,
        itemId: l.itemId,
        sourceBatchId: batch.id,
        batchNo: batch.batchNo,
        mfgDate: batch.mfgDate,
        expiryDate: batch.expiryDate,
        mrpUnitMicro: batch.mrpUnitMicro,
        costUnitMicro: batch.costUnitMicro,
        qtyDispatched: l.qtyBase,
        qtyReceived: 0,
        qtyDamaged: 0,
        qtyShort: 0,
        receivedBatchId: null,
      };
    });

    const header = {
      id,
      tenantId: ctx.tenantId,
      fromBranchId: ctx.branchId,
      toBranchId,
      docNo,
      requisitionId,
      status: 'draft',
      note: input.note?.trim() || null,
      createdBy: ctx.userId,
      dispatchedBy: null,
      dispatchedAt: null,
      receivedBy: null,
      receivedAt: null,
      receiveNote: null,
      cancelReason: null,
      dispatchedCostMinor: total,
      receivedCostMinor: 0,
      damagedCostMinor: 0,
      shortCostMinor: 0,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(stockTransfers).values(header).run();
    tx.insert(stockTransferLines).values(lines).run();
    recordChange(tx, ctx, {
      entityType: 'stock_transfers',
      entityId: id,
      op: 'insert',
      payload: { ...header, lines },
    });
    appendAudit(tx, ctx, {
      action: 'transfer.create',
      entityType: 'stock_transfer',
      entityId: id,
      newValue: { docNo, toBranchId, requisitionId, lines: lines.length, costMinor: total },
    });
    return { id, docNo };
  });
}

// ---------------------------------------------------------------- cancel and dispatch

export function cancelTransfer(db: Db, ctx: WriteContext, id: string, reason: string): void {
  if (reason.trim().length < 3) throw new DomainError('INVALID', 'Give a reason for cancelling');
  db.transaction((tx) => {
    const row = loadForBranch(tx, ctx, id);
    if (row.fromBranchId !== ctx.branchId)
      throw new DomainError('INVALID', 'Only the sending branch can cancel a transfer note');
    if (row.status !== 'draft')
      throw new DomainError(
        'CONFLICT',
        row.status === 'cancelled'
          ? 'This transfer note is already cancelled'
          : 'Goods have already been dispatched. A dispatched transfer cannot be cancelled',
      );
    tx.update(stockTransfers)
      .set({
        status: 'cancelled',
        cancelReason: reason.trim(),
        version: row.version + 1,
        updatedAt: isoNow(ctx),
        hlc: ctx.clock.tick(),
      })
      .where(eq(stockTransfers.id, id))
      .run();
    recordChange(tx, ctx, {
      entityType: 'stock_transfers',
      entityId: id,
      op: 'update',
      payload: transferAggregate(tx, id),
    });
    appendAudit(tx, ctx, {
      action: 'transfer.cancel',
      entityType: 'stock_transfer',
      entityId: id,
      oldValue: { status: 'draft' },
      newValue: { status: 'cancelled', reason: reason.trim() },
    });
  });
}

/**
 * Goods leave the shipping branch: a transfer_out ledger row per line at the batch cost. From here
 * the goods are in transit, which exists only on the document: they are in nobody's stock.
 */
export function dispatchTransfer(
  db: Db,
  ctx: WriteContext,
  id: string,
): { id: string; docNo: string } {
  return db.transaction((tx) => {
    const row = loadForBranch(tx, ctx, id);
    if (row.fromBranchId !== ctx.branchId)
      throw new DomainError('INVALID', 'Only the sending branch can dispatch a transfer note');
    if (row.status !== 'draft')
      throw new DomainError(
        'CONFLICT',
        row.status === 'cancelled'
          ? 'A cancelled transfer note cannot be dispatched'
          : 'This transfer note has already been dispatched',
      );
    const today = branchToday(tx, ctx);
    const lines = tx
      .select()
      .from(stockTransferLines)
      .where(eq(stockTransferLines.transferId, id))
      .orderBy(stockTransferLines.lineNo)
      .all();
    const movements: PostedMovement[] = [];
    let total = 0;
    for (const l of lines) {
      assertShippable(
        tx,
        ctx,
        today,
        `Line ${l.lineNo}`,
        l.sourceBatchId,
        l.itemId,
        l.qtyDispatched,
      );
      total += lineAmountMinor(l.qtyDispatched, l.costUnitMicro);
      movements.push(
        postMovement(tx, ctx, {
          itemId: l.itemId,
          batchId: l.sourceBatchId,
          kind: 'transfer_out',
          qtyBase: l.qtyDispatched,
          unitCostMicro: l.costUnitMicro,
          docType: 'stock_transfer',
          docId: id,
          docLineId: l.id,
        }),
      );
    }
    const now = isoNow(ctx);
    tx.update(stockTransfers)
      .set({
        status: 'dispatched',
        dispatchedBy: ctx.userId,
        dispatchedAt: now,
        version: row.version + 1,
        updatedAt: now,
        hlc: ctx.clock.tick(),
      })
      .where(eq(stockTransfers.id, id))
      .run();
    recordChange(tx, ctx, {
      entityType: 'stock_transfers',
      entityId: id,
      op: 'update',
      payload: { ...transferAggregate(tx, id), movements },
    });
    if (row.requisitionId) markRequisitionFulfilled(tx, ctx, row.requisitionId, id);
    appendAudit(tx, ctx, {
      action: 'transfer.dispatch',
      entityType: 'stock_transfer',
      entityId: id,
      oldValue: { status: 'draft' },
      newValue: { status: 'dispatched', docNo: row.docNo, lines: lines.length, costMinor: total },
    });
    return { id, docNo: row.docNo };
  });
}

// ---------------------------------------------------------------- receive

export interface ReceiveInput {
  /** What was counted per line. Lines left out are taken as fully received. */
  lines?: { lineId: string; qtyReceived: number; qtyDamaged?: number }[];
  note?: string;
}

/**
 * The receiving branch counts the goods. Per line: received (good), damaged, and short (the rest).
 * Everything that physically arrived (good and damaged) enters the ledger as transfer_in on a batch
 * with the same number, expiry and cost, and the damaged part is written off again at once with an
 * adjustment, so only the good quantity stays in stock. Shortage never enters stock. Damage and
 * shortage are losses at cost, recorded on the document. A transfer is received exactly once.
 */
export function receiveTransfer(
  db: Db,
  ctx: WriteContext,
  id: string,
  input: ReceiveInput = {},
): { id: string; docNo: string; receivedQty: number; damagedQty: number; shortQty: number } {
  return db.transaction((tx) => {
    const row = loadForBranch(tx, ctx, id);
    if (row.toBranchId !== ctx.branchId)
      throw new DomainError('INVALID', 'Only the receiving branch can receive a transfer');
    if (row.status === 'received')
      throw new DomainError('CONFLICT', 'This transfer has already been received');
    if (row.status !== 'dispatched')
      throw new DomainError('CONFLICT', `A ${row.status} transfer cannot be received`);

    const lines = tx
      .select()
      .from(stockTransferLines)
      .where(eq(stockTransferLines.transferId, id))
      .orderBy(stockTransferLines.lineNo)
      .all();
    const counted = new Map<string, { received: number; damaged: number }>();
    for (const c of input.lines ?? []) {
      const line = lines.find((l) => l.id === c.lineId);
      if (!line) throw new DomainError('INVALID', 'A line does not belong to this transfer');
      if (counted.has(c.lineId)) throw new DomainError('INVALID', 'A line is listed twice');
      const damaged = c.qtyDamaged ?? 0;
      if (
        !Number.isSafeInteger(c.qtyReceived) ||
        !Number.isSafeInteger(damaged) ||
        c.qtyReceived < 0 ||
        damaged < 0
      )
        throw new DomainError('INVALID', `Line ${line.lineNo}: counts must be zero or more`);
      if (c.qtyReceived + damaged > line.qtyDispatched)
        throw new DomainError(
          'INVALID',
          `Line ${line.lineNo}: received and damaged are more than the ${line.qtyDispatched} dispatched`,
        );
      counted.set(c.lineId, { received: c.qtyReceived, damaged });
    }

    const now = isoNow(ctx);
    const movements: PostedMovement[] = [];
    const totals = { received: 0, damaged: 0, short: 0, rCost: 0, dCost: 0, sCost: 0 };

    for (const l of lines) {
      const c = counted.get(l.id) ?? { received: l.qtyDispatched, damaged: 0 };
      const short = l.qtyDispatched - c.received - c.damaged;
      const lineValue = lineAmountMinor(l.qtyDispatched, l.costUnitMicro);
      const [rCost, dCost, sCost] = allocateLargestRemainder(lineValue, [
        c.received,
        c.damaged,
        short,
      ]) as [number, number, number];

      const arrived = c.received + c.damaged;
      let batchId: string | null = null;
      if (arrived > 0) {
        const existing = tx
          .select()
          .from(batches)
          .where(
            and(
              eq(batches.branchId, ctx.branchId),
              eq(batches.itemId, l.itemId),
              eq(batches.batchNo, l.batchNo),
              eq(batches.expiryDate, l.expiryDate),
              eq(batches.costUnitMicro, l.costUnitMicro),
            ),
          )
          .get();
        batchId = existing?.id ?? null;
        if (!batchId) {
          batchId = newId();
          const batchRow = {
            id: batchId,
            tenantId: ctx.tenantId,
            branchId: ctx.branchId,
            itemId: l.itemId,
            batchNo: l.batchNo,
            mfgDate: l.mfgDate,
            expiryDate: l.expiryDate,
            costUnitMicro: l.costUnitMicro,
            mrpUnitMicro: l.mrpUnitMicro,
            supplierId: null,
            isBlocked: false,
            originDocType: 'stock_transfer',
            originDocId: id,
            createdAt: now,
            updatedAt: now,
            hlc: ctx.clock.tick(),
            version: 1,
          };
          tx.insert(batches).values(batchRow).run();
          recordChange(tx, ctx, {
            entityType: 'batches',
            entityId: batchId,
            op: 'insert',
            payload: batchRow,
          });
        }
        movements.push(
          postMovement(tx, ctx, {
            itemId: l.itemId,
            batchId,
            kind: 'transfer_in',
            qtyBase: arrived,
            unitCostMicro: l.costUnitMicro,
            docType: 'stock_transfer',
            docId: id,
            docLineId: l.id,
          }),
        );
        if (c.damaged > 0)
          movements.push(
            postMovement(tx, ctx, {
              itemId: l.itemId,
              batchId,
              kind: 'adjustment',
              qtyBase: -c.damaged,
              unitCostMicro: l.costUnitMicro,
              docType: 'stock_transfer',
              docId: id,
              docLineId: l.id,
            }),
          );
      }
      tx.update(stockTransferLines)
        .set({
          qtyReceived: c.received,
          qtyDamaged: c.damaged,
          qtyShort: short,
          receivedBatchId: batchId,
        })
        .where(eq(stockTransferLines.id, l.id))
        .run();
      totals.received += c.received;
      totals.damaged += c.damaged;
      totals.short += short;
      totals.rCost += rCost;
      totals.dCost += dCost;
      totals.sCost += sCost;
    }

    tx.update(stockTransfers)
      .set({
        status: 'received',
        receivedBy: ctx.userId,
        receivedAt: now,
        receiveNote: input.note?.trim() || null,
        receivedCostMinor: totals.rCost,
        damagedCostMinor: totals.dCost,
        shortCostMinor: totals.sCost,
        version: row.version + 1,
        updatedAt: now,
        hlc: ctx.clock.tick(),
      })
      .where(eq(stockTransfers.id, id))
      .run();
    recordChange(tx, ctx, {
      entityType: 'stock_transfers',
      entityId: id,
      op: 'update',
      payload: { ...transferAggregate(tx, id), movements },
    });
    appendAudit(tx, ctx, {
      action: 'transfer.receive',
      entityType: 'stock_transfer',
      entityId: id,
      oldValue: { status: 'dispatched' },
      newValue: {
        status: 'received',
        docNo: row.docNo,
        received: totals.received,
        damaged: totals.damaged,
        short: totals.short,
        lossCostMinor: totals.dCost + totals.sCost,
        note: input.note?.trim() || null,
      },
    });
    return {
      id,
      docNo: row.docNo,
      receivedQty: totals.received,
      damagedQty: totals.damaged,
      shortQty: totals.short,
    };
  });
}

// ---------------------------------------------------------------- read

/** Money at batch cost. Lives under the key `cost` so roles without the cost right never receive it. */
export interface TransferCost {
  dispatchedMinor: number;
  receivedMinor: number;
  damagedMinor: number;
  shortMinor: number;
}

export interface TransferListRow {
  id: string;
  docNo: string;
  status: TransferStatus;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  requisitionId: string | null;
  lineCount: number;
  qtyDispatched: number;
  qtyReceived: number;
  qtyDamaged: number;
  qtyShort: number;
  dispatchedAt: string | null;
  receivedAt: string | null;
  createdAt: string;
  /** 'outgoing': this branch ships it. 'incoming': this branch receives it. */
  direction: 'outgoing' | 'incoming';
  cost: TransferCost;
}

export interface TransferListFilter {
  status?: TransferStatus;
  direction?: 'outgoing' | 'incoming';
  q?: string;
  page?: number;
  pageSize?: number;
}

const costOf = (r: TransferRow): TransferCost => ({
  dispatchedMinor: r.dispatchedCostMinor,
  receivedMinor: r.receivedCostMinor,
  damagedMinor: r.damagedCostMinor,
  shortMinor: r.shortCostMinor,
});

export function listTransfers(
  db: DbOrTx,
  ctx: WriteContext,
  filter: TransferListFilter = {},
): { rows: TransferListRow[]; total: number } {
  const { size, offset } = clampPage(filter.page, filter.pageSize);
  const side =
    filter.direction === 'outgoing'
      ? eq(stockTransfers.fromBranchId, ctx.branchId)
      : filter.direction === 'incoming'
        ? eq(stockTransfers.toBranchId, ctx.branchId)
        : or(
            eq(stockTransfers.fromBranchId, ctx.branchId),
            eq(stockTransfers.toBranchId, ctx.branchId),
          );
  // A draft or cancelled note is private to the shipping branch until it is dispatched.
  const visible = or(
    eq(stockTransfers.fromBranchId, ctx.branchId),
    inArray(stockTransfers.status, ['dispatched', 'received']),
  );
  const where = and(
    eq(stockTransfers.tenantId, ctx.tenantId),
    side,
    visible,
    filter.status ? eq(stockTransfers.status, filter.status) : undefined,
    filter.q?.trim()
      ? sql`${stockTransfers.docNo} LIKE ${'%' + filter.q.trim().replace(/[%_]/g, '') + '%'}`
      : undefined,
  );
  const total = db
    .select({ n: sql<number>`count(*)` })
    .from(stockTransfers)
    .where(where)
    .get();
  const rows = db
    .select()
    .from(stockTransfers)
    .where(where)
    .orderBy(desc(stockTransfers.createdAt), desc(stockTransfers.docNo))
    .limit(size)
    .offset(offset)
    .all();
  const sums = new Map(
    rows.length
      ? db
          .select({
            id: stockTransferLines.transferId,
            n: sql<number>`count(*)`,
            d: sql<number>`sum(${stockTransferLines.qtyDispatched})`,
            r: sql<number>`sum(${stockTransferLines.qtyReceived})`,
            x: sql<number>`sum(${stockTransferLines.qtyDamaged})`,
            s: sql<number>`sum(${stockTransferLines.qtyShort})`,
          })
          .from(stockTransferLines)
          .where(
            inArray(
              stockTransferLines.transferId,
              rows.map((r) => r.id),
            ),
          )
          .groupBy(stockTransferLines.transferId)
          .all()
          .map((s) => [s.id, s])
      : [],
  );
  const names = branchMap(
    db,
    ctx.tenantId,
    rows.flatMap((r) => [r.fromBranchId, r.toBranchId]),
  );
  return {
    total: Number(total?.n ?? 0),
    rows: rows.map((r) => {
      const s = sums.get(r.id);
      return {
        id: r.id,
        docNo: r.docNo,
        status: r.status as TransferStatus,
        fromBranchId: r.fromBranchId,
        fromBranchName: names.get(r.fromBranchId)?.name ?? '',
        toBranchId: r.toBranchId,
        toBranchName: names.get(r.toBranchId)?.name ?? '',
        requisitionId: r.requisitionId,
        lineCount: Number(s?.n ?? 0),
        qtyDispatched: Number(s?.d ?? 0),
        qtyReceived: Number(s?.r ?? 0),
        qtyDamaged: Number(s?.x ?? 0),
        qtyShort: Number(s?.s ?? 0),
        dispatchedAt: r.dispatchedAt,
        receivedAt: r.receivedAt,
        createdAt: r.createdAt,
        direction: r.fromBranchId === ctx.branchId ? 'outgoing' : 'incoming',
        cost: costOf(r),
      };
    }),
  };
}

export interface TransferDetail extends TransferListRow {
  note: string | null;
  receiveNote: string | null;
  cancelReason: string | null;
  requisitionDocNo: string | null;
  lines: {
    id: string;
    lineNo: number;
    item: Pick<ItemInfo, 'id' | 'sku' | 'name' | 'units'>;
    batchNo: string;
    expiryDate: string;
    qtyDispatched: number;
    qtyReceived: number;
    qtyDamaged: number;
    qtyShort: number;
    costUnitMicro: number;
    cost: TransferCost;
  }[];
}

export function getTransfer(db: DbOrTx, ctx: WriteContext, id: string): TransferDetail {
  const row = loadForBranch(db, ctx, id);
  // A draft or cancelled note is private to the shipping branch until it is dispatched.
  if (row.status !== 'dispatched' && row.status !== 'received' && row.fromBranchId !== ctx.branchId)
    throw new DomainError('NOT_FOUND', 'Transfer not found');
  const lines = db
    .select()
    .from(stockTransferLines)
    .where(eq(stockTransferLines.transferId, id))
    .orderBy(stockTransferLines.lineNo)
    .all();
  const info = itemInfoMap(
    db,
    ctx.tenantId,
    lines.map((l) => l.itemId),
  );
  const names = branchMap(db, ctx.tenantId, [row.fromBranchId, row.toBranchId]);
  const sum = (pick: (l: TransferLineRow) => number) => lines.reduce((t, l) => t + pick(l), 0);
  const req = row.requisitionId
    ? db
        .select({ docNo: stockRequisitions.docNo })
        .from(stockRequisitions)
        .where(eq(stockRequisitions.id, row.requisitionId))
        .get()
    : undefined;
  const received = row.status === 'received';
  return {
    id: row.id,
    docNo: row.docNo,
    status: row.status as TransferStatus,
    fromBranchId: row.fromBranchId,
    fromBranchName: names.get(row.fromBranchId)?.name ?? '',
    toBranchId: row.toBranchId,
    toBranchName: names.get(row.toBranchId)?.name ?? '',
    requisitionId: row.requisitionId,
    lineCount: lines.length,
    qtyDispatched: sum((l) => l.qtyDispatched),
    qtyReceived: sum((l) => l.qtyReceived),
    qtyDamaged: sum((l) => l.qtyDamaged),
    qtyShort: sum((l) => l.qtyShort),
    dispatchedAt: row.dispatchedAt,
    receivedAt: row.receivedAt,
    createdAt: row.createdAt,
    direction: row.fromBranchId === ctx.branchId ? 'outgoing' : 'incoming',
    cost: costOf(row),
    note: row.note,
    receiveNote: row.receiveNote,
    cancelReason: row.cancelReason,
    requisitionDocNo: req?.docNo ?? null,
    lines: lines.map((l) => {
      const value = lineAmountMinor(l.qtyDispatched, l.costUnitMicro);
      const [r, d, s] = received
        ? (allocateLargestRemainder(value, [l.qtyReceived, l.qtyDamaged, l.qtyShort]) as [
            number,
            number,
            number,
          ])
        : [0, 0, 0];
      return {
        id: l.id,
        lineNo: l.lineNo,
        item: info.get(l.itemId) ?? { id: l.itemId, sku: '', name: 'Unknown item', units: [] },
        batchNo: l.batchNo,
        expiryDate: l.expiryDate,
        qtyDispatched: l.qtyDispatched,
        qtyReceived: l.qtyReceived,
        qtyDamaged: l.qtyDamaged,
        qtyShort: l.qtyShort,
        costUnitMicro: l.costUnitMicro,
        cost: { dispatchedMinor: value, receivedMinor: r, damagedMinor: d, shortMinor: s },
      };
    }),
  };
}
