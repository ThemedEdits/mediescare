import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  daysUntil,
  lineAmountMinor,
  signedQty,
  unitRateFromPack,
  type MovementKind,
  type StockBatch,
} from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import {
  batches,
  grnLines,
  grns,
  itemUnits,
  items,
  poLines,
  purchaseOrders,
  stockMovements,
  stores,
  suppliers,
} from '../schema/sqlite-all';
import { branchToday, ftsQuery, nextDocNo } from './common';

export interface BatchStock extends StockBatch {
  itemId: string;
  mfgDate: string | null;
  isBlocked: boolean;
  mrpUnitMicro: number;
}

/**
 * Batches of an item at a branch with their on-hand quantity. Quantity is always computed from the
 * ledger (SUM of movements), never stored (CLAUDE.md §4.3 rule 4). Sorted first-expiry-first.
 */
export function getBatchStock(
  db: DbOrTx,
  branchId: string,
  itemId: string,
  opts: { includeEmpty?: boolean } = {},
): BatchStock[] {
  const rows = db
    .select({ b: batches, qty: sql<number>`coalesce(sum(${stockMovements.qtyBase}), 0)` })
    .from(batches)
    .leftJoin(stockMovements, eq(stockMovements.batchId, batches.id))
    .where(and(eq(batches.branchId, branchId), eq(batches.itemId, itemId)))
    .groupBy(batches.id)
    .orderBy(batches.expiryDate, batches.batchNo)
    .all();
  return rows
    .filter((r) => opts.includeEmpty || r.qty !== 0)
    .map((r) => ({
      id: r.b.id,
      itemId: r.b.itemId,
      batchNo: r.b.batchNo,
      expiryDate: r.b.expiryDate,
      available: Number(r.qty),
      costUnitMicro: r.b.costUnitMicro,
      blocked: r.b.isBlocked,
      isBlocked: r.b.isBlocked,
      mfgDate: r.b.mfgDate,
      mrpUnitMicro: r.b.mrpUnitMicro,
    }));
}

export function mainStoreId(tx: DbOrTx, ctx: WriteContext): string {
  const store = tx
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.branchId, ctx.branchId), eq(stores.kind, 'main')))
    .get();
  if (!store) throw new DomainError('INVALID', 'This branch has no main store');
  return store.id;
}

export interface MovementInput {
  itemId: string;
  batchId: string;
  kind: MovementKind;
  qtyBase: number;
  unitCostMicro: number;
  docType: string;
  docId: string;
  docLineId?: string | null;
  reversesId?: string | null;
  storeId?: string;
}

export interface PostedMovement {
  id: string;
  itemId: string;
  batchId: string;
  kind: MovementKind;
  qtyBase: number;
  unitCostMicro: number;
  docId: string;
}

/** Append one stock ledger row. The sign is decided by the kind, so callers cannot post a sale as stock-in. */
export function postMovement(tx: DbOrTx, ctx: WriteContext, m: MovementInput): PostedMovement {
  const id = newId();
  const qtyBase = signedQty(m.kind, m.qtyBase);
  const now = isoNow(ctx);
  tx.insert(stockMovements)
    .values({
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      storeId: m.storeId ?? mainStoreId(tx, ctx),
      itemId: m.itemId,
      batchId: m.batchId,
      kind: m.kind,
      qtyBase,
      unitCostMicro: m.unitCostMicro,
      docType: m.docType,
      docId: m.docId,
      docLineId: m.docLineId ?? null,
      reversesId: m.reversesId ?? null,
      occurredAt: now,
      userId: ctx.userId,
      hlc: ctx.clock.tick(),
      createdAt: now,
    })
    .run();
  return {
    id,
    itemId: m.itemId,
    batchId: m.batchId,
    kind: m.kind,
    qtyBase,
    unitCostMicro: m.unitCostMicro,
    docId: m.docId,
  };
}

