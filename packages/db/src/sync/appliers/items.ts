import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { newId, type PulledChange } from '@mediescare/sync';
import type { DbOrTx } from '../../client';
import { indexItem } from '../../pharmacy/catalog';
import {
  categories,
  itemBarcodes,
  itemUnits,
  items,
  manufacturers,
  units,
} from '../../schema/sqlite-all';
import {
  isoOfHlc,
  fromHeadOffice,
  maxHlc,
  mergeFields,
  payloadOf,
  readFields,
  requireRow,
  resultOf,
  type FieldSpec,
  type MergeRules,
} from './common';
import {
  APPLY_ORDER,
  registerApplier,
  type ApplyDetail,
  type EntityApplier,
  type FieldConflictNote,
} from './registry';

/**
 * Items. What is taken from a pulled item and what stays with the branch:
 *
 * - Head Office owns the price policy: `retailRateUnitMicro`, `taxBp`, `taxInclusive`. They are applied
 *   from a Head Office event whatever the local clock says. (`maxDiscountBp` is in the cloud's list
 *   but items have no such column yet, so there is nothing to apply.)
 * - Branch-local: `reorderLevelBase` and `allowNegativeStock` are copied when the item first arrives
 *   and are never overwritten afterwards. `rackId` is never taken (racks are local to a branch, so the
 *   item starts without a rack there).
 * - `sku` and `baseUnitId` are fixed when the item is created.
 * - Everything else (name, generic name, category, barcodes, flags) is last-writer-wins by HLC.
 */
const ITEM_SPEC: FieldSpec = {
  sku: 's',
  name: 's',
  genericName: 'sn',
  strength: 'sn',
  dosageForm: 'sn',
  categoryId: 'sn',
  manufacturerId: 'sn',
  baseUnitId: 's',
  retailRateUnitMicro: 'i',
  taxBp: 'i',
  taxInclusive: 'b',
  reorderLevelBase: 'i',
  isPrescription: 'b',
  isNarcotic: 'b',
  isColdChain: 'b',
  allowNegativeStock: 'b',
  drapRegNo: 'sn',
  isActive: 'b',
};

export const ITEM_PRICE_FIELDS = ['retailRateUnitMicro', 'taxBp', 'taxInclusive'] as const;
export const ITEM_BRANCH_LOCAL_FIELDS = ['reorderLevelBase', 'allowNegativeStock'] as const;
const ITEM_RULES: MergeRules = {
  price: ITEM_PRICE_FIELDS,
  branchLocal: [...ITEM_BRANCH_LOCAL_FIELDS, 'sku', 'baseUnitId'],
};

