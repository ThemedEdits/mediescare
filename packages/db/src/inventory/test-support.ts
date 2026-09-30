/**
 * Test helper: two branch databases (Head Office and a branch) of the SAME organisation that exchange
 * events only through a fake cloud, exactly as two real sites do. Not a test file. All data is invented.
 */
import { eq } from 'drizzle-orm';
import { parseRateToMicro } from '@mediescare/core';
import { FakeCloud, HybridLogicalClock, type FakeConnection } from '@mediescare/sync';
import type { WriteContext } from '../context';
import { createItem, type ItemInput } from '../pharmacy/catalog';
import { createSupplier } from '../pharmacy/lookups';
import { receiveGrn } from '../pharmacy/stock';
import {
  branches,
  devices,
  itemUnits,
  items,
  syncOutbox,
  tenants,
  units,
} from '../schema/sqlite-all';
import '../sync/appliers'; // registers every applier
import { createChangeApplier } from '../sync/appliers/change-applier';
import { SyncRunner } from '../sync/runner';
import { createTestEnv, type TestEnv } from '../test-helpers';

export const rate = parseRateToMicro;

export interface Site {
  env: TestEnv;
  branchId: string;
  ctx: WriteContext;
  conn: FakeConnection;
  runner: SyncRunner;
  /** One push and pull cycle, like the background runner. */
  sync(): Promise<void>;
}

export interface Network {
  ho: Site;
  branch: Site;
  cloud: FakeCloud;
  unitId: Record<string, string>;
  supplierId: string;
  /** Paracetamol (tablet / strip of 10 / box of 100). */
  para: string;
  /** A second item. */
  amox: string;
  /** Advance both clocks (milliseconds). */
  advance(ms: number): void;
  cleanup(): void;
}

const itemInput = (name: string, unitId: Record<string, string>): ItemInput => ({
  name,
  baseUnitId: unitId.tablet as string,
  units: [
    { unitId: unitId.tablet as string, factorToBase: 1 },
    {
      unitId: unitId.strip as string,
      factorToBase: 10,
      isDefaultSale: true,
      isDefaultPurchase: true,
    },
    { unitId: unitId.box as string, factorToBase: 100 },
  ],
  barcodes: [],
  retailRateUnitMicro: rate('2.50'),
});

/** Head Office HO01 and branch KHI02 in one tenant, master data copied, nothing in the outbox yet. */
export async function createNetwork(): Promise<Network> {
  const a = await createTestEnv();
  const b = await createTestEnv();

  // Branch B joins A's organisation: same tenant, its own branch and device, not Head Office.
  const tenant = a.db.select().from(tenants).where(eq(tenants.id, a.setup.tenantId)).get();
  if (!tenant) throw new Error('tenant');
  b.db.insert(tenants).values(tenant).run();
  b.db
    .update(branches)
    .set({ tenantId: tenant.id, code: 'KHI02', name: 'Branch Two', isHeadOffice: false })
    .where(eq(branches.id, b.setup.branchId))
    .run();
  b.db.update(devices).set({ tenantId: tenant.id }).where(eq(devices.id, b.setup.deviceId)).run();
  a.db
    .update(branches)
    .set({ code: 'HO01', name: 'Head Office' })
    .where(eq(branches.id, a.setup.branchId))
    .run();

  // Both databases know both branches (the branches applier does this in production).
  const aBranch = a.db.select().from(branches).where(eq(branches.id, a.setup.branchId)).get();
  const bBranch = b.db.select().from(branches).where(eq(branches.id, b.setup.branchId)).get();
  if (!aBranch || !bBranch) throw new Error('branches');
  b.db.insert(branches).values(aBranch).run();
  a.db.insert(branches).values(bBranch).run();

  const ctxOf = (env: TestEnv, branchId: string, deviceId: string): WriteContext => ({
    tenantId: tenant.id,
    branchId,
    deviceId,
    userId: env.setup.adminUserId,
    clock: new HybridLogicalClock(deviceId.replace(/-/g, '').slice(-8), () => env.clock.ms),
    now: () => new Date(env.clock.ms),
  });
  const hoCtx = ctxOf(a, a.setup.branchId, a.setup.deviceId);
  const brCtx = ctxOf(b, b.setup.branchId, b.setup.deviceId);

  // Master data at Head Office, then copied (ids included) to the branch.
  const unitId = Object.fromEntries(
    a.db
      .select()
      .from(units)
      .all()
      .map((u) => [u.code, u.id]),
  );
  const supplierId = createSupplier(a.db, hoCtx, { name: 'Test Distributor' });
  const para = createItem(a.db, hoCtx, itemInput('Paracetamol 500mg', unitId));
  const amox = createItem(a.db, hoCtx, itemInput('Amoxicillin 500mg', unitId));
  for (const u of a.db.select().from(units).where(eq(units.tenantId, tenant.id)).all())
    b.db.insert(units).values(u).run();
  for (const i of a.db.select().from(items).all()) b.db.insert(items).values(i).run();
  for (const i of a.db.select().from(itemUnits).all()) b.db.insert(itemUnits).values(i).run();

  // Setup noise is not part of the scenario: mark it as already sent, so the runners move only what the tests create.
  const settle = (env: TestEnv) =>
    env.db
      .update(syncOutbox)
      .set({ ackAt: '2026-01-01T00:00:00.000Z', sentAt: '2026-01-01T00:00:00.000Z' })
      .run();
  settle(a);
  settle(b);

  const cloud = new FakeCloud({ now: () => a.clock.ms });
  const site = (env: TestEnv, ctx: WriteContext, headOffice: boolean): Site => {
    const conn = cloud.connect({
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      deviceId: ctx.deviceId,
      headOffice,
    });
    const runner = new SyncRunner({
      db: env.db,
      adapter: conn,
      now: () => new Date(env.clock.ms),
      random: () => 0.5,
      pull: {
        entityTypes: ['stock_requisitions', 'stock_transfers'],
        apply: createChangeApplier(env.db, { clock: ctx.clock, now: ctx.now }),
        clock: ctx.clock,
      },
    });
    return {
      env,
      branchId: ctx.branchId,
      ctx,
      conn,
      runner,
      sync: () => runner.runOnce(),
    };
  };

  return {
    ho: site(a, hoCtx, true),
    branch: site(b, brCtx, false),
    cloud,
    unitId,
    supplierId,
    para,
    amox,
    advance: (ms) => {
      a.clock.ms += ms;
      b.clock.ms += ms;
    },
    cleanup: () => {
      a.cleanup();
      b.cleanup();
    },
  };
}

/** Receive stock at Head Office the normal way (a goods receipt) and return the new batch ids by batch number. */
export function stockUp(
  net: Network,
  lines: {
    itemId: string;
    batchNo: string;
    expiryDate: string;
    strips: number;
    priceStrip?: string;
  }[],
): void {
  receiveGrn(net.ho.env.db, net.ho.ctx, {
    supplierId: net.supplierId,
    lines: lines.map((l) => ({
      itemId: l.itemId,
      unitId: net.unitId.strip as string,
      qty: l.strips,
      batchNo: l.batchNo,
      expiryDate: l.expiryDate,
      unitPriceMicro: rate(l.priceStrip ?? '20'),
    })),
  });
  // The goods receipt is HO's own business. Keep it out of the transfer scenario's event count.
  net.ho.env.db.update(syncOutbox).set({ ackAt: '2026-01-01T00:00:00.000Z' }).run();
}
