import { and, eq, inArray, sql } from 'drizzle-orm';
import { lineAmountMinor, unitRateFromPack } from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { nextDocNo } from '../pharmacy/common';
import {
  grns,
  itemUnits,
  items,
  poLines,
  purchaseOrders,
  suppliers,
  units,
} from '../schema/sqlite-all';

export type PoStatus = 'draft' | 'approved' | 'partial' | 'received' | 'cancelled';

export interface PoLineInput {
  itemId: string;
  unitId: string;
  /** Whole number of the chosen unit. */
  qty: number;
  /** Expected price of one chosen unit in micro-PKR. */
  unitPriceMicro: number;
}

export interface PoInput {
  supplierId: string;
  expectedDate?: string | null;
  note?: string | null;
  lines: PoLineInput[];
}

interface PreparedLine {
  id: string;
  lineNo: number;
  itemId: string;
  unitId: string;
  qtyUnits: number;
  orderedBase: number;
  unitPriceMicro: number;
}

function prepareLines(
  tx: DbOrTx,
  ctx: WriteContext,
  input: PoInput,
): { lines: PreparedLine[]; subTotalMinor: number } {
  if (input.lines.length === 0)
    throw new DomainError('INVALID', 'Add at least one item to the order');
  if (input.expectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedDate))
    throw new DomainError('INVALID', 'Expected date is not valid');
  const supplier = tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.tenantId, ctx.tenantId)))
    .get();
  if (!supplier) throw new DomainError('INVALID', 'Choose a supplier');

  const itemIds = [...new Set(input.lines.map((l) => l.itemId))];
  const itemRows = tx
    .select({ id: items.id, name: items.name, active: items.isActive })
    .from(items)
    .where(and(eq(items.tenantId, ctx.tenantId), inArray(items.id, itemIds)))
    .all();
  const factors = tx.select().from(itemUnits).where(inArray(itemUnits.itemId, itemIds)).all();
  let subTotal = 0;
  const lines = input.lines.map((l, i): PreparedLine => {
    const item = itemRows.find((r) => r.id === l.itemId);
    if (!item || !item.active) throw new DomainError('INVALID', `Line ${i + 1}: item not found`);
    const unit = factors.find((f) => f.itemId === l.itemId && f.unitId === l.unitId);
    if (!unit)
      throw new DomainError('INVALID', `Line ${i + 1}: ${item.name} is not bought in that unit`);
    if (!Number.isInteger(l.qty) || l.qty <= 0)
      throw new DomainError('INVALID', `Line ${i + 1}: quantity must be a whole number above zero`);
    if (!Number.isSafeInteger(l.unitPriceMicro) || l.unitPriceMicro < 0)
      throw new DomainError('INVALID', `Line ${i + 1}: price is not valid`);
    const orderedBase = l.qty * unit.factorToBase;
    subTotal += lineAmountMinor(orderedBase, unitRateFromPack(l.unitPriceMicro, unit.factorToBase));
    return {
      id: newId(),
      lineNo: i + 1,
      itemId: l.itemId,
      unitId: l.unitId,
      qtyUnits: l.qty,
      orderedBase,
      unitPriceMicro: l.unitPriceMicro,
    };
  });
  return { lines, subTotalMinor: subTotal };
}