export interface GrnLineInput {
  itemId: string;
  unitId: string;
  /** Paid quantity in the chosen unit. */
  qty: number;
  /** Free (bonus) quantity in the chosen unit. Lowers the effective cost of the batch. */
  bonusQty?: number;
  batchNo: string;
  /** 'YYYY-MM-DD' */
  expiryDate: string;
  mfgDate?: string | null;
  /** Price of one chosen unit (for example one strip) in micro-PKR. */
  unitPriceMicro: number;
  /** Printed maximum retail price of one chosen unit, in micro-PKR. */
  mrpMicro?: number;
}

export interface GrnInput {
  supplierId: string;
  /** Receive against an approved purchase order; its delivered quantities and status are updated. */
  poId?: string | null;
  supplierInvoiceNo?: string | null;
  supplierInvoiceDate?: string | null;
  discountMinor?: number;
  salesTaxMinor?: number;
  advanceTaxMinor?: number;
  whtMinor?: number;
  freightMinor?: number;
  stockNote?: string | null;
  lines: GrnLineInput[];
}

export interface GrnResult {
  id: string;
  docNo: string;
  subTotalMinor: number;
  totalMinor: number;
  lines: { itemId: string; batchId: string; qtyBase: number; costUnitMicro: number }[];
}

const money = (n: number | undefined, label: string): number => {
  const v = n ?? 0;
  if (!Number.isSafeInteger(v) || v < 0)
    throw new DomainError('INVALID', `${label} must be zero or more`);
  return v;
};

/**
 * Goods receipt ("Add stock"): creates or reuses a batch per line and posts a purchase movement.
 * Expired stock is refused. The batch cost includes bonus units: 100 paid + 10 free at PKR 100 each
 * is 1000000/110 per unit. Total = lines - discount + sales tax + advance tax + freight; WHT is the
 * amount withheld when paying the supplier and is kept separately (tax treatment to be confirmed, Q7).
 */
