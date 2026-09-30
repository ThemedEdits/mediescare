/**
 * Two real databases (Head Office and branch KHI02-style) of one organisation, the real outbox
 * worker and the real pull, joined by the in-memory cloud. Proves master data flows down and is
 * applied correctly. It does NOT prove anything about a real network or Postgres cloud.
 */
import { and, count, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MASTER_ENTITIES, FakeCloud, type FakeConnection } from '@mediescare/sync';
import { verifyAuditChain } from '../../audit';
import { DomainError } from '../../errors';
import { createItem, getItem, searchItems, updateItem } from '../../pharmacy/catalog';
import { createCategory, createManufacturer, createSupplier } from '../../pharmacy/lookups';
import {
  auditLog,
  categories,
  itemBarcodes,
  items,
  itemUnits,
  suppliers,
  syncCursors,
  syncOutbox,
  units,
} from '../../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../../test-helpers';
import { pushOutbox } from '../../syncWorker';
import { getCursors, pullChanges, resetCursors } from '../pull';
import { authOf } from '../test-support';
import {
  applierFor,
  createItemAt,
  createJoinedBranchEnv,
  itemInputFor,
  pullTypes,
  rateOf,
} from './test-env';
import { createChangeApplier } from './change-applier';

let ho: TestEnv;
let br: TestEnv;
let cloud: FakeCloud;
let hoConn: FakeConnection;
let brConn: FakeConnection;

const cloudNow = () => ho.clock.ms;
const hoCtx = () => ho.ctx(ho.setup.adminUserId);
const brCtx = () => br.ctx(br.setup.adminUserId);

async function pushAll(env: TestEnv, conn: FakeConnection): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const r = await pushOutbox(env.db, conn, {
      now: () => new Date(env.clock.ms),
      random: () => 0.5,
      batchSize: 100,
    });
    if (r.acked + r.rejected === 0) return;
  }
}

async function pullInto(env: TestEnv, conn: FakeConnection, limit = 200) {
  return pullChanges(env.db, conn, {
    entityTypes: pullTypes(),
    apply: applierFor(env),
    limit,
    maxPages: 10_000,
    now: () => new Date(env.clock.ms),
  });
}

const count_ = (env: TestEnv, table: string): number =>
  env.db.get<{ n: number }>(sql.raw(`SELECT count(*) AS n FROM ${table}`))?.n ?? 0;

beforeEach(async () => {
  ho = await createTestEnv();
  br = await createJoinedBranchEnv(ho, { code: 'KHI02', name: 'Test Branch Two' });
  // The branch registry must be a master entity in the cloud, otherwise it only reaches its own branch.
  cloud = new FakeCloud({
    now: cloudNow,
    masterEntities: [...DEFAULT_MASTER_ENTITIES, 'branches'],
  });
  hoConn = cloud.connect(authOf(ho, true));
  brConn = cloud.connect(authOf(br, false));
});
afterEach(() => {
  ho.cleanup();
  br.cleanup();
});

