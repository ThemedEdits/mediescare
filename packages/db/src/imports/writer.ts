import type Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';
import { unitRateFromPack } from '@mediescare/core';
import { newId, SYNC_SCHEMA_VERSION } from '@mediescare/sync';
import type { Db } from '../client';
import { isoNow, type WriteContext } from '../context';
import { mainStoreId } from '../pharmacy/stock';
import { categories, items, manufacturers, racks, units } from '../schema/sqlite-all';
import type { PreparedRow } from './types';

export interface MasterCounts {
  units: number;
  categories: number;
  manufacturers: number;
  racks: number;
}

export type RowOutcome = 'created' | 'exists';

type StatementName =
  | 'maxSeq'
  | 'barcode'
  | 'unit'
  | 'category'
  | 'manufacturer'
  | 'rack'
  | 'item'
  | 'itemUnit'
  | 'itemBarcode'
  | 'fts'
  | 'batch'
  | 'movement'
  | 'outbox';

export interface StockPlan {
  importStock: boolean;
  /** Expiry used when the row has none. */
  defaultExpiry: string | null;
  today: string;
  importId: string;
}

export interface WriterTally {
  openingBatches: number;
  openingSkipped: number;
}

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30) || 'unit';

/**
 * Writes prepared rows with raw prepared statements (about 10x faster than the per-item service for
 * tens of thousands of rows). It writes exactly what createItem writes: item, units, barcodes, search
 * row and one outbox row per created record, so the sync worker sees imported items like any other.
 * Call `write` only inside a transaction, and `beginChunk` first in that transaction.
 */
export class ItemWriter {
  readonly counts: MasterCounts = { units: 0, categories: 0, manufacturers: 0, racks: 0 };
  readonly tally: WriterTally = { openingBatches: 0, openingSkipped: 0 };

  private readonly unitIds = new Map<string, string>();
  private readonly unitCodes = new Set<string>();
  private readonly categoryIds = new Map<string, string>();
  private readonly manufacturerIds = new Map<string, string>();
  private readonly rackIds = new Map<string, string>();
  private readonly usedSkus = new Set<string>();
  private nextSkuNumber: number;
  private seq = 0;
  private now = '';
  private hlc = '';
  private readonly storeId: string;

  private readonly st: Record<StatementName, Database.Statement>;

