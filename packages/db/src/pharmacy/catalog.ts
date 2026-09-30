import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { expiryStatus, type ExpiryStatus } from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { itemBarcodes, itemUnits, items, racks, units } from '../schema/sqlite-all';
import { branchToday, ftsQuery } from './common';
import { getBatchStock } from './stock';

export interface ItemUnitInput {
  unitId: string;
  /** How many smallest units are in one of this unit. The base unit itself is 1. */
  factorToBase: number;
  isDefaultSale?: boolean;
  isDefaultPurchase?: boolean;
}

export interface ItemInput {
  sku?: string;
  name: string;
  genericName?: string | null;
  strength?: string | null;
  dosageForm?: string | null;
  categoryId?: string | null;
  manufacturerId?: string | null;
  rackId?: string | null;
  baseUnitId: string;
  units: ItemUnitInput[];
  barcodes: string[];
  retailRateUnitMicro: number;
  taxBp?: number;
  taxInclusive?: boolean;
  reorderLevelBase?: number;
  isPrescription?: boolean;
  isNarcotic?: boolean;
  isColdChain?: boolean;
  allowNegativeStock?: boolean;
  drapRegNo?: string | null;
  isActive?: boolean;
}

function validate(input: ItemInput): void {
  if (input.name.trim().length < 2) throw new DomainError('INVALID', 'Item name is too short');
  if (!Number.isSafeInteger(input.retailRateUnitMicro) || input.retailRateUnitMicro < 0)
    throw new DomainError('INVALID', 'Retail price is not valid');
  if ((input.taxBp ?? 0) < 0 || (input.taxBp ?? 0) > 10_000)
    throw new DomainError('INVALID', 'Tax rate must be between 0% and 100%');
  const base = input.units.find((u) => u.unitId === input.baseUnitId);
  if (!base || base.factorToBase !== 1)
    throw new DomainError('INVALID', 'The smallest unit must be listed with 1 per unit');
  const seen = new Set<string>();
  for (const u of input.units) {
    if (seen.has(u.unitId)) throw new DomainError('INVALID', 'A unit is listed twice');
    seen.add(u.unitId);
    if (!Number.isSafeInteger(u.factorToBase) || u.factorToBase < 1)
      throw new DomainError('INVALID', 'Units per pack must be a whole number of 1 or more');
  }
  if (!input.units.some((u) => u.isDefaultSale))
    throw new DomainError('INVALID', 'Choose the default selling unit');
  if (new Set(input.barcodes).size !== input.barcodes.length)
    throw new DomainError('INVALID', 'The same barcode is listed twice');
  if (input.barcodes.some((b) => !/^[\x21-\x7e]{3,64}$/.test(b)))
    throw new DomainError('INVALID', 'A barcode has unusual characters or the wrong length');
}

/** Rebuild the search row of one item (name, generic name, barcodes, SKU). Runs in the item's transaction. */
export function indexItem(tx: DbOrTx, itemId: string): void {
  const item = tx.select().from(items).where(eq(items.id, itemId)).get();
  tx.run(sql`DELETE FROM items_fts WHERE item_id = ${itemId}`);
  if (!item || item.deletedAt || !item.isActive) return;
  const codes = tx
    .select({ b: itemBarcodes.barcode })
    .from(itemBarcodes)
    .where(eq(itemBarcodes.itemId, itemId))
    .all()
    .map((r) => r.b)
    .join(' ');
  tx.run(
    sql`INSERT INTO items_fts (item_id, name, generic_name, barcodes, sku) VALUES (${itemId}, ${item.name}, ${item.genericName ?? ''}, ${codes}, ${item.sku})`,
  );
}

/** Rebuild the whole search index (repair tool, and after a restore). */
export function rebuildItemSearch(db: Db): number {
  return db.transaction((tx) => {
    tx.run(sql`DELETE FROM items_fts`);
    const all = tx.select({ id: items.id }).from(items).where(isNull(items.deletedAt)).all();
    all.forEach((i) => indexItem(tx, i.id));
    return all.length;
  });
}

function nextSku(tx: DbOrTx, ctx: WriteContext): string {
  const last = tx
    .select({ sku: items.sku })
    .from(items)
    .where(eq(items.tenantId, ctx.tenantId))
    .orderBy(sql`length(${items.sku}) desc, ${items.sku} desc`)
    .limit(1)
    .get();
  const n = last && /^\d+$/.test(last.sku) ? Number(last.sku) : 10_000;
  return String(n + 1);
}