describe('master data flows from Head Office down to a branch', () => {
  it('applies lookups, items with units and barcodes, and the search works on the branch', async () => {
    const cat = createCategory(ho.db, hoCtx(), 'Antibiotics');
    const maker = createManufacturer(ho.db, hoCtx(), 'Test Pharma Ltd');
    createSupplier(ho.db, hoCtx(), {
      name: 'Test Distributor',
      termsDays: 30,
      creditLimitMinor: 5_000_00,
    });
    const id = createItemAt(ho, {
      name: 'Amoxicillin 500mg Capsule',
      genericName: 'Amoxicillin',
      categoryId: cat,
      manufacturerId: maker,
      barcodes: ['8961009990001'],
      retailRateUnitMicro: rateOf('12.50'),
      taxBp: 1700,
      reorderLevelBase: 40,
    });
    await pushAll(ho, hoConn);

    const outboxBefore = count_(br, 'sync_outbox');
    const summary = await pullInto(br, brConn);
    expect(summary.blocked).toEqual({});
    expect(summary.applied).toBeGreaterThan(10);

    // HO's unit rows were adopted with the same ids.
    const hoUnits = ho.db.select().from(units).all();
    const brUnits = br.db.select().from(units).all();
    expect(brUnits.map((u) => u.id).sort()).toEqual(hoUnits.map((u) => u.id).sort());

    const item = getItem(br.db, br.setup.tenantId, id);
    expect(item.name).toBe('Amoxicillin 500mg Capsule');
    expect(item.retailRateUnitMicro).toBe(rateOf('12.50'));
    expect(item.taxBp).toBe(1700);
    expect(item.reorderLevelBase).toBe(40); // copied when the item first arrives
    expect(item.rackId).toBeNull(); // racks are local
    expect(item.units.map((u) => u.factorToBase)).toEqual([1, 10]);
    expect(item.barcodes).toEqual(['8961009990001']);
    expect(
      br.db
        .select()
        .from(suppliers)
        .all()
        .map((s) => s.name),
    ).toContain('Test Distributor');
    const supplier = br.db
      .select()
      .from(suppliers)
      .where(eq(suppliers.name, 'Test Distributor'))
      .get();
    expect(supplier?.openingBalanceMinor).toBe(0);

    // POS search on the branch: by barcode, by name prefix and by a word inside the name.
    expect(searchItems(br.db, brCtx(), '8961009990001')[0]?.id).toBe(id);
    expect(searchItems(br.db, brCtx(), 'amox')[0]?.id).toBe(id);
    expect(searchItems(br.db, brCtx(), 'capsule')[0]?.id).toBe(id);

    // A pulled change is never pushed back: the branch outbox only gained rows for its own writes (none).
    expect(count_(br, 'sync_outbox')).toBe(outboxBefore);
    expect(
      br.db.select().from(syncOutbox).where(eq(syncOutbox.entityType, 'items')).all(),
    ).toHaveLength(0);

    expect(verifyAuditChain(ho.db, ho.setup.branchId).ok).toBe(true);
    expect(verifyAuditChain(br.db, br.setup.branchId).ok).toBe(true);
    const applyAudit = br.db.select().from(auditLog).where(eq(auditLog.action, 'sync.apply')).all();
    expect(applyAudit.length).toBeGreaterThan(0);
  });

  it('receives the branch registry, including itself and Head Office', async () => {
    await pushAll(ho, hoConn);
    await pullInto(br, brConn);
    const rows = br.db.all<{ code: string; is_head_office: number }>(
      sql`SELECT code, is_head_office FROM branches ORDER BY code`,
    );
    expect(rows).toEqual([
      { code: 'KHI01', is_head_office: 1 },
      { code: 'KHI02', is_head_office: 0 },
    ]);
  });
});

describe('delivery problems', () => {
  it('a second delivery of everything changes nothing (duplicate, re-pull after cursor reset)', async () => {
    createItemAt(ho, { name: 'Panadol Tablet', barcodes: ['8961009990002'] });
    await pushAll(ho, hoConn);
    await pullInto(br, brConn);
    const items1 = br.db.select().from(items).all();
    const audit1 = br.db.select({ n: count() }).from(auditLog).get()?.n;

    resetCursors(br.db);
    const again = await pullInto(br, brConn);
    expect(again.applied).toBe(0);
    expect(br.db.select().from(items).all()).toEqual(items1);
    expect(br.db.select({ n: count() }).from(auditLog).get()?.n).toBe(audit1); // nothing new to audit
    expect(br.db.select({ n: count() }).from(itemBarcodes).get()?.n).toBe(1);
  });

  it('the same event applied twice in one page is applied once', async () => {
    createItemAt(ho, { name: 'Brufen 400', barcodes: [] });
    await pushAll(ho, hoConn);
    const page = await brConn.pull({
      cursors: Object.fromEntries(pullTypes().map((t) => [t, '0'])),
      limit: 500,
    });
    const apply = applierFor(br);
    const first = apply([...page.changes, ...page.changes]);
    expect(first).toBeDefined();
    expect(br.db.select({ n: count() }).from(items).get()?.n).toBe(1);
    expect(br.db.select({ n: count() }).from(itemUnits).get()?.n).toBe(2);
  });

  it('a crash between apply and cursor save: the page is delivered again and nothing doubles', async () => {
    createItemAt(ho, { name: 'Calpol Syrup', barcodes: ['8961009990003'] });
    await pushAll(ho, hoConn);
    const cursors = getCursors(br.db, pullTypes());
    const page = await brConn.pull({ cursors, limit: 500 });
    applierFor(br)(page.changes); // applied, but "crashed" before pullChanges saved cursors and the seen ledger
    expect(br.db.select({ n: count() }).from(syncCursors).get()?.n).toBe(0);

    const summary = await pullInto(br, brConn);
    expect(summary.applied).toBe(0); // all skipped: the data is already there
    expect(br.db.select({ n: count() }).from(items).get()?.n).toBe(1);
    expect(br.db.select({ n: count() }).from(itemBarcodes).get()?.n).toBe(1);
    expect(getCursors(br.db, ['items']).items).not.toBe('0');
  });

  it('delivery reversed by the network still ends with the newest Head Office price', async () => {
    const id = createItemAt(ho, { name: 'Augmentin 625', retailRateUnitMicro: rateOf('10.00') });
    await pushAll(ho, hoConn);
    await pullInto(br, brConn);

    const current = () => getItem(ho.db, ho.setup.tenantId, id);
    const edit = (price: string) =>
      updateItem(ho.db, hoCtx(), id, {
        ...itemInputFor(ho, { name: 'Augmentin 625', retailRateUnitMicro: rateOf(price) }),
        expectedVersion: current().version,
      });
    edit('11.00');
    edit('12.00');
    hoConn.faults.reverseBatches = true; // the cloud feed receives 12.00 before 11.00
    await pushAll(ho, hoConn);
    await pullInto(br, brConn);
    expect(getItem(br.db, br.setup.tenantId, id).retailRateUnitMicro).toBe(rateOf('12.00'));
  });

  it('an older Head Office price arriving in a later page does not undo a newer one', async () => {
    const id = createItemAt(ho, { name: 'Zyrtec 10mg', retailRateUnitMicro: rateOf('5.00') });
    await pushAll(ho, hoConn);
    await pullInto(br, brConn);
    const edit = (price: string) =>
      updateItem(ho.db, hoCtx(), id, {
        ...itemInputFor(ho, { name: 'Zyrtec 10mg', retailRateUnitMicro: rateOf(price) }),
        expectedVersion: getItem(ho.db, ho.setup.tenantId, id).version,
      });
    edit('6.00');
    edit('7.00');
    hoConn.faults.reverseBatches = true;
    await pushAll(ho, hoConn);
    await pullInto(br, brConn, 1); // one event per page: 7.00 first, then 6.00
    expect(getItem(br.db, br.setup.tenantId, id).retailRateUnitMicro).toBe(rateOf('7.00'));
  });
});