  constructor(
    private readonly db: Db,
    private readonly ctx: WriteContext,
    private readonly stock: StockPlan,
  ) {
    // Drizzle keeps the driver connection on $client at runtime but does not type it for this wrapper.
    const raw = (db as unknown as { $client: Database.Database }).$client;
    const t = ctx.tenantId;
    db.select()
      .from(units)
      .where(eq(units.tenantId, t))
      .all()
      .forEach((u) => {
        this.unitIds.set(u.name.toLowerCase(), u.id);
        this.unitIds.set(u.code.toLowerCase(), u.id);
        this.unitCodes.add(u.code);
      });
    db.select()
      .from(categories)
      .where(eq(categories.tenantId, t))
      .all()
      .forEach((c) => {
        this.categoryIds.set(c.name.toLowerCase(), c.id);
      });
    db.select()
      .from(manufacturers)
      .where(eq(manufacturers.tenantId, t))
      .all()
      .forEach((m) => {
        this.manufacturerIds.set(m.name.toLowerCase(), m.id);
      });
    db.select()
      .from(racks)
      .where(and(eq(racks.tenantId, t), eq(racks.branchId, ctx.branchId)))
      .all()
      .forEach((r) => {
        this.rackIds.set(r.code.toUpperCase(), r.id);
      });
    let maxNumeric = 10_000;
    db.select({ sku: items.sku })
      .from(items)
      .where(eq(items.tenantId, t))
      .all()
      .forEach(({ sku }) => {
        this.usedSkus.add(sku);
        if (/^\d{1,15}$/.test(sku)) maxNumeric = Math.max(maxNumeric, Number(sku));
      });
    this.nextSkuNumber = maxNumeric;
    this.storeId = stock.importStock ? mainStoreId(db, ctx) : '';

    this.st = {
      maxSeq: raw.prepare('SELECT max(seq) FROM sync_outbox').pluck(),
      barcode: raw
        .prepare('SELECT 1 FROM item_barcodes WHERE tenant_id = ? AND barcode = ?')
        .pluck(),
      unit: raw.prepare(
        'INSERT INTO units (id, tenant_id, code, name, created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,?,1)',
      ),
      category: raw.prepare(
        'INSERT INTO categories (id, tenant_id, parent_id, name, created_at, updated_at, hlc, version) VALUES (?,?,NULL,?,?,?,?,1)',
      ),
      manufacturer: raw.prepare(
        'INSERT INTO manufacturers (id, tenant_id, name, created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,1)',
      ),
      rack: raw.prepare(
        'INSERT INTO racks (id, tenant_id, branch_id, code, created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,?,1)',
      ),
      item: raw.prepare(
        `INSERT INTO items (id, tenant_id, sku, name, generic_name, category_id, manufacturer_id, rack_id, base_unit_id,
           retail_rate_unit_micro, tax_bp, reorder_level_base, is_prescription, is_narcotic, is_active,
           created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`,
      ),
      itemUnit: raw.prepare(
        'INSERT INTO item_units (id, item_id, unit_id, factor_to_base, is_default_sale, is_default_purchase, created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,?,?,?,1)',
      ),
      itemBarcode: raw.prepare(
        'INSERT INTO item_barcodes (id, tenant_id, item_id, barcode, created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,?,1)',
      ),
      fts: raw.prepare(
        'INSERT INTO items_fts (item_id, name, generic_name, barcodes, sku) VALUES (?,?,?,?,?)',
      ),
      batch: raw.prepare(
        `INSERT INTO batches (id, tenant_id, branch_id, item_id, batch_no, expiry_date, cost_unit_micro, mrp_unit_micro,
           is_blocked, origin_doc_type, origin_doc_id, created_at, updated_at, hlc, version)
           VALUES (?,?,?,?,?,?,?,0,0,'opening',?,?,?,?,1)`,
      ),
      movement: raw.prepare(
        `INSERT INTO stock_movements (id, tenant_id, branch_id, store_id, item_id, batch_id, kind, qty_base, unit_cost_micro,
           doc_type, doc_id, occurred_at, user_id, hlc, created_at) VALUES (?,?,?,?,?,?,'opening',?,?,'opening',?,?,?,?,?)`,
      ),
      outbox: raw.prepare(
        `INSERT INTO sync_outbox (id, seq, tenant_id, branch_id, device_id, entity_type, entity_id, op, payload_json, hlc, schema_version, created_at)
           VALUES (?,?,?,?,?,?,?,'insert',?,?,?,?)`,
      ),
    };
  }

  /** Start of a chunk transaction: fresh outbox position and timestamp. */
  beginChunk(): void {
    this.seq = (this.st.maxSeq.get() as number | null) ?? 0;
    this.now = isoNow(this.ctx);
  }

  private queue(entityType: string, entityId: string, payload: unknown): void {
    this.st.outbox.run(
      newId(),
      ++this.seq,
      this.ctx.tenantId,
      this.ctx.branchId,
      this.ctx.deviceId,
      entityType,
      entityId,
      JSON.stringify(payload),
      this.hlc,
      SYNC_SCHEMA_VERSION,
      this.now,
    );
  }

  private unitId(name: string, code = slug(name)): string {
    const found = this.unitIds.get(name.toLowerCase());
    if (found) return found;
    let unique = code;
    for (let n = 2; this.unitCodes.has(unique); n++) unique = `${code}_${n}`;
    const id = newId();
    this.st.unit.run(id, this.ctx.tenantId, unique, name, this.now, this.now, this.hlc);
    this.queue('units', id, {
      id,
      tenantId: this.ctx.tenantId,
      code: unique,
      name,
      createdAt: this.now,
      updatedAt: this.now,
      hlc: this.hlc,
      version: 1,
    });
    this.unitIds.set(name.toLowerCase(), id);
    this.unitIds.set(unique.toLowerCase(), id);
    this.unitCodes.add(unique);
    this.counts.units++;
    return id;
  }

