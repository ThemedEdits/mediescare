/** Helpers for the multi-branch tests: a Head Office database and a joined branch database. Not a test file. */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { parseRateToMicro } from '@mediescare/core';
import { HybridLogicalClock, type PulledChange, type SyncEvent } from '@mediescare/sync';
import { hashPassword } from '../../auth/password';
import { openDatabase } from '../../client';
import type { WriteContext } from '../../context';
import { runFirstRunSetup } from '../../firstRun';
import { runMigrations } from '../../migrate';
import { createItem, type ItemInput } from '../../pharmacy/catalog';
import { branches, roles, units } from '../../schema/sqlite-all';
import type { TestEnv } from '../../test-helpers';
import { registerBranch } from '../branch-registry';
import { createChangeApplier } from './index';
import { registeredEntityTypes } from './index';

export const rateOf = parseRateToMicro;

/** A branch PC of the same organisation as `ho`, set up the way the join screen does it. */
export async function createJoinedBranchEnv(
  ho: TestEnv,
  branch: { code: string; name: string },
): Promise<TestEnv> {
  const dir = mkdtempSync(join(tmpdir(), 'mediescare-branch-'));
  const handle = openDatabase({
    file: join(dir, 'branch.db'),
    keyHex: randomBytes(32).toString('hex'),
  });
  runMigrations(handle.db);
  const clock = { ms: ho.clock.ms };
  // Head Office registers the branch first; the cloud would hand the branch that id at enrollment.
  const registered = registerBranch(ho.db, ho.ctx(ho.setup.adminUserId), branch);
  const setup = runFirstRunSetup(handle.db, {
    tenantName: 'Test Pharmacy Group',
    branchCode: branch.code,
    branchName: branch.name,
    isHeadOffice: false,
    deviceName: `${branch.code} Server`,
    admin: {
      username: 'admin',
      fullName: 'Branch Admin',
      passwordHash: await hashPassword('correct-Horse-battery-9'),
    },
    join: { tenantId: ho.setup.tenantId, branchId: registered.id },
    now: () => new Date(clock.ms),
  });
  const hlc = new HybridLogicalClock('0badf00d', () => clock.ms);
  const ctx = (userId: string | null): WriteContext => ({
    tenantId: setup.tenantId,
    branchId: setup.branchId,
    deviceId: setup.deviceId,
    userId,
    clock: hlc,
    now: () => new Date(clock.ms),
  });
  const roleId = (code: string) => {
    const r = handle.db.select().from(roles).where(eq(roles.code, code)).get();
    if (!r) throw new Error(`role ${code}`);
    return r.id;
  };
  return {
    handle,
    db: handle.db,
    setup,
    clock,
    ctx,
    roleId,
    addUser: () => Promise.reject(new Error('not needed in these tests')),
    cleanup: () => {
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** The applier of a test branch, with its own clock (the one its writes use). */
export function applierFor(env: TestEnv) {
  const clock = env.ctx(null).clock;
  return createChangeApplier(env.db, { clock, now: () => new Date(env.clock.ms) });
}

export const pullTypes = () => registeredEntityTypes();

export function unitIdByCode(env: TestEnv, code: string): string {
  const u = env.db.select().from(units).where(eq(units.code, code)).get();
  if (!u) throw new Error(`unit ${code}`);
  return u.id;
}

export function itemInputFor(env: TestEnv, over: Partial<ItemInput> = {}): ItemInput {
  const tablet = unitIdByCode(env, 'tablet');
  const strip = unitIdByCode(env, 'strip');
  return {
    name: 'Paracetamol 500mg',
    genericName: 'Paracetamol',
    baseUnitId: tablet,
    units: [
      { unitId: tablet, factorToBase: 1 },
      { unitId: strip, factorToBase: 10, isDefaultSale: true, isDefaultPurchase: true },
    ],
    barcodes: [],
    retailRateUnitMicro: rateOf('2.50'),
    ...over,
  };
}

export function createItemAt(env: TestEnv, over: Partial<ItemInput> = {}): string {
  return createItem(env.db, env.ctx(env.setup.adminUserId), itemInputFor(env, over));
}

/** Wrap an event as the cloud feed would deliver it. */
export function pulled(event: SyncEvent, cursor: number): PulledChange {
  return { cursor: String(cursor), version: 1, event };
}

export function branchIdOf(env: TestEnv, code: string): string {
  const b = env.db.select().from(branches).where(eq(branches.code, code)).get();
  if (!b) throw new Error(`branch ${code}`);
  return b.id;
}