export function receiveGrn(db: Db, ctx: WriteContext, input: GrnInput): GrnResult {
  if (input.lines.length === 0) throw new DomainError('INVALID', 'Add at least one item');
  const discount = money(input.discountMinor, 'Discount');
  const salesTax = money(input.salesTaxMinor, 'Sales tax');
  const advanceTax = money(input.advanceTaxMinor, 'Advance tax');
  const wht = money(input.whtMinor, 'Withholding tax');
  const freight = money(input.freightMinor, 'Freight');

  return db.transaction((tx) => {
    const supplier = tx
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.tenantId, ctx.tenantId)))
      .get();
    if (!supplier) throw new DomainError('INVALID', 'Choose a supplier');
    const po = input.poId
      ? tx
          .select()
          .from(purchaseOrders)
          .where(and(eq(purchaseOrders.id, input.poId), eq(purchaseOrders.branchId, ctx.branchId)))
          .get()
      : undefined;
    if (input.poId) {
      if (!po) throw new DomainError('INVALID', 'Purchase order not found');
      if (po.supplierId !== supplier.id)
        throw new DomainError('INVALID', 'This purchase order belongs to another supplier');
      if (po.status !== 'approved' && po.status !== 'partial')
        throw new DomainError('CONFLICT', `A ${po.status} purchase order cannot be received`);
    }
    const today = branchToday(tx, ctx);
    const now = isoNow(ctx);
    const grnId = newId();
    const docNo = nextDocNo(tx, ctx, 'GRN');

    const itemRows = tx
      .select()
      .from(items)
      .where(
        and(
          eq(items.tenantId, ctx.tenantId),
          inArray(items.id, [...new Set(input.lines.map((l) => l.itemId))]),
        ),
      )
      .all();
    const factors = tx
      .select()
      .from(itemUnits)
      .where(
        inArray(
          itemUnits.itemId,
          itemRows.map((i) => i.id),
        ),
      )
      .all();

    const linePayload: (typeof grnLines.$inferInsert)[] = [];
    const movements: PostedMovement[] = [];
    const result: GrnResult['lines'] = [];
    let subTotal = 0;

    input.lines.forEach((line, index) => {
      const item = itemRows.find((i) => i.id === line.itemId);
      if (!item || !item.isActive)
        throw new DomainError('INVALID', `Line ${index + 1}: item not found`);
      const unit = factors.find((f) => f.itemId === item.id && f.unitId === line.unitId);
      if (!unit)
        throw new DomainError(
          'INVALID',
          `Line ${index + 1}: ${item.name} is not bought in that unit`,
        );
      if (!Number.isInteger(line.qty) || line.qty <= 0)
        throw new DomainError(
          'INVALID',
          `Line ${index + 1}: quantity must be a whole number above zero`,
        );
      const bonusUnits = line.bonusQty ?? 0;
      if (!Number.isInteger(bonusUnits) || bonusUnits < 0)
        throw new DomainError('INVALID', `Line ${index + 1}: bonus must be a whole number`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(line.expiryDate))
        throw new DomainError('INVALID', `Line ${index + 1}: enter the expiry date`);
      if (daysUntil(line.expiryDate, today) < 0)
        throw new DomainError(
          'EXPIRED_BATCH',
          `Line ${index + 1}: ${item.name} batch ${line.batchNo} is already expired and cannot be received`,
        );
      if (line.batchNo.trim().length === 0)
        throw new DomainError('INVALID', `Line ${index + 1}: enter the batch number`);
      if (!Number.isSafeInteger(line.unitPriceMicro) || line.unitPriceMicro < 0)
        throw new DomainError('INVALID', `Line ${index + 1}: price is not valid`);

      const paidBase = line.qty * unit.factorToBase;
      const bonusBase = bonusUnits * unit.factorToBase;
      const baseCostMicro = unitRateFromPack(line.unitPriceMicro, unit.factorToBase);
      const lineTotal = lineAmountMinor(paidBase, baseCostMicro);
      // Effective cost spreads what was paid over paid + free units.
      const effectiveCost = unitRateFromPack(baseCostMicro * paidBase, paidBase + bonusBase);
      const mrpBase = line.mrpMicro ? unitRateFromPack(line.mrpMicro, unit.factorToBase) : 0;

      const existing = tx
        .select()
        .from(batches)
        .where(
          and(
            eq(batches.branchId, ctx.branchId),
            eq(batches.itemId, item.id),
            eq(batches.batchNo, line.batchNo.trim()),
            eq(batches.expiryDate, line.expiryDate),
            eq(batches.costUnitMicro, effectiveCost),
          ),
        )
        .get();
      let batchId = existing?.id;
      if (!batchId) {
        batchId = newId();
        const batchRow = {
          id: batchId,
          tenantId: ctx.tenantId,
          branchId: ctx.branchId,
          itemId: item.id,
          batchNo: line.batchNo.trim(),
          mfgDate: line.mfgDate ?? null,
          expiryDate: line.expiryDate,
          costUnitMicro: effectiveCost,
          mrpUnitMicro: mrpBase,
          supplierId: supplier.id,
          isBlocked: false,
          originDocType: 'grn',
          originDocId: grnId,
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
      const lineId = newId();
      linePayload.push({
        id: lineId,
        grnId,
        lineNo: index + 1,
        itemId: item.id,
        batchId,
        unitId: line.unitId,
        qtyUnits: line.qty,
        qtyBase: paidBase,
        bonusQtyBase: bonusBase,
        costUnitMicro: effectiveCost,
        lineTotalMinor: lineTotal,
      });
      movements.push(
        postMovement(tx, ctx, {
          itemId: item.id,
          batchId,
          kind: 'purchase',
          qtyBase: paidBase + bonusBase,
          unitCostMicro: effectiveCost,
          docType: 'grn',
          docId: grnId,
          docLineId: lineId,
        }),
      );
      subTotal += lineTotal;
      result.push({
        itemId: item.id,
        batchId,
        qtyBase: paidBase + bonusBase,
        costUnitMicro: effectiveCost,
      });
    });

    if (discount > subTotal)
      throw new DomainError('INVALID', 'Discount is more than the goods total');
    const total = subTotal - discount + salesTax + advanceTax + freight;
    const header = {
      id: grnId,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      supplierId: supplier.id,
      poId: po?.id ?? null,
      supplierInvoiceNo: input.supplierInvoiceNo ?? null,
      supplierInvoiceDate: input.supplierInvoiceDate ?? null,
      discountMinor: discount,
      salesTaxMinor: salesTax,
      advanceTaxMinor: advanceTax,
      whtMinor: wht,
      freightMinor: freight,
      subTotalMinor: subTotal,
      totalMinor: total,
      paidMinor: 0,
      stockNote: input.stockNote ?? null,
      status: 'posted',
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(grns).values(header).run();
    tx.insert(grnLines).values(linePayload).run();
    recordChange(tx, ctx, {
      entityType: 'grns',
      entityId: grnId,
      op: 'insert',
      payload: { ...header, lines: linePayload, movements },
    });
    if (po) applyReceiptToPo(tx, ctx, po, linePayload);
    appendAudit(tx, ctx, {
      action: 'grn.create',
      entityType: 'grn',
      entityId: grnId,
      newValue: { docNo, supplierId: supplier.id, lines: linePayload.length, totalMinor: total },
    });
    return { id: grnId, docNo, subTotalMinor: subTotal, totalMinor: total, lines: result };
  });
}

