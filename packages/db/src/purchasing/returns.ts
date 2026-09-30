import { and, eq, inArray, sql } from 'drizzle-orm';
import { lineAmountMinor } from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { nextDocNo } from '../pharmacy/common';
import { getBatchStock, postMovement, type PostedMovement } from '../pharmacy/stock';
import {
  batches,
  grnLines,
  grns,
  items,
  purchaseReturnLines,
  purchaseReturns,
  suppliers,
} from '../schema/sqlite-all';

export const SUPPLIER_RETURN_REASONS = [
  'damaged',
  'expired',
  'near_expiry',
  'wrong_item',
  'overstock',
  'recall',
  'other',
] as const;
export type SupplierReturnReason = (typeof SUPPLIER_RETURN_REASONS)[number];

export interface PurchaseReturnInput {
  supplierId: string;
  /** The bill the goods came in on. When given, every batch must have been received on it. */
  grnId?: string | null;
  reason: SupplierReturnReason;
  note?: string;
  /** The supplier's own credit note number, when they have issued one. */
  creditNoteNo?: string;
  lines: { batchId: string; qtyBase: number }[];
}

/**
 * Send goods back to a supplier. Stock leaves the named batches (append-only ledger movement of kind
 * purchase_return), and the value at batch cost becomes a credit on the supplier's ledger. Expired
 * and blocked batches can be returned, which is the usual reason to return them. A return can never
 * take a batch below zero. Posted returns are immutable (database triggers).
 */
export function createPurchaseReturn(
  db: Db,
  ctx: WriteContext,
  input: PurchaseReturnInput,
): { id: string; docNo: string; totalMinor: number } {
  if (!(SUPPLIER_RETURN_REASONS as readonly string[]).includes(input.reason))
    throw new DomainError('INVALID', 'Choose a reason for the return');
  if (input.reason === 'other' && !input.note?.trim())
    throw new DomainError('INVALID', 'Describe the reason');
  if (input.lines.length === 0)
    throw new DomainError('INVALID', 'Add at least one batch to return');
  const batchIds = input.lines.map((l) => l.batchId);
  if (new Set(batchIds).size !== batchIds.length)
    throw new DomainError('INVALID', 'Each batch can appear only once on a return');

  return db.transaction((tx) => {
    const supplier = tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.tenantId, ctx.tenantId)))
      .get();
    if (!supplier) throw new DomainError('INVALID', 'Choose a supplier');

    let billBatches: Set<string> | null = null;
    if (input.grnId) {
      const grn = tx
        .select({ supplierId: grns.supplierId })
        .from(grns)
        .where(and(eq(grns.id, input.grnId), eq(grns.branchId, ctx.branchId)))
        .get();
      if (!grn || grn.supplierId !== input.supplierId)
        throw new DomainError('INVALID', 'That bill does not belong to this supplier');
      billBatches = new Set(
        tx
          .select({ b: grnLines.batchId })
          .from(grnLines)
          .where(eq(grnLines.grnId, input.grnId))
          .all()
          .map((r) => r.b),
      );
    }

    const batchRows = tx
      .select({ b: batches, itemName: items.name })
      .from(batches)
      .innerJoin(items, eq(items.id, batches.itemId))
      .where(and(eq(batches.branchId, ctx.branchId), inArray(batches.id, batchIds)))
      .all();

    const id = newId();
    const docNo = nextDocNo(tx, ctx, 'PRT');
    const now = isoNow(ctx);
    const lineRows: (typeof purchaseReturnLines.$inferInsert)[] = [];
    const movements: PostedMovement[] = [];
    let total = 0;

    input.lines.forEach((line, index) => {
      const row = batchRows.find((r) => r.b.id === line.batchId);
      const label = `Line ${index + 1}`;
      if (!row) throw new DomainError('NOT_FOUND', `${label}: batch not found`);
      if (!Number.isSafeInteger(line.qtyBase) || line.qtyBase <= 0)
        throw new DomainError('INVALID', `${label}: enter a quantity above zero`);
      if (billBatches && !billBatches.has(row.b.id))
        throw new DomainError('INVALID', `${label}: ${row.itemName} was not received on that bill`);
      if (row.b.supplierId && row.b.supplierId !== input.supplierId && !billBatches)
        throw new DomainError('INVALID', `${label}: ${row.itemName} came from another supplier`);
      const onHand =
        getBatchStock(tx, ctx.branchId, row.b.itemId, { includeEmpty: true }).find(
          (b) => b.id === row.b.id,
        )?.available ?? 0;
      if (line.qtyBase > onHand)
        throw new DomainError(
          'INSUFFICIENT_STOCK',
          `${label}: only ${onHand} of ${row.itemName} batch ${row.b.batchNo} is in stock`,
        );
      const lineTotal = lineAmountMinor(line.qtyBase, row.b.costUnitMicro);
      const lineId = newId();
      lineRows.push({
        id: lineId,
        returnId: id,
        lineNo: index + 1,
        itemId: row.b.itemId,
        batchId: row.b.id,
        qtyBase: line.qtyBase,
        costUnitMicro: row.b.costUnitMicro,
        lineTotalMinor: lineTotal,
      });
      movements.push(
        postMovement(tx, ctx, {
          itemId: row.b.itemId,
          batchId: row.b.id,
          kind: 'purchase_return',
          qtyBase: line.qtyBase,
          unitCostMicro: row.b.costUnitMicro,
          docType: 'purchase_return',
          docId: id,
          docLineId: lineId,
        }),
      );
      total += lineTotal;
    });

    const header = {
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      supplierId: input.supplierId,
      grnId: input.grnId ?? null,
      reason: input.reason,
      note: input.note?.trim() || null,
      creditNoteNo: input.creditNoteNo?.trim() || null,
      totalMinor: total,
      status: 'posted',
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(purchaseReturns).values(header).run();
    tx.insert(purchaseReturnLines).values(lineRows).run();
    recordChange(tx, ctx, {
      entityType: 'purchase_returns',
      entityId: id,
      op: 'insert',
      payload: { ...header, lines: lineRows, movements },
    });
    appendAudit(tx, ctx, {
      action: 'purchase_return.create',
      entityType: 'purchase_return',
      entityId: id,
      newValue: {
        docNo,
        supplierId: input.supplierId,
        reason: input.reason,
        lines: lineRows.length,
        totalMinor: total,
      },
    });
    return { id, docNo, totalMinor: total };
  });
}

