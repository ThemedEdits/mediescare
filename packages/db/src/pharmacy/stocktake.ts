import { and, eq, sql } from 'drizzle-orm';
import { lineAmountMinor } from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { stockTakeLines, stockTakes } from '../schema/sqlite-all';
import { nextDocNo } from './common';
import { postMovement } from './stock';

/**
 * Stock take (physical count and reconciliation).
 *
 * Starting a count freezes what the ledger says per batch. Counting fills in what was found. Posting
 * writes each difference (counted minus frozen) to the ledger as an adjustment, so sales and receipts
 * made while people were counting are kept, not undone. Only one count can be open per branch, so a
 * batch is never counted twice at once.
 */

export interface StockTakeScope {
  categoryId?: string | null;
  rackId?: string | null;
  /** Restrict to these items (for example a shelf list). Omit for everything with stock. */
  itemIds?: string[];
}

const CHUNK = 500;

export function startStockTake(
  db: Db,
  ctx: WriteContext,
  input: { title: string; note?: string; scope?: StockTakeScope },
): { id: string; docNo: string; lineCount: number } {
  const title = input.title.trim();
  if (title.length < 2)
    throw new DomainError('INVALID', 'Give the count a name, for example "Rack A" or "Full count"');
  return db.transaction((tx) => {
    const open = tx
      .select({ docNo: stockTakes.docNo })
      .from(stockTakes)
      .where(and(eq(stockTakes.branchId, ctx.branchId), eq(stockTakes.status, 'open')))
      .get();
    if (open)
      throw new DomainError(
        'CONFLICT',
        `Finish or cancel ${open.docNo} before starting another count`,
      );

    const scope = input.scope ?? {};
    const itemFilter =
      scope.itemIds && scope.itemIds.length > 0
        ? sql`AND i.id IN (${sql.join(
            scope.itemIds.map((x) => sql`${x}`),
            sql`, `,
          )})`
        : sql``;
    const rows = tx.all<{ item_id: string; batch_id: string; qty: number; cost: number }>(sql`
      SELECT m.item_id, m.batch_id, SUM(m.qty_base) AS qty, b.cost_unit_micro AS cost
      FROM stock_movements m
      JOIN batches b ON b.id = m.batch_id
      JOIN items i ON i.id = m.item_id
      WHERE m.branch_id = ${ctx.branchId} AND i.tenant_id = ${ctx.tenantId} AND i.deleted_at IS NULL
        ${scope.categoryId ? sql`AND i.category_id = ${scope.categoryId}` : sql``}
        ${scope.rackId ? sql`AND i.rack_id = ${scope.rackId}` : sql``}
        ${itemFilter}
      GROUP BY m.batch_id
      HAVING SUM(m.qty_base) > 0`);
    if (rows.length === 0)
      throw new DomainError('INVALID', 'Nothing in stock matches that selection');

    const id = newId();
    const now = isoNow(ctx);
    const docNo = nextDocNo(tx, ctx, 'STK');
    const header = {
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      title,
      status: 'open',
      note: input.note?.trim() || null,
      startedBy: ctx.userId,
      postedBy: null,
      postedAt: null,
      cancelReason: null,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(stockTakes).values(header).run();
    for (let i = 0; i < rows.length; i += CHUNK) {
      tx.insert(stockTakeLines)
        .values(
          rows.slice(i, i + CHUNK).map((r) => ({
            id: newId(),
            takeId: id,
            itemId: r.item_id,
            batchId: r.batch_id,
            systemQtyBase: Number(r.qty),
            countedQtyBase: null,
            costUnitMicro: Number(r.cost),
            countedBy: null,
            countedAt: null,
          })),
        )
        .run();
    }
    recordChange(tx, ctx, {
      entityType: 'stock_takes',
      entityId: id,
      op: 'insert',
      payload: { ...header, lineCount: rows.length },
    });
    appendAudit(tx, ctx, {
      action: 'stock_take.start',
      entityType: 'stock_take',
      entityId: id,
      newValue: { docNo, title, lines: rows.length },
    });
    return { id, docNo, lineCount: rows.length };
  });
}

function openTake(tx: DbOrTx, ctx: WriteContext, id: string) {
  const take = tx
    .select()
    .from(stockTakes)
    .where(and(eq(stockTakes.id, id), eq(stockTakes.branchId, ctx.branchId)))
    .get();
  if (!take) throw new DomainError('NOT_FOUND', 'Stock take not found');
  if (take.status !== 'open')
    throw new DomainError('CONFLICT', `This count is already ${take.status}`);
  return take;
}

/** Save counted quantities (smallest unit). `null` clears a count. Safe to call repeatedly while counting. */
export function recordCounts(
  db: Db,
  ctx: WriteContext,
  takeId: string,
  counts: { lineId: string; countedQtyBase: number | null }[],
): { saved: number } {
  if (counts.length === 0) return { saved: 0 };
  if (counts.length > 1000) throw new DomainError('INVALID', 'Send at most 1,000 counts at a time');
  return db.transaction((tx) => {
    openTake(tx, ctx, takeId);
    const now = isoNow(ctx);
    let saved = 0;
    for (const c of counts) {
      if (
        c.countedQtyBase !== null &&
        (!Number.isSafeInteger(c.countedQtyBase) || c.countedQtyBase < 0)
      )
        throw new DomainError('INVALID', 'A counted quantity must be zero or more');
      const res = tx
        .update(stockTakeLines)
        .set({
          countedQtyBase: c.countedQtyBase,
          countedBy: c.countedQtyBase === null ? null : ctx.userId,
          countedAt: c.countedQtyBase === null ? null : now,
        })
        .where(and(eq(stockTakeLines.id, c.lineId), eq(stockTakeLines.takeId, takeId)))
        .run();
      if (res.changes === 0)
        throw new DomainError('NOT_FOUND', 'A line does not belong to this count');
      saved += 1;
    }
    return { saved };
  });
}

export interface StockTakePostResult {
  adjusted: number;
  unchanged: number;
  ignoredUncounted: number;
  /** Differences that would have taken a batch below zero (sold during the count) and were limited. */
  clamped: number;
  gainMinor: number;
  lossMinor: number;
}

/**
 * Post the differences to the ledger. Lines nobody counted are left alone unless `uncounted` is
 * `zero` (treat as not found). A loss larger than what is now on the shelf is limited to what is
 * left, and reported in `clamped`.
 */
export function postStockTake(
  db: Db,
  ctx: WriteContext,
  takeId: string,
  opts: { uncounted: 'ignore' | 'zero' },
): StockTakePostResult {
  return db.transaction((tx) => {
    const take = openTake(tx, ctx, takeId);
    const lines = tx.select().from(stockTakeLines).where(eq(stockTakeLines.takeId, takeId)).all();
    const onHand = new Map(
      tx
        .all<{ batch_id: string; qty: number }>(
          sql`SELECT m.batch_id, SUM(m.qty_base) AS qty FROM stock_movements m
              WHERE m.branch_id = ${ctx.branchId}
                AND m.batch_id IN (SELECT batch_id FROM stock_take_lines WHERE take_id = ${takeId})
              GROUP BY m.batch_id`,
        )
        .map((r) => [r.batch_id, Number(r.qty)] as const),
    );
    const result: StockTakePostResult = {
      adjusted: 0,
      unchanged: 0,
      ignoredUncounted: 0,
      clamped: 0,
      gainMinor: 0,
      lossMinor: 0,
    };
    for (const line of lines) {
      const counted = line.countedQtyBase ?? (opts.uncounted === 'zero' ? 0 : null);
      if (counted === null) {
        result.ignoredUncounted += 1;
        continue;
      }
      let delta = counted - line.systemQtyBase;
      if (delta === 0) {
        result.unchanged += 1;
        continue;
      }
      const current = onHand.get(line.batchId) ?? 0;
      if (current + delta < 0) {
        delta = -current;
        result.clamped += 1;
        if (delta === 0) continue;
      }
      postMovement(tx, ctx, {
        itemId: line.itemId,
        batchId: line.batchId,
        kind: 'adjustment',
        qtyBase: delta,
        unitCostMicro: line.costUnitMicro,
        docType: 'stock_take',
        docId: takeId,
        docLineId: line.id,
      });
      const value = lineAmountMinor(Math.abs(delta), line.costUnitMicro);
      if (delta > 0) result.gainMinor += value;
      else result.lossMinor += value;
      result.adjusted += 1;
    }
    const now = isoNow(ctx);
    const change = {
      status: 'posted',
      postedBy: ctx.userId,
      postedAt: now,
      updatedAt: now,
      version: take.version + 1,
      hlc: ctx.clock.tick(),
    };
    tx.update(stockTakes).set(change).where(eq(stockTakes.id, takeId)).run();
    recordChange(tx, ctx, {
      entityType: 'stock_takes',
      entityId: takeId,
      op: 'update',
      payload: { id: takeId, ...change, baseVersion: take.version, result },
    });
    appendAudit(tx, ctx, {
      action: 'stock_take.post',
      entityType: 'stock_take',
      entityId: takeId,
      oldValue: { status: 'open' },
      newValue: { docNo: take.docNo, ...result },
    });
    return result;
  });
}

export function cancelStockTake(db: Db, ctx: WriteContext, takeId: string, reason: string): void {
  if (reason.trim().length < 3) throw new DomainError('INVALID', 'Give a reason for cancelling');
  db.transaction((tx) => {
    const take = openTake(tx, ctx, takeId);
    const now = isoNow(ctx);
    const change = {
      status: 'cancelled',
      cancelReason: reason.trim(),
      updatedAt: now,
      version: take.version + 1,
      hlc: ctx.clock.tick(),
    };
    tx.update(stockTakes).set(change).where(eq(stockTakes.id, takeId)).run();
    recordChange(tx, ctx, {
      entityType: 'stock_takes',
      entityId: takeId,
      op: 'update',
      payload: { id: takeId, ...change, baseVersion: take.version },
    });
    appendAudit(tx, ctx, {
      action: 'stock_take.cancel',
      entityType: 'stock_take',
      entityId: takeId,
      oldValue: { status: 'open' },
      newValue: { status: 'cancelled', reason: reason.trim() },
    });
  });
}

export interface StockTakeSummary {
  id: string;
  docNo: string;
  title: string;
  status: 'open' | 'posted' | 'cancelled';
  note: string | null;
  createdAt: string;
  postedAt: string | null;
  cancelReason: string | null;
  totalLines: number;
  countedLines: number;
  varianceLines: number;
  /** Value of shortages and surpluses at batch cost, in paisa (hidden from roles without cost rights). */
  shortageCostValueMinor: number;
  surplusCostValueMinor: number;
}

interface SummaryRow {
  id: string;
  doc_no: string;
  title: string;
  status: string;
  note: string | null;
  created: string;
  posted: string | null;
  cancel: string | null;
  total: number;
  counted: number;
  variance: number;
  short_micro: number;
  surplus_micro: number;
}

const SUMMARY_SQL = (where: ReturnType<typeof sql>, limit: number, offset: number) => sql`
  SELECT t.id, t.doc_no, t.title, t.status, t.note, t.created_at AS created, t.posted_at AS posted, t.cancel_reason AS cancel,
    COUNT(l.id) AS total,
    COUNT(l.counted_qty_base) AS counted,
    COALESCE(SUM(CASE WHEN l.counted_qty_base IS NOT NULL AND l.counted_qty_base <> l.system_qty_base THEN 1 ELSE 0 END), 0) AS variance,
    COALESCE(SUM(CASE WHEN l.counted_qty_base < l.system_qty_base THEN (l.system_qty_base - l.counted_qty_base) * l.cost_unit_micro ELSE 0 END), 0) AS short_micro,
    COALESCE(SUM(CASE WHEN l.counted_qty_base > l.system_qty_base THEN (l.counted_qty_base - l.system_qty_base) * l.cost_unit_micro ELSE 0 END), 0) AS surplus_micro
  FROM stock_takes t LEFT JOIN stock_take_lines l ON l.take_id = t.id
  WHERE ${where} GROUP BY t.id ORDER BY t.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

const toSummary = (r: SummaryRow): StockTakeSummary => ({
  id: r.id,
  docNo: r.doc_no,
  title: r.title,
  status: r.status as StockTakeSummary['status'],
  note: r.note,
  createdAt: r.created,
  postedAt: r.posted,
  cancelReason: r.cancel,
  totalLines: Number(r.total),
  countedLines: Number(r.counted),
  varianceLines: Number(r.variance),
  shortageCostValueMinor: Number(BigInt(r.short_micro) / 10_000n),
  surplusCostValueMinor: Number(BigInt(r.surplus_micro) / 10_000n),
});

export function listStockTakes(
  db: DbOrTx,
  ctx: WriteContext,
  opts: { limit?: number } = {},
): StockTakeSummary[] {
  return db
    .all<SummaryRow>(
      SUMMARY_SQL(sql`t.branch_id = ${ctx.branchId}`, Math.min(opts.limit ?? 50, 200), 0),
    )
    .map(toSummary);
}

export function getStockTake(db: DbOrTx, ctx: WriteContext, id: string): StockTakeSummary {
  const row = db.all<SummaryRow>(
    SUMMARY_SQL(sql`t.branch_id = ${ctx.branchId} AND t.id = ${id}`, 1, 0),
  )[0];
  if (!row) throw new DomainError('NOT_FOUND', 'Stock take not found');
  return toSummary(row);
}

export interface StockTakeLineRow {
  lineId: string;
  itemId: string;
  itemName: string;
  sku: string;
  batchNo: string;
  expiryDate: string;
  /** The pack the shop counts in (default purchase unit) and the smallest unit, so counts can be entered as packs + loose. */
  packName: string;
  packSize: number;
  baseUnitName: string;
  systemQtyBase: number;
  countedQtyBase: number | null;
  differenceBase: number | null;
  costUnitMicro: number;
  costValueMinor: number | null;
}

export function listStockTakeLines(
  db: DbOrTx,
  ctx: WriteContext,
  takeId: string,
  opts: {
    filter?: 'all' | 'uncounted' | 'variance';
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): { rows: StockTakeLineRow[]; total: number } {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 50, 1), 200);
  const offset = (Math.max(opts.page ?? 1, 1) - 1) * pageSize;
  const q = opts.q?.trim();
  const where = sql`l.take_id = ${takeId} AND t.branch_id = ${ctx.branchId}
    ${opts.filter === 'uncounted' ? sql`AND l.counted_qty_base IS NULL` : sql``}
    ${opts.filter === 'variance' ? sql`AND l.counted_qty_base IS NOT NULL AND l.counted_qty_base <> l.system_qty_base` : sql``}
    ${q ? sql`AND (i.name LIKE ${`%${q}%`} OR i.sku LIKE ${`${q}%`} OR b.batch_no LIKE ${`${q}%`})` : sql``}`;
  const from = sql`FROM stock_take_lines l JOIN stock_takes t ON t.id = l.take_id JOIN items i ON i.id = l.item_id JOIN batches b ON b.id = l.batch_id
    JOIN units bu ON bu.id = i.base_unit_id
    LEFT JOIN item_units pu ON pu.item_id = i.id AND pu.is_default_purchase = 1
    LEFT JOIN units pun ON pun.id = pu.unit_id`;
  const total = db.get<{ n: number }>(sql`SELECT count(*) AS n ${from} WHERE ${where}`)?.n ?? 0;
  const rows = db.all<{
    id: string;
    item_id: string;
    name: string;
    sku: string;
    batch_no: string;
    expiry: string;
    sys: number;
    counted: number | null;
    cost: number;
    base_name: string;
    pack_name: string | null;
    pack_size: number | null;
  }>(sql`
    SELECT l.id, l.item_id, i.name, i.sku, b.batch_no, b.expiry_date AS expiry, l.system_qty_base AS sys,
      l.counted_qty_base AS counted, l.cost_unit_micro AS cost,
      bu.name AS base_name, pun.name AS pack_name, pu.factor_to_base AS pack_size
    ${from} WHERE ${where} ORDER BY i.name, b.expiry_date LIMIT ${pageSize} OFFSET ${offset}`);
  return {
    total: Number(total),
    rows: rows.map((r) => {
      const diff = r.counted === null ? null : Number(r.counted) - Number(r.sys);
      return {
        lineId: r.id,
        itemId: r.item_id,
        itemName: r.name,
        sku: r.sku,
        batchNo: r.batch_no,
        expiryDate: r.expiry,
        packName: r.pack_name ?? r.base_name,
        packSize: r.pack_size ?? 1,
        baseUnitName: r.base_name,
        systemQtyBase: Number(r.sys),
        countedQtyBase: r.counted === null ? null : Number(r.counted),
        differenceBase: diff,
        costUnitMicro: Number(r.cost),
        costValueMinor:
          diff === null
            ? null
            : (diff < 0 ? -1 : 1) * lineAmountMinor(Math.abs(diff), Number(r.cost)),
      };
    }),
  };
}