function assertBarcodesFree(
  tx: DbOrTx,
  ctx: WriteContext,
  barcodes: string[],
  exceptItemId?: string,
): void {
  if (barcodes.length === 0) return;
  const taken = tx
    .select()
    .from(itemBarcodes)
    .where(and(eq(itemBarcodes.tenantId, ctx.tenantId), inArray(itemBarcodes.barcode, barcodes)))
    .all()
    .filter((b) => b.itemId !== exceptItemId);
  if (taken[0])
    throw new DomainError(
      'CONFLICT',
      `Barcode ${taken[0].barcode} already belongs to another item`,
    );
}

export function createItem(db: Db, ctx: WriteContext, input: ItemInput): string {
  validate(input);
  return db.transaction((tx) => {
    const sku = input.sku?.trim() || nextSku(tx, ctx);
    if (
      tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.tenantId, ctx.tenantId), eq(items.sku, sku)))
        .get()
    ) {
      throw new DomainError('CONFLICT', `Item code ${sku} is already used`);
    }
    assertBarcodesFree(tx, ctx, input.barcodes);
    const unitRows = tx
      .select({ id: units.id })
      .from(units)
      .where(
        and(
          eq(units.tenantId, ctx.tenantId),
          inArray(
            units.id,
            input.units.map((u) => u.unitId),
          ),
        ),
      )
      .all();
    if (unitRows.length !== input.units.length)
      throw new DomainError('INVALID', 'One of the units does not exist');

    const now = isoNow(ctx);
    const id = newId();
    const row = {
      id,
      tenantId: ctx.tenantId,
      sku,
      name: input.name.trim(),
      genericName: input.genericName?.trim() || null,
      strength: input.strength ?? null,
      dosageForm: input.dosageForm ?? null,
      categoryId: input.categoryId ?? null,
      manufacturerId: input.manufacturerId ?? null,
      rackId: input.rackId ?? null,
      baseUnitId: input.baseUnitId,
      retailRateUnitMicro: input.retailRateUnitMicro,
      taxBp: input.taxBp ?? 0,
      taxInclusive: input.taxInclusive ?? false,
      reorderLevelBase: input.reorderLevelBase ?? 0,
      isPrescription: input.isPrescription ?? false,
      isNarcotic: input.isNarcotic ?? false,
      isColdChain: input.isColdChain ?? false,
      allowNegativeStock: input.allowNegativeStock ?? false,
      drapRegNo: input.drapRegNo ?? null,
      isActive: input.isActive ?? true,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(items).values(row).run();
    const unitPayload = input.units.map((u) => ({
      id: newId(),
      itemId: id,
      unitId: u.unitId,
      factorToBase: u.factorToBase,
      isDefaultSale: u.isDefaultSale ?? false,
      isDefaultPurchase: u.isDefaultPurchase ?? false,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    }));
    tx.insert(itemUnits).values(unitPayload).run();
    const barcodePayload = input.barcodes.map((barcode) => ({
      id: newId(),
      tenantId: ctx.tenantId,
      itemId: id,
      barcode,
      unitId: null,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    }));
    if (barcodePayload.length) tx.insert(itemBarcodes).values(barcodePayload).run();
    indexItem(tx, id);
    recordChange(tx, ctx, {
      entityType: 'items',
      entityId: id,
      op: 'insert',
      payload: { ...row, units: unitPayload, barcodes: barcodePayload },
    });
    appendAudit(tx, ctx, {
      action: 'item.create',
      entityType: 'item',
      entityId: id,
      newValue: { sku, name: row.name, retailRateUnitMicro: row.retailRateUnitMicro },
    });
    return id;
  });
}