/** Count what arrived against the order's lines (oldest line first) and move the order to partial or received. */
function applyReceiptToPo(
  tx: DbOrTx,
  ctx: WriteContext,
  po: typeof purchaseOrders.$inferSelect,
  received: (typeof grnLines.$inferInsert)[],
): void {
  const lines = tx
    .select()
    .from(poLines)
    .where(eq(poLines.poId, po.id))
    .orderBy(poLines.lineNo)
    .all();
  for (const r of received) {
    const matching = lines.filter((x) => x.itemId === r.itemId);
    let left = r.qtyBase;
    for (const l of matching) {
      if (left <= 0) break;
      const take = Math.min(left, Math.max(0, l.orderedBase - l.receivedBase));
      l.receivedBase += take;
      left -= take;
    }
    // Delivery above the ordered amount is still recorded, on the last matching line.
    const last = matching[matching.length - 1];
    if (left > 0 && last) last.receivedBase += left;
  }
  for (const l of lines)
    tx.update(poLines).set({ receivedBase: l.receivedBase }).where(eq(poLines.id, l.id)).run();
  const complete = lines.every((l) => l.receivedBase >= l.orderedBase);
  const change = {
    status: complete ? 'received' : 'partial',
    version: po.version + 1,
    updatedAt: isoNow(ctx),
    hlc: ctx.clock.tick(),
  };
  tx.update(purchaseOrders).set(change).where(eq(purchaseOrders.id, po.id)).run();
  recordChange(tx, ctx, {
    entityType: 'purchase_orders',
    entityId: po.id,
    op: 'update',
    payload: {
      id: po.id,
      ...change,
      baseVersion: po.version,
      receivedBase: lines.map((l) => ({ id: l.id, receivedBase: l.receivedBase })),
    },
  });
}