export function createPurchaseOrder(
  db: Db,
  ctx: WriteContext,
  input: PoInput,
): { id: string; docNo: string } {
  return db.transaction((tx) => {
    const { lines, subTotalMinor } = prepareLines(tx, ctx, input);
    const now = isoNow(ctx);
    const id = newId();
    const docNo = nextDocNo(tx, ctx, 'PO');
    const header = {
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      supplierId: input.supplierId,
      status: 'draft',
      expectedDate: input.expectedDate ?? null,
      note: input.note?.trim() || null,
      subTotalMinor,
      createdBy: ctx.userId,
      approvedBy: null,
      approvedAt: null,
      cancelReason: null,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(purchaseOrders).values(header).run();
    const rows = lines.map((l) => ({ ...l, poId: id, receivedBase: 0 }));
    tx.insert(poLines).values(rows).run();
    recordChange(tx, ctx, {
      entityType: 'purchase_orders',
      entityId: id,
      op: 'insert',
      payload: { ...header, lines: rows },
    });
    appendAudit(tx, ctx, {
      action: 'po.create',
      entityType: 'purchase_order',
      entityId: id,
      newValue: { docNo, supplierId: input.supplierId, lines: rows.length, subTotalMinor },
    });
    return { id, docNo };
  });
}

/** Edit an order that has not been approved yet. Approved orders are fixed: cancel and raise a new one. */
export function updateDraftPurchaseOrder(
  db: Db,
  ctx: WriteContext,
  id: string,
  input: PoInput & { expectedVersion: number },
): void {
  db.transaction((tx) => {
    const po = tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.branchId, ctx.branchId)))
      .get();
    if (!po) throw new DomainError('NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'draft')
      throw new DomainError('CONFLICT', 'Only a draft order can be edited');
    if (po.version !== input.expectedVersion)
      throw new DomainError(
        'VERSION_CONFLICT',
        'This order was changed by someone else. Reload and try again',
      );
    const { lines, subTotalMinor } = prepareLines(tx, ctx, input);
    const now = isoNow(ctx);
    const change = {
      supplierId: input.supplierId,
      expectedDate: input.expectedDate ?? null,
      note: input.note?.trim() || null,
      subTotalMinor,
      version: po.version + 1,
      updatedAt: now,
      hlc: ctx.clock.tick(),
    };
    tx.update(purchaseOrders).set(change).where(eq(purchaseOrders.id, id)).run();
    tx.delete(poLines).where(eq(poLines.poId, id)).run();
    const rows = lines.map((l) => ({ ...l, poId: id, receivedBase: 0 }));
    tx.insert(poLines).values(rows).run();
    recordChange(tx, ctx, {
      entityType: 'purchase_orders',
      entityId: id,
      op: 'update',
      payload: { id, ...change, lines: rows, baseVersion: po.version },
    });
    appendAudit(tx, ctx, {
      action: 'po.update',
      entityType: 'purchase_order',
      entityId: id,
      oldValue: { subTotalMinor: po.subTotalMinor },
      newValue: { subTotalMinor, lines: rows.length },
    });
  });
}

export function approvePurchaseOrder(db: Db, ctx: WriteContext, id: string): void {
  db.transaction((tx) => {
    const po = tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.branchId, ctx.branchId)))
      .get();
    if (!po) throw new DomainError('NOT_FOUND', 'Purchase order not found');
    if (po.status !== 'draft')
      throw new DomainError('CONFLICT', 'Only a draft order can be approved');
    const now = isoNow(ctx);
    const change = {
      status: 'approved',
      approvedBy: ctx.userId,
      approvedAt: now,
      version: po.version + 1,
      updatedAt: now,
      hlc: ctx.clock.tick(),
    };
    tx.update(purchaseOrders).set(change).where(eq(purchaseOrders.id, id)).run();
    recordChange(tx, ctx, {
      entityType: 'purchase_orders',
      entityId: id,
      op: 'update',
      payload: { id, ...change, baseVersion: po.version },
    });
    appendAudit(tx, ctx, {
      action: 'po.approve',
      entityType: 'purchase_order',
      entityId: id,
      oldValue: { status: po.status },
      newValue: { status: 'approved', docNo: po.docNo },
    });
  });
}

export function cancelPurchaseOrder(db: Db, ctx: WriteContext, id: string, reason: string): void {
  if (reason.trim().length < 3) throw new DomainError('INVALID', 'Give a reason for cancelling');
  db.transaction((tx) => {
    const po = tx
      .select()
      .from(purchaseOrders)
      .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.branchId, ctx.branchId)))
      .get();
    if (!po) throw new DomainError('NOT_FOUND', 'Purchase order not found');
    if (po.status === 'cancelled' || po.status === 'received')
      throw new DomainError('CONFLICT', `A ${po.status} order cannot be cancelled`);
    const now = isoNow(ctx);
    const change = {
      status: 'cancelled',
      cancelReason: reason.trim(),
      version: po.version + 1,
      updatedAt: now,
      hlc: ctx.clock.tick(),
    };
    tx.update(purchaseOrders).set(change).where(eq(purchaseOrders.id, id)).run();
    recordChange(tx, ctx, {
      entityType: 'purchase_orders',
      entityId: id,
      op: 'update',
      payload: { id, ...change, baseVersion: po.version },
    });
    appendAudit(tx, ctx, {
      action: 'po.cancel',
      entityType: 'purchase_order',
      entityId: id,
      oldValue: { status: po.status },
      newValue: { status: 'cancelled', reason: change.cancelReason },
    });
  });
}