  private looseUnitId(): string {
    return (
      this.unitIds.get('loose unit') ??
      this.unitIds.get('loose') ??
      this.unitId('Loose unit', 'loose')
    );
  }

  private categoryId(name: string): string {
    const found = this.categoryIds.get(name.toLowerCase());
    if (found) return found;
    const id = newId();
    this.st.category.run(id, this.ctx.tenantId, name, this.now, this.now, this.hlc);
    this.queue('categories', id, {
      id,
      tenantId: this.ctx.tenantId,
      parentId: null,
      name,
      createdAt: this.now,
      updatedAt: this.now,
      hlc: this.hlc,
      version: 1,
    });
    this.categoryIds.set(name.toLowerCase(), id);
    this.counts.categories++;
    return id;
  }

  private manufacturerId(name: string): string {
    const found = this.manufacturerIds.get(name.toLowerCase());
    if (found) return found;
    const id = newId();
    this.st.manufacturer.run(id, this.ctx.tenantId, name, this.now, this.now, this.hlc);
    this.queue('manufacturers', id, {
      id,
      tenantId: this.ctx.tenantId,
      name,
      createdAt: this.now,
      updatedAt: this.now,
      hlc: this.hlc,
      version: 1,
    });
    this.manufacturerIds.set(name.toLowerCase(), id);
    this.counts.manufacturers++;
    return id;
  }

  private rackId(code: string): string {
    const found = this.rackIds.get(code);
    if (found) return found;
    const id = newId();
    const { tenantId, branchId } = this.ctx;
    this.st.rack.run(id, tenantId, branchId, code, this.now, this.now, this.hlc);
    this.queue('racks', id, {
      id,
      tenantId,
      branchId,
      code,
      createdAt: this.now,
      updatedAt: this.now,
      hlc: this.hlc,
      version: 1,
    });
    this.rackIds.set(code, id);
    this.counts.racks++;
    return id;
  }

  private sku(wanted: string | null): string {
    let sku = wanted;
    if (!sku || this.usedSkus.has(sku)) {
      do sku = String(++this.nextSkuNumber);
      while (this.usedSkus.has(sku));
    }
    this.usedSkus.add(sku);
    return sku;
  }