describe('dependency ordering', () => {
  it('an item whose category has not arrived waits, without losing its place', async () => {
    const cat = createCategory(ho.db, hoCtx(), 'Cardiac');
    const id = createItemAt(ho, { name: 'Concor 5mg', categoryId: cat });
    await pushAll(ho, hoConn);
    // One event per page: the category (6th of its type) is far behind the item in the pull.
    const summary = await pullInto(br, brConn, 1);
    expect(summary.blocked).toEqual({});
    expect(getItem(br.db, br.setup.tenantId, id).categoryId).toBe(cat);
    expect(br.db.select().from(categories).where(eq(categories.id, cat)).get()).toBeDefined();
  });

  it('reports the wait and keeps the cursor when the parent really is missing', async () => {
    const cat = createCategory(ho.db, hoCtx(), 'Dermatology');
    const id = createItemAt(ho, { name: 'Fucidin Cream', categoryId: cat });
    await pushAll(ho, hoConn);
    // Pull everything except categories: the item cannot be placed.
    const types = pullTypes().filter((t) => t !== 'categories');
    const summary = await pullChanges(br.db, brConn, {
      entityTypes: types,
      apply: applierFor(br),
      now: () => new Date(br.clock.ms),
    });
    expect(Object.keys(summary.blocked)).toEqual(['items']);
    expect(getCursors(br.db, ['items']).items).toBe('0');
    expect(br.db.select({ n: count() }).from(items).get()?.n).toBe(0);

    await pullInto(br, brConn); // now with categories
    expect(getItem(br.db, br.setup.tenantId, id).name).toBe('Fucidin Cream');
  });
});