export function updateItem(
  db: Db,
  ctx: WriteContext,
  id: string,
  input: ItemInput & { expectedVersion: number },
): void {
  validate(input);
  db.transaction((tx) => {
    const before = tx
      .select()
      .from(items)
      .where(and(eq(items.id, id), eq(items.tenantId, ctx.tenantId), isNull(items.deletedAt)))
      .get();
    if (!before) throw new DomainError('NOT_FOUND', 'Item not found');
    if (before.version !== input.expectedVersion)
      throw new DomainError(
        'VERSION_CONFLICT',
        'This item was changed by someone else. Reload and try again',
      );
    assertBarcodesFree(tx, ctx, input.barcodes, id);
    const now = isoNow(ctx);
    const change = {
      name: input.name.trim(),
      genericName: input.genericName?.trim() || null,
      strength: input.strength ?? null,
      dosageForm: input.dosageForm ?? null,
      categoryId: input.categoryId ?? null,
      manufacturerId: input.manufacturerId ?? null,
      rackId: input.rackId ?? null,
      retailRateUnitMicro: input.retailRateUnitMicro,
      taxBp: input.taxBp ?? 0,
      taxInclusive: input.taxInclusive ?? false,
      reorderLevelBase: input.reorderLevelBase ?? 0,
      isPrescription: input.isPrescription ?? false,
      isNarcotic: input.isNarcotic ?? false,
      isColdChain: input.isColdChain ?? false,
      allowNegativeStock: input.allowNegativeStock ?? false,
      drapRegNo: input.drapRegNo ?? null,
      isActive: input.isActive ?? true,
      version: before.version + 1,
      updatedAt: now,
      hlc: ctx.clock.tick(),
    };
    tx.update(items).set(change).where(eq(items.id, id)).run();

    // Units already used by stock or sales keep their conversion: changing it would silently change history.
    const oldUnits = tx.select().from(itemUnits).where(eq(itemUnits.itemId, id)).all();
    for (const u of input.units) {
      const existing = oldUnits.find((o) => o.unitId === u.unitId);
      if (existing) {
        if (existing.factorToBase !== u.factorToBase)
          throw new DomainError(
            'CONFLICT',
            'Units per pack cannot be changed once an item exists. Add a new unit instead',
          );
        tx.update(itemUnits)
          .set({
            isDefaultSale: u.isDefaultSale ?? false,
            isDefaultPurchase: u.isDefaultPurchase ?? false,
            updatedAt: now,
            hlc: ctx.clock.tick(),
          })
          .where(eq(itemUnits.id, existing.id))
          .run();
      } else {
        tx.insert(itemUnits)
          .values({
            id: newId(),
            itemId: id,
            unitId: u.unitId,
            factorToBase: u.factorToBase,
            isDefaultSale: u.isDefaultSale ?? false,
            isDefaultPurchase: u.isDefaultPurchase ?? false,
            createdAt: now,
            updatedAt: now,
            hlc: ctx.clock.tick(),
            version: 1,
          })
          .run();
      }
    }
    for (const old of oldUnits)
      if (!input.units.some((u) => u.unitId === old.unitId))
        throw new DomainError(
          'CONFLICT',
          'A unit cannot be removed from an item. Untick it as default instead',
        );

    tx.delete(itemBarcodes).where(eq(itemBarcodes.itemId, id)).run();
    if (input.barcodes.length) {
      tx.insert(itemBarcodes)
        .values(
          input.barcodes.map((barcode) => ({
            id: newId(),
            tenantId: ctx.tenantId,
            itemId: id,
            barcode,
            unitId: null,
            createdAt: now,
            updatedAt: now,
            hlc: ctx.clock.tick(),
            version: 1,
          })),
        )
        .run();
    }
    indexItem(tx, id);
    recordChange(tx, ctx, {
      entityType: 'items',
      entityId: id,
      op: 'update',
      payload: {
        id,
        ...change,
        units: input.units,
        barcodes: input.barcodes,
        baseVersion: before.version,
      },
    });
    appendAudit(tx, ctx, {
      action: 'item.update',
      entityType: 'item',
      entityId: id,
      oldValue: {
        name: before.name,
        retailRateUnitMicro: before.retailRateUnitMicro,
        taxBp: before.taxBp,
        isActive: before.isActive,
      },
      newValue: {
        name: change.name,
        retailRateUnitMicro: change.retailRateUnitMicro,
        taxBp: change.taxBp,
        isActive: change.isActive,
      },
    });
  });
}

export interface ItemDetail {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  categoryId: string | null;
  manufacturerId: string | null;
  rackId: string | null;
  baseUnitId: string;
  retailRateUnitMicro: number;
  taxBp: number;
  taxInclusive: boolean;
  reorderLevelBase: number;
  isPrescription: boolean;
  isNarcotic: boolean;
  isColdChain: boolean;
  allowNegativeStock: boolean;
  drapRegNo: string | null;
  isActive: boolean;
  version: number;
  units: {
    unitId: string;
    name: string;
    factorToBase: number;
    isDefaultSale: boolean;
    isDefaultPurchase: boolean;
  }[];
  barcodes: string[];
}

export function getItem(db: DbOrTx, tenantId: string, id: string): ItemDetail {
  const row = db
    .select()
    .from(items)
    .where(and(eq(items.id, id), eq(items.tenantId, tenantId), isNull(items.deletedAt)))
    .get();
  if (!row) throw new DomainError('NOT_FOUND', 'Item not found');
  return toDetail(db, row);
}

