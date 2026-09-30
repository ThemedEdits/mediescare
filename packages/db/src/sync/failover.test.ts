import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeCloud, newId } from '@mediescare/sync';
import { verifyAuditChain } from '../audit';
import { nextDocNo } from '../pharmacy/common';
import { auditLog, devices, docCounters, syncOutbox } from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { getSyncStatus, pushOutbox } from '../syncWorker';
import { getServerEpoch, promote } from './epoch';
import { FENCED_ERROR } from './failover';
import { SyncRunner } from './runner';
import { authOf, queueSales, unsentCount } from './test-support';

let env: TestEnv;
let dir: string;
const now = () => new Date(env.clock.ms);

beforeEach(async () => {
  env = await createTestEnv();
  dir = mkdtempSync(join(tmpdir(), 'mediescare-fence-'));
});
afterEach(() => {
  env.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

describe('promotion (ADR-0004)', () => {
  it('starts at epoch 1, bumps durably, audits, and advances document numbers past the gap', () => {
    expect(getServerEpoch(env.db)).toBe(1);
    const ctx = env.ctx(env.setup.adminUserId);
    const before = env.db.transaction((tx) => nextDocNo(tx, ctx, 'INV')); // e.g. KHI01-INV-000001
    expect(before).toMatch(/INV-000001$/);

    const result = promote(env.db, ctx, { reason: 'old server PC failed' });
    expect(result).toMatchObject({ epoch: 2, previousEpoch: 1, countersAdvanced: 1 });
    expect(getServerEpoch(env.db)).toBe(2);

    const after = env.db.transaction((tx) => nextDocNo(tx, ctx, 'INV'));
    const seqBefore = Number(before.split('-').at(-1));
    const seqAfter = Number(after.split('-').at(-1));
    expect(seqAfter).toBeGreaterThan(seqBefore + 100); // never reuses a number the old primary may have issued
    expect(env.db.select().from(docCounters).get()?.epoch).toBe(2);

    const audit = env.db
      .select()
      .from(auditLog)
      .all()
      .find((a) => a.action === 'sync.promote');
    expect(JSON.parse(audit?.newJson ?? '{}')).toMatchObject({
      epoch: 2,
      reason: 'old server PC failed',
    });
    expect(verifyAuditChain(env.db, env.setup.branchId).ok).toBe(true);
    expect(
      env.db
        .select()
        .from(syncOutbox)
        .all()
        .some((r) => r.entityType === 'sync_epochs'),
    ).toBe(true);
  });

  it('requires a reason and can move the server role to a standby device', () => {
    const ctx = env.ctx(env.setup.adminUserId);
    expect(() => promote(env.db, ctx, { reason: ' ' })).toThrow(/reason/);
    const standbyId = newId();
    const now0 = new Date(env.clock.ms).toISOString();
    env.db
      .insert(devices)
      .values({
        id: standbyId,
        tenantId: env.setup.tenantId,
        branchId: env.setup.branchId,
        name: 'Standby PC',
        role: 'standby',
        createdAt: now0,
        updatedAt: now0,
        hlc: ctx.clock.tick(),
        version: 1,
      })
      .run();
    promote(env.db, ctx, { reason: 'standby takes over', deviceId: standbyId });
    const role = (id: string) =>
      env.db.select().from(devices).where(eq(devices.id, id)).get()?.role;
    expect(role(standbyId)).toBe('server');
    expect(role(env.setup.deviceId)).toBe('standby');
  });

  it('sends the new epoch with every push', async () => {
    const cloud = new FakeCloud({ now: () => env.clock.ms });
    const conn = cloud.connect(authOf(env, false));
    promote(env.db, env.ctx(env.setup.adminUserId), { reason: 'restore on new PC' });
    await pushOutbox(env.db, conn, { now });
    expect(conn.pushes.every((p) => p.epoch === 2)).toBe(true);
    expect(cloud.store.epochOf(authOf(env))).toBe(2);
  });
});

describe('fencing an old primary that comes back', () => {
  it('is refused by the cloud, exports its unsent tail for review, and never drops or merges it', async () => {
    const cloud = new FakeCloud({ now: () => env.clock.ms });
    const auth = authOf(env, false);
    const oldPrimary = cloud.connect(auth);

    // The old primary syncs normally, then goes offline holding a tail of sales the cloud never saw.
    await pushOutbox(env.db, oldPrimary, { now, batchSize: 500 });
    oldPrimary.faults.offline = true;
    const tailIds = queueSales(env, 7, 'tail');
    expect((await pushOutbox(env.db, oldPrimary, { now })).offline).toBe(true);

    // Meanwhile the standby was promoted and announced epoch 2 to the cloud.
    const promoted = cloud.connect({ ...auth, deviceId: '99999999-9999-7999-8999-999999999999' });
    await promoted.push({ idempotencyKey: 'epoch-2', epoch: 2, events: [] });

    // The old primary returns. Its worker must be fenced, not merged.
    oldPrimary.faults.offline = false;
    const appliedBefore = cloud.store.appliedIds.length;
    env.clock.ms += 16 * 60 * 1000; // the retry backoff has passed
    const runner = new SyncRunner({
      db: env.db,
      adapter: oldPrimary,
      exportDir: dir,
      auditContext: () => env.ctx(null),
      now,
      random: () => 0.5,
    });
    await runner.runOnce();

    const status = runner.status();
    expect(status.state).toBe('fenced');
    expect(status.lastError?.message).toMatch(/exported to/);
    expect(cloud.store.appliedIds.length).toBe(appliedBefore); // nothing from the fenced server was applied

    // The tail is on disk for a manager and still in the database, parked in the error queue.
    const fileLine = /exported to (.+\.json)/.exec(status.lastError?.message ?? '')?.[1] ?? '';
    expect(existsSync(fileLine)).toBe(true);
    const exported = JSON.parse(readFileSync(fileLine, 'utf8')) as {
      events: { entityId: string }[];
      cloudEpoch: number;
    };
    expect(exported.cloudEpoch).toBe(2);
    expect(exported.events.map((e) => e.entityId)).toEqual(tailIds);
    expect(
      env.db
        .select()
        .from(syncOutbox)
        .all()
        .filter((r) => r.error === FENCED_ERROR),
    ).toHaveLength(7);
    expect(getSyncStatus(env.db).pending).toBe(0);
    expect(
      env.db
        .select()
        .from(auditLog)
        .all()
        .some((a) => a.action === 'sync.fenced.export'),
    ).toBe(true);

    // It stays fenced: new writes are not pushed until a promotion raises the local epoch.
    queueSales(env, 2, 'after-fence');
    const pushesBefore = oldPrimary.pushes.length;
    await runner.runOnce();
    expect(oldPrimary.pushes.length).toBe(pushesBefore);
    expect(runner.status().state).toBe('fenced');
    expect(unsentCount(env)).toBe(2);
  });
});