export interface PoLineView {
  lineNo: number;
  itemId: string;
  itemName: string;
  unitId: string;
  unitName: string;
  factorToBase: number;
  qtyUnits: number;
  orderedBase: number;
  receivedBase: number;
  remainingBase: number;
  unitPriceMicro: number;
}

export interface PoView {
  id: string;
  docNo: string;
  status: PoStatus;
  supplierId: string;
  supplierName: string;
  expectedDate: string | null;
  note: string | null;
  subTotalMinor: number;
  createdAt: string;
  approvedAt: string | null;
  cancelReason: string | null;
  version: number;
  lines: PoLineView[];
  receipts: { id: string; docNo: string; totalMinor: number; createdAt: string }[];
}

export function getPurchaseOrder(db: DbOrTx, ctx: WriteContext, id: string): PoView {
  const po = db
    .select({ po: purchaseOrders, supplierName: suppliers.name })
    .from(purchaseOrders)
    .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
    .where(and(eq(purchaseOrders.id, id), eq(purchaseOrders.branchId, ctx.branchId)))
    .get();
  if (!po) throw new DomainError('NOT_FOUND', 'Purchase order not found');
  const lines = db
    .select({
      l: poLines,
      itemName: items.name,
      unitName: units.name,
      factor: itemUnits.factorToBase,
    })
    .from(poLines)
    .innerJoin(items, eq(items.id, poLines.itemId))
    .innerJoin(units, eq(units.id, poLines.unitId))
    .innerJoin(
      itemUnits,
      and(eq(itemUnits.itemId, poLines.itemId), eq(itemUnits.unitId, poLines.unitId)),
    )
    .where(eq(poLines.poId, id))
    .orderBy(poLines.lineNo)
    .all();
  const receipts = db
    .select({
      id: grns.id,
      docNo: grns.docNo,
      totalMinor: grns.totalMinor,
      createdAt: grns.createdAt,
    })
    .from(grns)
    .where(eq(grns.poId, id))
    .orderBy(grns.createdAt)
    .all();
  return {
    id: po.po.id,
    docNo: po.po.docNo,
    status: po.po.status as PoStatus,
    supplierId: po.po.supplierId,
    supplierName: po.supplierName,
    expectedDate: po.po.expectedDate,
    note: po.po.note,
    subTotalMinor: po.po.subTotalMinor,
    createdAt: po.po.createdAt,
    approvedAt: po.po.approvedAt,
    cancelReason: po.po.cancelReason,
    version: po.po.version,
    lines: lines.map(({ l, itemName, unitName, factor }) => ({
      lineNo: l.lineNo,
      itemId: l.itemId,
      itemName,
      unitId: l.unitId,
      unitName,
      factorToBase: factor,
      qtyUnits: l.qtyUnits,
      orderedBase: l.orderedBase,
      receivedBase: l.receivedBase,
      remainingBase: Math.max(0, l.orderedBase - l.receivedBase),
      unitPriceMicro: l.unitPriceMicro,
    })),
    receipts,
  };
}

export interface PoListRow {
  id: string;
  docNo: string;
  status: PoStatus;
  supplierName: string;
  expectedDate: string | null;
  lineCount: number;
  subTotalMinor: number;
  createdAt: string;
}

export function listPurchaseOrders(
  db: DbOrTx,
  ctx: WriteContext,
  opts: {
    status?: PoStatus;
    supplierId?: string;
    q?: string;
    page?: number;
    pageSize?: number;
  } = {},
): { rows: PoListRow[]; total: number } {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 200);
  const offset = (Math.max(opts.page ?? 1, 1) - 1) * pageSize;
  const where = sql`p.branch_id = ${ctx.branchId}
    ${opts.status ? sql`AND p.status = ${opts.status}` : sql``}
    ${opts.supplierId ? sql`AND p.supplier_id = ${opts.supplierId}` : sql``}
    ${opts.q?.trim() ? sql`AND (p.doc_no LIKE ${`%${opts.q.trim()}%`} OR s.name LIKE ${`%${opts.q.trim()}%`})` : sql``}`;
  const total =
    db.get<{ n: number }>(
      sql`SELECT count(*) AS n FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id WHERE ${where}`,
    )?.n ?? 0;
  const rows = db.all<{
    id: string;
    doc_no: string;
    status: string;
    name: string;
    expected: string | null;
    lines: number;
    sub: number;
    created: string;
  }>(sql`
    SELECT p.id, p.doc_no, p.status, s.name, p.expected_date AS expected, p.sub_total_minor AS sub, p.created_at AS created,
      (SELECT count(*) FROM po_lines l WHERE l.po_id = p.id) AS lines
    FROM purchase_orders p JOIN suppliers s ON s.id = p.supplier_id
    WHERE ${where} ORDER BY p.created_at DESC LIMIT ${pageSize} OFFSET ${offset}`);
  return {
    total: Number(total),
    rows: rows.map((r) => ({
      id: r.id,
      docNo: r.doc_no,
      status: r.status as PoStatus,
      supplierName: r.name,
      expectedDate: r.expected,
      lineCount: Number(r.lines),
      subTotalMinor: Number(r.sub),
      createdAt: r.created,
    })),
  };
}