interface UnitIn {
  id: string;
  unitId: string;
  factorToBase: number;
  isDefaultSale: boolean;
  isDefaultPurchase: boolean;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Units of a payload: the create shape has ids, the update shape only unit id and factor. */
function unitsOf(p: Record<string, unknown>): UnitIn[] | null {
  if (!Array.isArray(p.units)) return null;
  const out: UnitIn[] = [];
  for (const u of p.units) {
    if (!isRecord(u) || typeof u.unitId !== 'string') continue;
    if (
      typeof u.factorToBase !== 'number' ||
      !Number.isSafeInteger(u.factorToBase) ||
      u.factorToBase < 1
    )
      continue;
    out.push({
      id: typeof u.id === 'string' ? u.id : newId(),
      unitId: u.unitId,
      factorToBase: u.factorToBase,
      isDefaultSale: u.isDefaultSale === true,
      isDefaultPurchase: u.isDefaultPurchase === true,
    });
  }
  return out;
}

/** Barcodes of a payload: objects (create) or plain strings (update). */
function barcodesOf(p: Record<string, unknown>): string[] | null {
  if (!Array.isArray(p.barcodes)) return null;
  const out = new Set<string>();
  for (const b of p.barcodes) {
    const code =
      typeof b === 'string' ? b : isRecord(b) && typeof b.barcode === 'string' ? b.barcode : null;
    if (code && /^[\x21-\x7e]{3,64}$/.test(code)) out.add(code);
  }
  return [...out];
}

function requireParents(
  tx: DbOrTx,
  env: Parameters<EntityApplier>[2],
  fields: Record<string, unknown>,
  unitList: UnitIn[] | null,
): void {
  if (typeof fields.categoryId === 'string')
    requireRow(tx, env, categories, 'categories', fields.categoryId);
  if (typeof fields.manufacturerId === 'string')
    requireRow(tx, env, manufacturers, 'manufacturers', fields.manufacturerId);
  if (typeof fields.baseUnitId === 'string') requireRow(tx, env, units, 'units', fields.baseUnitId);
  for (const u of unitList ?? []) requireRow(tx, env, units, 'units', u.unitId);
}

/** Barcodes held by other items: a pulled item never steals a barcode (the local holder keeps it). */
function takenByOthers(tx: DbOrTx, tenantId: string, itemId: string, codes: string[]): Set<string> {
  if (codes.length === 0) return new Set();
  return new Set(
    tx
      .select({ b: itemBarcodes.barcode })
      .from(itemBarcodes)
      .where(
        and(
          eq(itemBarcodes.tenantId, tenantId),
          inArray(itemBarcodes.barcode, codes),
          ne(itemBarcodes.itemId, itemId),
        ),
      )
      .all()
      .map((r) => r.b),
  );
}

/** Search row for a NEW item: a plain insert (the delete in `indexItem` would scan the whole index). */
function indexNewItem(tx: DbOrTx, row: typeof items.$inferInsert, codes: string[]): void {
  if (!row.isActive) return;
  tx.run(
    sql`INSERT INTO items_fts (item_id, name, generic_name, barcodes, sku) VALUES (${row.id}, ${row.name}, ${row.genericName ?? ''}, ${codes.join(' ')}, ${row.sku})`,
  );
}

function createItem(
  tx: DbOrTx,
  change: PulledChange,
  env: Parameters<EntityApplier>[2],
  p: Record<string, unknown>,
  incoming: Record<string, unknown>,
  wall: string,
): ApplyDetail | 'skipped' {
  const id = change.event.entityId;
  const unitList = unitsOf(p);
  if (
    typeof incoming.sku !== 'string' ||
    typeof incoming.name !== 'string' ||
    typeof incoming.baseUnitId !== 'string' ||
    !unitList ||
    unitList.length === 0
  )
    return 'skipped'; // malformed: never stall the pull on it
  requireParents(tx, env, incoming, unitList);

  const skuTaken = tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.tenantId, env.tenantId), eq(items.sku, incoming.sku), ne(items.id, id)))
    .get();
  if (skuTaken)
    return {
      outcome: 'conflict',
      conflicts: [
        { field: 'sku', reason: 'unique_key_taken', kept: null, discarded: incoming.sku },
      ],
    };

  const row = {
    ...incoming,
    id,
    tenantId: env.tenantId,
    rackId: null,
    deletedAt: null,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : wall,
    updatedAt: wall,
    hlc: change.event.hlc,
    version: 1,
  } as typeof items.$inferInsert;
  tx.insert(items).values(row).run();
  tx.insert(itemUnits)
    .values(
      unitList.map((u) => ({
        ...u,
        itemId: id,
        createdAt: wall,
        updatedAt: wall,
        hlc: change.event.hlc,
        version: 1,
      })),
    )
    .onConflictDoNothing()
    .run();

  const wanted = barcodesOf(p) ?? [];
  const taken = takenByOthers(tx, env.tenantId, id, wanted);
  const codes = wanted.filter((b) => !taken.has(b));
  if (codes.length)
    tx.insert(itemBarcodes)
      .values(
        codes.map((barcode) => ({
          id: newId(),
          tenantId: env.tenantId,
          itemId: id,
          barcode,
          unitId: null,
          createdAt: wall,
          updatedAt: wall,
          hlc: change.event.hlc,
          version: 1,
        })),
      )
      .run();
  indexNewItem(tx, row, codes);
  const conflicts: FieldConflictNote[] = [...taken].map((b) => ({
    field: 'barcode',
    reason: 'unique_key_taken' as const,
    kept: null,
    discarded: b,
  }));
  return resultOf(null, true, conflicts);
}