  write(row: PreparedRow): RowOutcome {
    const { tenantId } = this.ctx;
    // The file may be old: someone could have added this barcode since the preview.
    if (row.barcode && this.st.barcode.get(tenantId, row.barcode)) return 'exists';
    this.hlc = this.ctx.clock.tick();
    const { now, hlc } = this;

    // A pack of N units is sold and bought as the pack; the smallest unit is "Loose unit".
    let baseUnitId: string;
    let packUnitId: string;
    if (row.packSize > 1) {
      baseUnitId = this.looseUnitId();
      packUnitId = this.unitId(row.unitName ?? 'Pack');
      if (packUnitId === baseUnitId) packUnitId = this.unitId('Pack');
    } else {
      baseUnitId = packUnitId = this.unitId(row.unitName ?? 'Piece');
    }
    const categoryId = row.category ? this.categoryId(row.category) : null;
    const manufacturerId = row.manufacturer ? this.manufacturerId(row.manufacturer) : null;
    const rackId = row.rack ? this.rackId(row.rack) : null;
    const sku = this.sku(row.sku);
    const id = newId();

    this.st.item.run(
      id,
      tenantId,
      sku,
      row.name,
      row.genericName,
      categoryId,
      manufacturerId,
      rackId,
      baseUnitId,
      row.retailRateUnitMicro,
      row.taxBp,
      row.reorderLevelBase,
      row.isPrescription ? 1 : 0,
      row.isNarcotic ? 1 : 0,
      row.isActive ? 1 : 0,
      now,
      now,
      hlc,
    );
    const unitRows = (
      row.packSize > 1
        ? [
            { unitId: baseUnitId, factorToBase: 1, isDefaultSale: false, isDefaultPurchase: false },
            {
              unitId: packUnitId,
              factorToBase: row.packSize,
              isDefaultSale: true,
              isDefaultPurchase: true,
            },
          ]
        : [{ unitId: baseUnitId, factorToBase: 1, isDefaultSale: true, isDefaultPurchase: true }]
    ).map((u) => ({
      id: newId(),
      itemId: id,
      ...u,
      createdAt: now,
      updatedAt: now,
      hlc,
      version: 1,
    }));
    for (const u of unitRows)
      this.st.itemUnit.run(
        u.id,
        id,
        u.unitId,
        u.factorToBase,
        u.isDefaultSale ? 1 : 0,
        u.isDefaultPurchase ? 1 : 0,
        now,
        now,
        hlc,
      );
    const barcodeRows = row.barcode
      ? [
          {
            id: newId(),
            tenantId,
            itemId: id,
            barcode: row.barcode,
            unitId: null,
            createdAt: now,
            updatedAt: now,
            hlc,
            version: 1,
          },
        ]
      : [];
    for (const b of barcodeRows)
      this.st.itemBarcode.run(b.id, tenantId, id, b.barcode, now, now, hlc);
    if (row.isActive) this.st.fts.run(id, row.name, row.genericName ?? '', row.barcode ?? '', sku);

    this.queue('items', id, {
      id,
      tenantId,
      sku,
      name: row.name,
      genericName: row.genericName,
      strength: null,
      dosageForm: null,
      categoryId,
      manufacturerId,
      rackId,
      baseUnitId,
      retailRateUnitMicro: row.retailRateUnitMicro,
      taxBp: row.taxBp,
      taxInclusive: false,
      reorderLevelBase: row.reorderLevelBase,
      isPrescription: row.isPrescription,
      isNarcotic: row.isNarcotic,
      isColdChain: false,
      allowNegativeStock: false,
      drapRegNo: null,
      isActive: row.isActive,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      hlc,
      version: 1,
      units: unitRows,
      barcodes: barcodeRows,
    });
    this.openingStock(row, id);
    return 'created';
  }

  private openingStock(row: PreparedRow, itemId: string): void {
    if (!this.stock.importStock || row.quantityBase <= 0) return;
    const expiry = row.expiryDate ?? this.stock.defaultExpiry;
    const cost = row.costPackMicro ? unitRateFromPack(row.costPackMicro, row.packSize) : 0;
    // Cost is never guessed and expired stock is never received (same rule as a goods receipt).
    if (cost <= 0 || !expiry || expiry < this.stock.today) {
      this.tally.openingSkipped++;
      return;
    }
    const { tenantId, branchId, userId } = this.ctx;
    const { now, hlc } = this;
    const batchId = newId();
    const batchNo = row.batchNo ?? 'OPENING';
    this.st.batch.run(
      batchId,
      tenantId,
      branchId,
      itemId,
      batchNo,
      expiry,
      cost,
      this.stock.importId,
      now,
      now,
      hlc,
    );
    const movementId = newId();
    this.st.movement.run(
      movementId,
      tenantId,
      branchId,
      this.storeId,
      itemId,
      batchId,
      row.quantityBase,
      cost,
      this.stock.importId,
      now,
      userId,
      hlc,
      now,
    );
    this.queue('batches', batchId, {
      id: batchId,
      tenantId,
      branchId,
      itemId,
      batchNo,
      mfgDate: null,
      expiryDate: expiry,
      costUnitMicro: cost,
      mrpUnitMicro: 0,
      supplierId: null,
      isBlocked: false,
      originDocType: 'opening',
      originDocId: this.stock.importId,
      createdAt: now,
      updatedAt: now,
      hlc,
      version: 1,
      movements: [
        {
          id: movementId,
          itemId,
          batchId,
          kind: 'opening',
          qtyBase: row.quantityBase,
          unitCostMicro: cost,
          docId: this.stock.importId,
        },
      ],
    });
    this.tally.openingBatches++;
  }
}
