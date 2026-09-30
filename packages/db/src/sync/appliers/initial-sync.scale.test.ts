/**
 * First sync of a new branch at the owner's real catalogue size (53,000 items), against the
 * in-memory cloud. Measures the branch side only (apply, index, cursors): a real network and a
 * Postgres cloud add their own time. Skip with SKIP_SCALE=1.
 */
import { count } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_MASTER_ENTITIES,
  FakeCloud,
  HybridLogicalClock,
  newId,
  SYNC_SCHEMA_VERSION,
  type SyncEvent,
} from '@mediescare/sync';
import { verifyAuditChain } from '../../audit';
import { searchItems } from '../../pharmacy/catalog';
import { itemBarcodes, items, itemUnits } from '../../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../../test-helpers';
import { pullChanges } from '../pull';
import { authOf } from '../test-support';
import { applierFor, createJoinedBranchEnv, pullTypes, unitIdByCode } from './test-env';

const ITEMS = Number(process.env.SCALE_ITEMS ?? 53_000);
const skip = process.env.SKIP_SCALE === '1';

describe.skipIf(skip)('initial sync of a new branch', () => {
  let ho: TestEnv;
  let br: TestEnv;
  let cloud: FakeCloud;

  beforeAll(async () => {
    ho = await createTestEnv();
    br = await createJoinedBranchEnv(ho, { code: 'KHI02', name: 'Scale Branch' });
    cloud = new FakeCloud({
      now: () => ho.clock.ms,
      masterEntities: [...DEFAULT_MASTER_ENTITIES, 'branches'],
    });
    const hoAuth = authOf(ho, true);
    const clock = new HybridLogicalClock('c0ffee00', () => ho.clock.ms);
    const tablet = unitIdByCode(ho, 'tablet');
    const strip = unitIdByCode(ho, 'strip');
    const conn = cloud.connect(hoAuth);

    // Head Office's own first-run events (branches, units, categories ...) through the real outbox.
    const { pushOutbox } = await import('../../syncWorker');
    for (let i = 0; i < 10; i++)
      await pushOutbox(ho.db, conn, { now: () => new Date(ho.clock.ms), batchSize: 200 });

    let events: SyncEvent[] = [];
    const flush = async () => {
      await cloud.store.applyBatch(hoAuth, { idempotencyKey: newId(), epoch: 1, events });
      events = [];
    };
    for (let i = 0; i < ITEMS; i++) {
      const id = newId();
      const at = new Date(ho.clock.ms).toISOString();
      events.push({
        id: newId(),
        seq: i + 1,
        entityType: 'items',
        entityId: id,
        op: 'insert',
        payload: {
          id,
          tenantId: ho.setup.tenantId,
          sku: String(20_000 + i),
          name: `Item ${i} ${['Tablet', 'Syrup', 'Capsule', 'Cream'][i % 4]} ${(i % 900) + 50}mg`,
          genericName: `Generic ${i % 2000}`,
          strength: null,
          dosageForm: null,
          categoryId: null,
          manufacturerId: null,
          rackId: null,
          baseUnitId: tablet,
          retailRateUnitMicro: 1_000_000 + i,
          taxBp: 0,
          taxInclusive: false,
          reorderLevelBase: 0,
          isPrescription: false,
          isNarcotic: false,
          isColdChain: false,
          allowNegativeStock: false,
          drapRegNo: null,
          isActive: true,
          deletedAt: null,
          createdAt: at,
          updatedAt: at,
          hlc: clock.tick(),
          version: 1,
          units: [
            {
              id: newId(),
              itemId: id,
              unitId: tablet,
              factorToBase: 1,
              isDefaultSale: false,
              isDefaultPurchase: false,
            },
            {
              id: newId(),
              itemId: id,
              unitId: strip,
              factorToBase: 10,
              isDefaultSale: true,
              isDefaultPurchase: true,
            },
          ],
          barcodes: [
            {
              id: newId(),
              itemId: id,
              barcode: `89610${String(i).padStart(8, '0')}`,
              unitId: null,
            },
          ],
        },
        hlc: clock.tick(),
        deviceId: hoAuth.deviceId,
        branchId: hoAuth.branchId,
        tenantId: hoAuth.tenantId,
        schemaVersion: SYNC_SCHEMA_VERSION,
      });
      if (events.length === 500) await flush();
    }
    if (events.length) await flush();
  }, 300_000);

  afterAll(() => {
    ho?.cleanup();
    br?.cleanup();
  });

  it(`pulls ${ITEMS} items with units, barcodes and search index in reasonable time`, async () => {
    const conn = cloud.connect(authOf(br, false));
    const started = performance.now();
    const summary = await pullChanges(br.db, conn, {
      entityTypes: pullTypes(),
      apply: applierFor(br),
      limit: 500,
      maxPages: 100_000,
      now: () => new Date(br.clock.ms),
    });
    const seconds = (performance.now() - started) / 1000;
    console.log(
      `[scale] pulled ${summary.received} events (${ITEMS} items) in ${seconds.toFixed(1)} s over ${summary.pages} pages`,
    );
    expect(summary.blocked).toEqual({});
    expect(br.db.select({ n: count() }).from(items).get()?.n).toBe(ITEMS);
    expect(br.db.select({ n: count() }).from(itemUnits).get()?.n).toBe(ITEMS * 2);
    expect(br.db.select({ n: count() }).from(itemBarcodes).get()?.n).toBe(ITEMS);
    expect(seconds).toBeLessThan(120);

    const t0 = performance.now();
    const hit = searchItems(br.db, br.ctx(br.setup.adminUserId), 'generic 1999');
    console.log(
      `[scale] search after sync: ${(performance.now() - t0).toFixed(0)} ms, ${hit.length} hits`,
    );
    expect(hit.length).toBeGreaterThan(0);
    expect(searchItems(br.db, br.ctx(br.setup.adminUserId), '8961000000017')[0]?.sku).toBe('20017');
    expect(verifyAuditChain(br.db, br.setup.branchId).ok).toBe(true);
  }, 300_000);
});