export const ADJUSTMENT_REASONS = [
  'count_correction',
  'damaged',
  'expired_writeoff',
  'consumed_internal',
  'sample',
  'lost',
  'found',
  'other',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface AdjustInput {
  batchId: string;
  /** Positive adds stock, negative removes it. */
  qtyDeltaBase: number;
  reason: AdjustmentReason;
  note?: string;
}

/** Stock adjustment with a reason. Removing stock never takes a batch below zero. */
export function adjustStock(
  db: Db,
  ctx: WriteContext,
  input: AdjustInput,
): { movementId: string; newBalance: number } {
  if (!Number.isSafeInteger(input.qtyDeltaBase) || input.qtyDeltaBase === 0)
    throw new DomainError('INVALID', 'Enter how many to add or remove');
  if (input.reason === 'other' && !input.note?.trim())
    throw new DomainError('INVALID', 'Describe the reason');
  return db.transaction((tx) => {
    const batch = tx
      .select()
      .from(batches)
      .where(and(eq(batches.id, input.batchId), eq(batches.branchId, ctx.branchId)))
      .get();
    if (!batch) throw new DomainError('NOT_FOUND', 'Batch not found');
    const current =
      getBatchStock(tx, ctx.branchId, batch.itemId, { includeEmpty: true }).find(
        (b) => b.id === batch.id,
      )?.available ?? 0;
    if (current + input.qtyDeltaBase < 0)
      throw new DomainError('INSUFFICIENT_STOCK', `Only ${current} in this batch`);
    const kind: MovementKind =
      input.reason === 'expired_writeoff'
        ? 'expiry_writeoff'
        : input.reason === 'consumed_internal'
          ? 'consume'
          : 'adjustment';
    const docId = newId();
    const posted = postMovement(tx, ctx, {
      itemId: batch.itemId,
      batchId: batch.id,
      kind,
      qtyBase: kind === 'adjustment' ? input.qtyDeltaBase : Math.abs(input.qtyDeltaBase),
      unitCostMicro: batch.costUnitMicro,
      docType: 'adjustment',
      docId,
    });
    recordChange(tx, ctx, {
      entityType: 'stock_adjustments',
      entityId: docId,
      op: 'insert',
      payload: { ...input, movement: posted },
    });
    appendAudit(tx, ctx, {
      action: 'stock.adjust',
      entityType: 'batch',
      entityId: batch.id,
      oldValue: { balance: current },
      newValue: {
        balance: current + posted.qtyBase,
        reason: input.reason,
        note: input.note ?? null,
      },
    });
    return { movementId: posted.id, newBalance: current + posted.qtyBase };
  });
}

export interface StockRow {
  itemId: string;
  sku: string;
  name: string;
  genericName: string | null;
  onHandBase: number;
  expiredBase: number;
  sellableBase: number;
  reorderLevelBase: number;
  low: boolean;
  nearestExpiry: string | null;
  /** Value at batch cost, in paisa. Cost data: hidden from roles without view_cost. */
  costValueMinor: number;
}

export interface StockFilter {
  q?: string;
  lowOnly?: boolean;
  onlyInStock?: boolean;
  page?: number;
  pageSize?: number;
}

/**
 * Stock per item for the branch: on hand, expired, sellable, reorder flag. Server-side paging.
 *
 * Fast path (no stock-based filter): the page of items is chosen first, then stock is summed for just
 * those rows, so the cost does not grow with the catalogue (100k+ SKUs). Filters that depend on the
 * stock figures (low stock, only in stock) must look at every item and are reserved for reports.
 */
export function listStock(
  db: Db,
  ctx: WriteContext,
  filter: StockFilter = {},
): { rows: StockRow[]; total: number } {
  const today = branchToday(db, ctx);
  const pageSize = Math.min(Math.max(filter.pageSize ?? 25, 1), 200);
  const offset = (Math.max(filter.page ?? 1, 1) - 1) * pageSize;
  // Text search goes through the full-text index (words and prefixes), not a LIKE scan of the catalogue.
  const match = ftsQuery(filter.q ?? '');
  const itemWhere = sql`i.tenant_id = ${ctx.tenantId} AND i.deleted_at IS NULL AND i.is_active = 1
    ${match ? sql`AND i.id IN (SELECT item_id FROM items_fts WHERE items_fts MATCH ${match})` : sql``}`;

  const needsAllStock = Boolean(filter.lowOnly || filter.onlyInStock);
  const pageItems = needsAllStock
    ? sql`items i`
    : sql`(SELECT *, count(*) OVER () AS total_count FROM items i WHERE ${itemWhere} ORDER BY i.name LIMIT ${pageSize} OFFSET ${offset}) i`;

  const stockSums = sql`
    FROM ${pageItems}
    LEFT JOIN stock_movements m ON m.item_id = i.id AND m.branch_id = ${ctx.branchId}
    LEFT JOIN batches b ON b.id = m.batch_id
    ${needsAllStock ? sql`WHERE ${itemWhere}` : sql``}
    GROUP BY i.id
    ${
      needsAllStock
        ? sql`HAVING 1 = 1
      ${filter.onlyInStock ? sql`AND COALESCE(SUM(m.qty_base), 0) > 0` : sql``}
      ${filter.lowOnly ? sql`AND COALESCE(SUM(CASE WHEN b.expiry_date >= ${today} AND b.is_blocked = 0 THEN m.qty_base ELSE 0 END), 0) <= i.reorder_level_base` : sql``}`
        : sql``
    }`;

  const rows = db.all<{
    id: string;
    sku: string;
    name: string;
    generic_name: string | null;
    onhand: number;
    expired: number;
    sellable: number;
    reorder: number;
    nearest: string | null;
    value_micro: number;
    total_count: number | null;
  }>(sql`
    SELECT i.id, i.sku, i.name, i.generic_name,
      COALESCE(SUM(m.qty_base), 0) AS onhand,
      COALESCE(SUM(CASE WHEN b.expiry_date < ${today} THEN m.qty_base ELSE 0 END), 0) AS expired,
      COALESCE(SUM(CASE WHEN b.expiry_date >= ${today} AND b.is_blocked = 0 THEN m.qty_base ELSE 0 END), 0) AS sellable,
      i.reorder_level_base AS reorder,
      MIN(CASE WHEN b.expiry_date >= ${today} AND m.qty_base > 0 THEN b.expiry_date END) AS nearest,
      COALESCE(SUM(m.qty_base * m.unit_cost_micro), 0) AS value_micro
      ${needsAllStock ? sql`, 0 AS total_count` : sql`, i.total_count AS total_count`}
    ${stockSums}
    ORDER BY i.name
    ${needsAllStock ? sql`LIMIT ${pageSize} OFFSET ${offset}` : sql``}`);

  // The page query counts all matches in the same pass (window function), so a search is not run twice.
  // An empty page (past the end) has nothing to carry the count, so it is counted on its own.
  const total = needsAllStock
    ? (db.get<{ n: number }>(sql`SELECT count(*) AS n FROM (SELECT i.id ${stockSums})`)?.n ?? 0)
    : (rows[0]?.total_count ??
      db.get<{ n: number }>(sql`SELECT count(*) AS n FROM items i WHERE ${itemWhere}`)?.n ??
      0);

  return {
    total: Number(total),
    rows: rows.map((r) => ({
      itemId: r.id,
      sku: r.sku,
      name: r.name,
      genericName: r.generic_name,
      onHandBase: Number(r.onhand),
      expiredBase: Number(r.expired),
      sellableBase: Number(r.sellable),
      reorderLevelBase: Number(r.reorder),
      low: Number(r.sellable) <= Number(r.reorder),
      nearestExpiry: r.nearest,
      costValueMinor: Number(BigInt(r.value_micro) / 10_000n),
    })),
  };
}

/** Current stock value at batch cost for the branch, in paisa. */
export function stockValueMinor(db: DbOrTx, branchId: string): number {
  const row = db.get<{ v: number }>(
    sql`SELECT COALESCE(SUM(qty_base * unit_cost_micro), 0) AS v FROM stock_movements WHERE branch_id = ${branchId}`,
  );
  return Number(BigInt(row?.v ?? 0) / 10_000n);
}