describe('Head Office pricing on the branch', () => {
  it('a branch cannot create items or change prices, but may set its own reorder level', async () => {
    const id = createItemAt(ho, { name: 'Panadol Extra', retailRateUnitMicro: rateOf('3.00') });
    await pushAll(ho, hoConn);
    await pullInto(br, brConn);

    expect(() => createItem(br.db, brCtx(), itemInputFor(br, { name: 'Local Only Item' }))).toThrow(
      /Prices and tax rates are set by Head Office/,
    );
    const item = getItem(br.db, br.setup.tenantId, id);
    const same = { ...itemInputFor(br, { name: item.name }), expectedVersion: item.version };
    expect(() =>
      updateItem(br.db, brCtx(), id, { ...same, retailRateUnitMicro: rateOf('9.99') }),
    ).toThrow(DomainError);
    expect(() => updateItem(br.db, brCtx(), id, { ...same, taxBp: 500 })).toThrow(
      /set by Head Office/,
    );
    updateItem(br.db, brCtx(), id, {
      ...same,
      retailRateUnitMicro: item.retailRateUnitMicro,
      reorderLevelBase: 25,
    });
    expect(getItem(br.db, br.setup.tenantId, id).reorderLevelBase).toBe(25);
  });

  it('Head Office and a single-PC organisation are not restricted', async () => {
    expect(() => createItemAt(ho, { name: 'HO Item' })).not.toThrow();
    const solo = await createTestEnv();
    try {
      solo.db.run(sql`UPDATE branches SET is_head_office = 0`);
      expect(() =>
        createItem(solo.db, solo.ctx(solo.setup.adminUserId), itemInputFor(solo)),
      ).not.toThrow();
    } finally {
      solo.cleanup();
    }
  });

  it('Head Office price wins over a branch price, but a branch-local field is kept', async () => {
    const id = createItemAt(ho, {
      name: 'Disprin',
      retailRateUnitMicro: rateOf('1.00'),
      reorderLevelBase: 10,
    });
    await pushAll(ho, hoConn);
    await pullInto(br, brConn);

    // A price written on the branch behind the rules' back (an old edit), and a branch-local choice.
    br.clock.ms += 60_000;
    br.db.run(
      sql`UPDATE items SET retail_rate_unit_micro = ${rateOf('99.00')}, reorder_level_base = 77, allow_negative_stock = 1, hlc = ${brCtx().clock.tick()} WHERE id = ${id}`,
    );

    ho.clock.ms += 1_000; // Head Office edits EARLIER than the branch by the clocks
    updateItem(ho.db, hoCtx(), id, {
      ...itemInputFor(ho, {
        name: 'Disprin',
        retailRateUnitMicro: rateOf('1.50'),
        reorderLevelBase: 15,
      }),
      expectedVersion: getItem(ho.db, ho.setup.tenantId, id).version,
    });
    await pushAll(ho, hoConn);
    const summary = await pullInto(br, brConn);

    const after = getItem(br.db, br.setup.tenantId, id);
    expect(after.retailRateUnitMicro).toBe(rateOf('1.50')); // Head Office wins price
    expect(after.reorderLevelBase).toBe(77); // branch decision stays
    expect(after.allowNegativeStock).toBe(true);
    expect(summary.applied).toBeGreaterThan(0);
    const note = br.db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'sync.apply'), eq(auditLog.entityId, id)))
      .all();
    expect(note.some((a) => (a.newJson ?? '').includes('retailRateUnitMicro'))).toBe(true);
    expect(verifyAuditChain(br.db, br.setup.branchId).ok).toBe(true);
  });

  it('a price sent by a branch is ignored by Head Office', async () => {
    const id = createItemAt(ho, { name: 'Sensodyne', retailRateUnitMicro: rateOf('4.00') });
    await pushAll(ho, hoConn);
    await pullInto(br, brConn);
    // The branch pushes an item event with another price (legacy or tampered client).
    const before = getItem(br.db, br.setup.tenantId, id);
    br.clock.ms += 10_000;
    const { recordChange } = await import('../../outbox');
    br.db.transaction((tx) =>
      recordChange(tx, brCtx(), {
        entityType: 'items',
        entityId: id,
        op: 'update',
        payload: {
          id,
          name: 'Sensodyne Renamed',
          retailRateUnitMicro: rateOf('0.50'),
          taxBp: 0,
          baseVersion: before.version,
        },
      }),
    );
    await pushAll(br, brConn);
    await pullInto(ho, hoConn);
    const at = getItem(ho.db, ho.setup.tenantId, id);
    expect(at.retailRateUnitMicro).toBe(rateOf('4.00'));
    expect(at.name).toBe('Sensodyne Renamed'); // plain fields merge
    expect(verifyAuditChain(ho.db, ho.setup.branchId).ok).toBe(true);
  });
});

describe('robustness', () => {
  it('a unit code that is already taken by another row is reported, not crashed on', async () => {
    const tablet = br.db.select().from(units).all();
    expect(tablet).toHaveLength(0); // joined branches start without units
    br.db.run(
      sql`INSERT INTO units (id, tenant_id, code, name, created_at, updated_at, hlc, version) VALUES ('local-unit', ${br.setup.tenantId}, 'tablet', 'Local Tablet', 'x', 'x', '000000000001-0000-00000000', 1)`,
    );
    await pushAll(ho, hoConn);
    const summary = await pullInto(br, brConn);
    expect(summary.conflicts).toBeGreaterThan(0);
    expect(br.db.select().from(units).where(eq(units.code, 'tablet')).all()).toHaveLength(1);
  });

  it('applies nothing for an organisation that is not ours', async () => {
    const apply = createChangeApplier(br.db, { clock: brCtx().clock });
    const report = apply([
      {
        cursor: '1',
        version: 1,
        event: {
          id: 'e1',
          seq: 1,
          entityType: 'categories',
          entityId: 'c1',
          op: 'insert',
          payload: { id: 'c1', name: 'Stranger' },
          hlc: '000000000001-0000-deadbeef',
          deviceId: 'other-device',
          branchId: null,
          tenantId: 'another-tenant',
          schemaVersion: 1,
        },
      },
    ]);
    expect(report).toMatchObject({ applied: 0, skipped: 1 });
    expect(
      br.db.select().from(categories).where(eq(categories.name, 'Stranger')).all(),
    ).toHaveLength(0);
  });
});