function toDetail(db: DbOrTx, row: typeof items.$inferSelect): ItemDetail {
  const u = db
    .select({
      unitId: itemUnits.unitId,
      name: units.name,
      factorToBase: itemUnits.factorToBase,
      isDefaultSale: itemUnits.isDefaultSale,
      isDefaultPurchase: itemUnits.isDefaultPurchase,
    })
    .from(itemUnits)
    .innerJoin(units, eq(units.id, itemUnits.unitId))
    .where(eq(itemUnits.itemId, row.id))
    .orderBy(asc(itemUnits.factorToBase))
    .all();
  const barcodes = db
    .select({ b: itemBarcodes.barcode })
    .from(itemBarcodes)
    .where(eq(itemBarcodes.itemId, row.id))
    .all()
    .map((r) => r.b);
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    genericName: row.genericName,
    strength: row.strength,
    dosageForm: row.dosageForm,
    categoryId: row.categoryId,
    manufacturerId: row.manufacturerId,
    rackId: row.rackId,
    baseUnitId: row.baseUnitId,
    retailRateUnitMicro: row.retailRateUnitMicro,
    taxBp: row.taxBp,
    taxInclusive: row.taxInclusive,
    reorderLevelBase: row.reorderLevelBase,
    isPrescription: row.isPrescription,
    isNarcotic: row.isNarcotic,
    isColdChain: row.isColdChain,
    allowNegativeStock: row.allowNegativeStock,
    drapRegNo: row.drapRegNo,
    isActive: row.isActive,
    version: row.version,
    units: u,
    barcodes,
  };
}

export interface SearchBatch {
  id: string;
  batchNo: string;
  expiryDate: string;
  available: number;
  costUnitMicro: number;
  expiry: ExpiryStatus;
}

export interface SearchHit extends ItemDetail {
  rackCode: string | null;
  /** Sellable now: not expired, not blocked. */
  sellableBase: number;
  nearestExpiry: string | null;
  matchedByBarcode: boolean;
  batches: SearchBatch[];
}

/**
 * POS item search: exact barcode first (scanner), then prefix full-text over name, generic name,
 * barcodes and code. Each hit carries sellable stock and batches so the counter never guesses.
 */
export function searchItems(db: Db, ctx: WriteContext, text: string, limit = 20): SearchHit[] {
  const q = text.trim();
  if (q.length === 0) return [];
  const today = branchToday(db, ctx);

  const exact = db
    .select({ itemId: itemBarcodes.itemId })
    .from(itemBarcodes)
    .where(and(eq(itemBarcodes.tenantId, ctx.tenantId), eq(itemBarcodes.barcode, q)))
    .get();
  const ids: string[] = exact ? [exact.itemId] : [];

  // Names that START with what was typed come first, straight from an index (what cashiers usually type).
  const lower = q.toLowerCase();
  const prefixed = db.all<{ id: string }>(
    sql`SELECT id FROM items WHERE tenant_id = ${ctx.tenantId} AND lower(name) >= ${lower} AND lower(name) < ${`${lower}￿`}
        AND is_active = 1 AND deleted_at IS NULL ORDER BY lower(name) LIMIT ${limit}`,
  );
  prefixed.forEach((r) => ids.includes(r.id) || ids.push(r.id));

  // Then words anywhere in name, generic name, barcode or code. No relevance ranking on purpose: ranking
  // thousands of matches costs far more than the 100 ms search budget allows on 100k+ items.
  const match = ftsQuery(q);
  if (match && ids.length < limit) {
    const rows = db.all<{ item_id: string }>(
      sql`SELECT item_id FROM items_fts WHERE items_fts MATCH ${match} LIMIT ${limit * 2}`,
    );
    for (const r of rows) if (ids.length < limit && !ids.includes(r.item_id)) ids.push(r.item_id);
  }
  if (ids.length === 0) return [];

  const rows = db
    .select()
    .from(items)
    .where(
      and(
        eq(items.tenantId, ctx.tenantId),
        inArray(items.id, ids.slice(0, limit)),
        eq(items.isActive, true),
        isNull(items.deletedAt),
      ),
    )
    .all();
  const order = new Map(ids.map((id, i) => [id, i]));
  rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));

  return rows.map((row) => {
    const detail = toDetail(db, row);
    const stock = getBatchStock(db, ctx.branchId, row.id);
    const sellable = stock.filter((b) => !b.isBlocked && b.available > 0 && b.expiryDate >= today);
    const rack = row.rackId
      ? db.select({ code: racks.code }).from(racks).where(eq(racks.id, row.rackId)).get()
      : undefined;
    return {
      ...detail,
      rackCode: rack?.code ?? null,
      sellableBase: sellable.reduce((s, b) => s + b.available, 0),
      nearestExpiry: sellable[0]?.expiryDate ?? null,
      matchedByBarcode: exact?.itemId === row.id,
      batches: stock
        .filter((b) => b.available > 0)
        .map((b) => ({
          id: b.id,
          batchNo: b.batchNo,
          expiryDate: b.expiryDate,
          available: b.available,
          costUnitMicro: b.costUnitMicro,
          expiry: expiryStatus(b.expiryDate, today),
        })),
    };
  });
}