function updateItem(
  tx: DbOrTx,
  change: PulledChange,
  env: Parameters<EntityApplier>[2],
  current: typeof items.$inferSelect,
  p: Record<string, unknown>,
  incoming: Record<string, unknown>,
  originIsHeadOffice: boolean,
  wall: string,
): ApplyDetail | 'skipped' {
  if (current.deletedAt) return 'skipped'; // voided here: a pulled edit does not bring it back
  const { event } = change;
  const unitList = unitsOf(p);
  requireParents(tx, env, incoming, unitList);

  const merge = mergeFields(
    current as unknown as Record<string, unknown>,
    incoming,
    event.hlc,
    current.hlc,
    originIsHeadOffice,
    ITEM_RULES,
  );
  const conflicts = [...merge.conflicts];
  let touched = Object.keys(merge.set).length > 0;
  const lastWriterWins = event.hlc > current.hlc;

  // Units: new ones are added, an existing one keeps its factor (history depends on it).
  if (unitList) {
    const have = tx.select().from(itemUnits).where(eq(itemUnits.itemId, current.id)).all();
    for (const u of unitList) {
      const existing = have.find((h) => h.unitId === u.unitId);
      if (!existing) {
        tx.insert(itemUnits)
          .values({
            ...u,
            itemId: current.id,
            createdAt: wall,
            updatedAt: wall,
            hlc: event.hlc,
            version: 1,
          })
          .onConflictDoNothing()
          .run();
        touched = true;
      } else if (existing.factorToBase !== u.factorToBase) {
        conflicts.push({
          field: 'units.factorToBase',
          reason: 'branch_local_field',
          kept: existing.factorToBase,
          discarded: u.factorToBase,
        });
      } else if (
        lastWriterWins &&
        (existing.isDefaultSale !== u.isDefaultSale ||
          existing.isDefaultPurchase !== u.isDefaultPurchase)
      ) {
        tx.update(itemUnits)
          .set({
            isDefaultSale: u.isDefaultSale,
            isDefaultPurchase: u.isDefaultPurchase,
            updatedAt: wall,
            hlc: event.hlc,
          })
          .where(eq(itemUnits.id, existing.id))
          .run();
        touched = true;
      }
    }
  }

  // Barcodes: the whole list is replaced when this event is the newest word on the item.
  let barcodesChanged = false;
  const wanted = barcodesOf(p);
  if (wanted) {
    const have = tx
      .select({ id: itemBarcodes.id, b: itemBarcodes.barcode })
      .from(itemBarcodes)
      .where(eq(itemBarcodes.itemId, current.id))
      .all();
    const haveSet = new Set(have.map((h) => h.b));
    const differs = wanted.length !== haveSet.size || wanted.some((b) => !haveSet.has(b));
    if (differs && lastWriterWins) {
      const taken = takenByOthers(tx, env.tenantId, current.id, wanted);
      const keep = wanted.filter((b) => !taken.has(b));
      const remove = have.filter((h) => !keep.includes(h.b));
      if (remove.length)
        tx.delete(itemBarcodes)
          .where(
            inArray(
              itemBarcodes.id,
              remove.map((r) => r.id),
            ),
          )
          .run();
      const add = keep.filter((b) => !haveSet.has(b));
      if (add.length)
        tx.insert(itemBarcodes)
          .values(
            add.map((barcode) => ({
              id: newId(),
              tenantId: env.tenantId,
              itemId: current.id,
              barcode,
              unitId: null,
              createdAt: wall,
              updatedAt: wall,
              hlc: event.hlc,
              version: 1,
            })),
          )
          .run();
      for (const b of taken)
        conflicts.push({ field: 'barcode', reason: 'unique_key_taken', kept: null, discarded: b });
      barcodesChanged = remove.length > 0 || add.length > 0;
      touched ||= barcodesChanged;
    }
  }

  if (touched) {
    tx.update(items)
      .set({
        ...merge.set,
        hlc: maxHlc(event.hlc, current.hlc),
        updatedAt: wall,
        version: current.version + 1,
      })
      .where(eq(items.id, current.id))
      .run();
    const searchChanged =
      barcodesChanged ||
      'name' in merge.set ||
      'genericName' in merge.set ||
      'isActive' in merge.set;
    if (searchChanged) indexItem(tx, current.id);
  }
  return {
    outcome: conflicts.length > 0 ? 'conflict' : touched ? 'applied' : 'skipped',
    oldValue: merge.old,
    newValue: merge.set,
    ...(conflicts.length ? { conflicts } : {}),
  };
}

/** An update whose item row does not exist here (delivered before its insert): it cannot be built from the update alone. */
function missingRow(): ApplyDetail {
  return {
    outcome: 'conflict',
    conflicts: [
      {
        field: 'row',
        reason: 'last_writer_wins',
        kept: null,
        discarded: 'update arrived before the item was created',
      },
    ],
  };
}

export const applyItem: EntityApplier = (tx, change, env) => {
  const { event } = change;
  const p = payloadOf(change);
  if (!p) return 'skipped';
  const id = event.entityId;
  const current = tx.select().from(items).where(eq(items.id, id)).get();
  const wall = isoOfHlc(event.hlc);

  if (event.op === 'void') {
    if (!current || current.deletedAt) return 'skipped';
    tx.update(items)
      .set({
        deletedAt: wall,
        isActive: false,
        hlc: maxHlc(event.hlc, current.hlc),
        updatedAt: wall,
        version: current.version + 1,
      })
      .where(eq(items.id, id))
      .run();
    indexItem(tx, id);
    return { outcome: 'applied', oldValue: { deletedAt: null }, newValue: { deletedAt: wall } };
  }

  const incoming = readFields(p, ITEM_SPEC);
  const result = current
    ? updateItem(tx, change, env, current, p, incoming, fromHeadOffice(tx, env, change), wall)
    : event.op === 'update'
      ? missingRow()
      : createItem(tx, change, env, p, incoming, wall);
  return result;
};

registerApplier('items', applyItem, { order: APPLY_ORDER.items });