export interface ReturnRow {
  id: string;
  docNo: string;
  supplierId: string;
  supplierName: string;
  reason: SupplierReturnReason;
  creditNoteNo: string | null;
  totalMinor: number;
  createdAt: string;
}

export function listPurchaseReturns(
  db: DbOrTx,
  ctx: WriteContext,
  opts: { supplierId?: string; page?: number; pageSize?: number } = {},
): { rows: ReturnRow[]; total: number } {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 200);
  const offset = (Math.max(opts.page ?? 1, 1) - 1) * pageSize;
  const where = sql`r.branch_id = ${ctx.branchId} ${opts.supplierId ? sql`AND r.supplier_id = ${opts.supplierId}` : sql``}`;
  const total =
    db.get<{ n: number }>(sql`SELECT count(*) AS n FROM purchase_returns r WHERE ${where}`)?.n ?? 0;
  const rows = db.all<{
    id: string;
    doc_no: string;
    sid: string;
    sname: string;
    reason: string;
    cn: string | null;
    total: number;
    created: string;
  }>(sql`
    SELECT r.id, r.doc_no, s.id AS sid, s.name AS sname, r.reason, r.credit_note_no AS cn, r.total_minor AS total, r.created_at AS created
    FROM purchase_returns r JOIN suppliers s ON s.id = r.supplier_id
    WHERE ${where} ORDER BY r.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`);
  return {
    total: Number(total),
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.doc_no,
      supplierId: r.sid,
      supplierName: r.sname,
      reason: r.reason as SupplierReturnReason,
      creditNoteNo: r.cn,
      totalMinor: Number(r.total),
      createdAt: r.created,
    })),
  };
}

export interface ReturnDetail extends ReturnRow {
  note: string | null;
  grnId: string | null;
  lines: {
    lineNo: number;
    itemName: string;
    batchNo: string;
    expiryDate: string;
    qtyBase: number;
    costUnitMicro: number;
    lineTotalMinor: number;
  }[];
}

export function getPurchaseReturn(db: DbOrTx, ctx: WriteContext, id: string): ReturnDetail {
  const head = db
    .select({ r: purchaseReturns, supplierName: suppliers.name })
    .from(purchaseReturns)
    .innerJoin(suppliers, eq(suppliers.id, purchaseReturns.supplierId))
    .where(and(eq(purchaseReturns.id, id), eq(purchaseReturns.branchId, ctx.branchId)))
    .get();
  if (!head) throw new DomainError('NOT_FOUND', 'Purchase return not found');
  const lines = db
    .select({
      l: purchaseReturnLines,
      itemName: items.name,
      batchNo: batches.batchNo,
      expiryDate: batches.expiryDate,
    })
    .from(purchaseReturnLines)
    .innerJoin(items, eq(items.id, purchaseReturnLines.itemId))
    .innerJoin(batches, eq(batches.id, purchaseReturnLines.batchId))
    .where(eq(purchaseReturnLines.returnId, id))
    .orderBy(purchaseReturnLines.lineNo)
    .all();
  return {
    id: head.r.id,
    docNo: head.r.docNo,
    supplierId: head.r.supplierId,
    supplierName: head.supplierName,
    reason: head.r.reason as SupplierReturnReason,
    creditNoteNo: head.r.creditNoteNo,
    totalMinor: head.r.totalMinor,
    createdAt: head.r.createdAt,
    note: head.r.note,
    grnId: head.r.grnId,
    lines: lines.map(({ l, itemName, batchNo, expiryDate }) => ({
      lineNo: l.lineNo,
      itemName,
      batchNo,
      expiryDate,
      qtyBase: l.qtyBase,
      costUnitMicro: l.costUnitMicro,
      lineTotalMinor: l.lineTotalMinor,
    })),
  };
}