export interface OrderSuggestion {
  itemId: string;
  name: string;
  unitId: string;
  unitName: string;
  factorToBase: number;
  sellableBase: number;
  reorderLevelBase: number;
  missedBase30d: number;
  suggestedQty: number;
  unitPriceMicro: number;
}

const MISSED_WINDOW_DAYS = 30;

/**
 * What to order: items at or below their reorder level (target: twice the reorder level) and items
 * customers asked for that were not in stock in the last 30 days. Quantities are in the default
 * purchase unit, priced at the latest batch cost. Fast: only items with a reorder level or a missed sale are looked at.
 */
export function suggestOrder(
  db: DbOrTx,
  ctx: WriteContext,
  today: string,
  limit = 300,
): OrderSuggestion[] {
  const since = new Date(
    Date.parse(`${today}T00:00:00Z`) - MISSED_WINDOW_DAYS * 86_400_000,
  ).toISOString();
  const rows = db.all<{
    id: string;
    name: string;
    unit_id: string;
    unit_name: string;
    factor: number;
    sellable: number;
    reorder: number;
    missed: number;
    last_cost: number | null;
  }>(sql`
    SELECT i.id, i.name, iu.unit_id, u.name AS unit_name, iu.factor_to_base AS factor, i.reorder_level_base AS reorder,
      COALESCE((SELECT SUM(m.qty_base) FROM stock_movements m JOIN batches b ON b.id = m.batch_id
                WHERE m.item_id = i.id AND m.branch_id = ${ctx.branchId} AND b.expiry_date >= ${today} AND b.is_blocked = 0), 0) AS sellable,
      COALESCE((SELECT SUM(ms.qty * COALESCE((SELECT x.factor_to_base FROM item_units x WHERE x.item_id = ms.item_id AND x.unit_id = ms.unit_id), 1)) FROM missed_sales ms WHERE ms.item_id = i.id AND ms.branch_id = ${ctx.branchId} AND ms.created_at >= ${since}), 0) AS missed,
      (SELECT b2.cost_unit_micro FROM batches b2 WHERE b2.item_id = i.id AND b2.branch_id = ${ctx.branchId} ORDER BY b2.created_at DESC LIMIT 1) AS last_cost
    FROM items i
    JOIN item_units iu ON iu.item_id = i.id AND iu.is_default_purchase = 1
    JOIN units u ON u.id = iu.unit_id
    WHERE i.tenant_id = ${ctx.tenantId} AND i.is_active = 1 AND i.deleted_at IS NULL
      AND (i.reorder_level_base > 0 OR i.id IN (SELECT item_id FROM missed_sales WHERE branch_id = ${ctx.branchId} AND item_id IS NOT NULL AND created_at >= ${since}))
    LIMIT 20000`);
  return rows
    .map((r) => {
      const sellable = Number(r.sellable);
      const missed = Number(r.missed);
      const shortfallForStock =
        r.reorder > 0 && sellable <= r.reorder ? r.reorder * 2 - sellable : 0;
      const shortfallForDemand = Math.max(0, missed - Math.max(0, sellable));
      const needBase = Math.max(shortfallForStock, shortfallForDemand);
      return {
        itemId: r.id,
        name: r.name,
        unitId: r.unit_id,
        unitName: r.unit_name,
        factorToBase: r.factor,
        sellableBase: sellable,
        reorderLevelBase: r.reorder,
        missedBase30d: missed,
        suggestedQty: needBase > 0 ? Math.ceil(needBase / r.factor) : 0,
        unitPriceMicro: (r.last_cost ?? 0) * r.factor,
      };
    })
    .filter((s) => s.suggestedQty > 0)
    .sort((a, b) => a.sellableBase - b.sellableBase || a.name.localeCompare(b.name))
    .slice(0, limit);
}
