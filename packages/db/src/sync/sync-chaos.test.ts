/**
 * Sync chaos tests (CLAUDE.md §9): the real branch outbox and worker against `FakeCloud`, which
 * runs the real cloud rules in memory. These prove the branch side and the merge rules. They do
 * NOT prove anything about a real network or a Postgres deployment.
 */
import { and, count, isNotNull, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeCloud, type CloudAdapter } from '@mediescare/sync';
import { syncOutbox } from '../schema/sqlite';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { getSyncStatus, pushOutbox } from '../syncWorker';
import { getCursors, pullChanges, requeueAcked, resetCursors } from './pull';
import { authOf, queueItemEdit, queueSales, remoteSite, unsentCount } from './test-support';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

let env: TestEnv;
let cloud: FakeCloud;

const cloudNow = () => env.clock.ms;
const now = () => new Date(env.clock.ms);

/** Run push cycles, moving the clock past any backoff, until nothing is left or `max` cycles ran. */
async function drain(adapter: CloudAdapter, max = 30): Promise<number> {
  let cycles = 0;
  while (unsentCount(env) > 0 && cycles < max) {
    await pushOutbox(env.db, adapter, { now, random: () => 0.5, batchSize: 100 });
    env.clock.ms += 16 * 60 * 1000; // longer than the 15 minute backoff cap
    cycles += 1;
  }
  return cycles;
}

beforeEach(async () => {
  env = await createTestEnv();
  cloud = new FakeCloud({ now: cloudNow });
});
afterEach(() => env.cleanup());

describe('offline for days, then catch up', () => {
  it('keeps selling offline, backs off, then delivers every event exactly once', async () => {
    const conn = cloud.connect(authOf(env, false));
    await drain(conn); // first-run setup rows
    expect(unsentCount(env)).toBe(0);

    conn.faults.offline = true;
    const created = queueSales(env, 300);
    for (let day = 0; day < 3; day++) {
      const r = await pushOutbox(env.db, conn, { now, random: () => 0.5 });
      expect(r.offline).toBe(true);
      env.clock.ms += DAY;
    }
    const status = getSyncStatus(env.db);
    expect(status.pending).toBe(300); // nothing lost, nothing marked sent
    expect(Date.parse(status.oldestPendingAt ?? '')).toBeLessThan(env.clock.ms - 2 * DAY);

    conn.faults.offline = false;
    await drain(conn);
    expect(unsentCount(env)).toBe(0);
    const salesInCloud = cloud.store.appliedIds.length;
    expect(salesInCloud).toBeGreaterThanOrEqual(300);
    expect(new Set(cloud.store.appliedIds).size).toBe(cloud.store.appliedIds.length); // no double application
    for (const id of created) expect(cloud.store.document('sales', id)).toBeDefined();
    const total = created.reduce(
      (sum, id) =>
        sum + (cloud.store.document('sales', id)?.payload as { totalMinor: number }).totalMinor,
      0,
    );
    expect(total).toBe(created.reduce((sum, _id, i) => sum + 10_000 + i, 0)); // cloud totals equal local totals
  });
});

describe('duplicate and lost deliveries', () => {
  it('a lost response leaves rows queued; the retry gets duplicate acks and nothing is applied twice', async () => {
    const conn = cloud.connect(authOf(env));
    await drain(conn);
    queueSales(env, 20);
    conn.faults.loseNextResponses = 1;
    const first = await pushOutbox(env.db, conn, { now, random: () => 0.5 });
    expect(first.offline).toBe(true);
    expect(unsentCount(env)).toBe(20);
    const appliedAfterLoss = cloud.store.appliedIds.length;

    env.clock.ms += 16 * 60 * 1000;
    const second = await pushOutbox(env.db, conn, { now, random: () => 0.5 });
    expect(second).toMatchObject({ acked: 20, offline: false });
    expect(cloud.store.appliedIds.length).toBe(appliedAfterLoss); // the retry was all duplicates
    expect(unsentCount(env)).toBe(0);
  });

  it('the network delivering every push twice changes nothing', async () => {
    const conn = cloud.connect(authOf(env));
    conn.faults.deliverTwice = true;
    queueSales(env, 15);
    await drain(conn);
    expect(new Set(cloud.store.appliedIds).size).toBe(cloud.store.appliedIds.length);
    expect(unsentCount(env)).toBe(0);
  });

  it('never trusts an ack for an event it did not send', async () => {
    queueSales(env, 3);
    const liar: CloudAdapter = {
      push: async (req) => ({
        results: [
          ...req.events.slice(0, 1).map((e) => ({ id: e.id, status: 'applied' as const })),
          { id: 'not-ours', status: 'applied' as const },
        ],
      }),
    };
    const r = await pushOutbox(env.db, liar, { now });
    expect(r.acked).toBe(1);
    expect(getSyncStatus(env.db).pending).toBeGreaterThan(0);
  });
});

describe('out-of-order and partial failure', () => {
  it('batches delivered in reverse order end in the same cloud state', async () => {
    const conn = cloud.connect(authOf(env));
    conn.faults.reverseBatches = true;
    const ids = queueSales(env, 40);
    await drain(conn);
    for (const id of ids) expect(cloud.store.document('sales', id)).toBeDefined();
    expect(unsentCount(env)).toBe(0);
  });

  it('a connection dropped mid-batch acks nothing; the retry finishes the batch with duplicates for the applied part', async () => {
    const conn = cloud.connect(authOf(env));
    await drain(conn);
    const before = cloud.store.appliedIds.length;
    queueSales(env, 10);
    conn.faults.dropAfterEvents = 4;
    const r1 = await pushOutbox(env.db, conn, { now, random: () => 0.5 });
    expect(r1.offline).toBe(true);
    expect(cloud.store.appliedIds.length - before).toBe(4); // the cloud applied part of the batch
    expect(unsentCount(env)).toBe(10); // ...but the branch has no ack, so it keeps all ten

    env.clock.ms += 16 * 60 * 1000;
    const r2 = await pushOutbox(env.db, conn, { now, random: () => 0.5 });
    expect(r2.acked).toBe(10);
    expect(cloud.store.appliedIds.length - before).toBe(10); // 4 duplicates, 6 newly applied
    expect(unsentCount(env)).toBe(0);
  });

  it('a rejected event is parked in the error queue and later events still flow', async () => {
    const conn = cloud.connect(authOf(env));
    await drain(conn);
    queueSales(env, 3);
    env.db.transaction((tx) => {
      // An event the cloud will refuse: it claims another tenant.
      tx.update(syncOutbox)
        .set({ tenantId: 'other-tenant' })
        .where(and(isNull(syncOutbox.ackAt)))
        .run();
    });
    queueSales(env, 2, 'later');
    await pushOutbox(env.db, conn, { now });
    const status = getSyncStatus(env.db);
    expect(status.rejected).toBe(3);
    expect(status.pending).toBe(0); // the two good events were delivered
    expect(cloud.store.document('sales', 'later-1')).toBeDefined();
  });
});

describe('clock skew', () => {
  it('a branch clock three days ahead is accepted and flagged, and its HLC never goes backwards', async () => {
    const conn = cloud.connect(authOf(env));
    await drain(conn);
    env.clock.ms += 3 * DAY; // branch PC clock wrong; cloud time (cloudNow) follows the same variable, so pin it
    const realCloud = new FakeCloud({ now: () => env.clock.ms - 3 * DAY });
    const skewed = realCloud.connect(authOf(env));
    queueSales(env, 5);
    const r = await pushOutbox(env.db, skewed, { now });
    expect(r.skewFlagged).toBe(5);
    expect(r.acked).toBe(5);

    env.clock.ms -= 3 * DAY; // the operator fixes the clock: stamps must not go backwards
    const rows = env.db.select().from(syncOutbox).all();
    queueSales(env, 1, 'after-fix');
    const last = env.db.select().from(syncOutbox).all().at(-1);
    // Only the sales stamped by the skewed test clock: first-run setup rows carry real wall-clock time.
    const maxBefore = rows
      .filter((x) => x.entityType === 'sales')
      .map((x) => x.hlc)
      .sort()
      .at(-1) as string;
    expect((last?.hlc ?? '') > maxBefore).toBe(true);
  });
});

describe('two branches edit the same master item', () => {
  const HO_BRANCH = '66666666-6666-7666-8666-666666666666';
  const HO_DEVICE = '77777777-7777-7777-8777-777777777771';

  async function run(order: 'branch-first' | 'ho-first') {
    const localCloud = new FakeCloud({ now: cloudNow });
    const branch = localCloud.connect(authOf(env, false));
    const ho = remoteSite(env, HO_BRANCH, HO_DEVICE, true, env.clock.ms);
    const hoConn = localCloud.connect(ho.auth);

    const created = ho.event('items', 'item-42', 'insert', {
      id: 'item-42',
      name: 'Cetrizine 10mg',
      retailRateUnitMicro: 5_000_000,
    });
    await hoConn.push({ idempotencyKey: created.id, epoch: 1, events: [created] });

    // Both edit the same version offline. The branch renames and lowers the price; HO renames later and raises the price.
    queueItemEdit(env, 'item-42', 'update', {
      name: 'Cetirizine 10mg (branch)',
      retailRateUnitMicro: 4_000_000,
      baseVersion: 1,
    });
    ho.time.ms += HOUR;
    const hoEdit = ho.event('items', 'item-42', 'update', {
      name: 'Cetirizine 10 mg',
      retailRateUnitMicro: 5_500_000,
      baseVersion: 1,
    });

    if (order === 'ho-first')
      await hoConn.push({ idempotencyKey: hoEdit.id, epoch: 1, events: [hoEdit] });
    await drain(branch);
    if (order === 'branch-first')
      await hoConn.push({ idempotencyKey: hoEdit.id, epoch: 1, events: [hoEdit] });
    return localCloud.store;
  }

  it('converges to the same item whichever edit arrives first; Head Office owns the price', async () => {
    const one = await run('branch-first');
    const two = await run('ho-first');
    for (const store of [one, two]) {
      const item = store.master('items', 'item-42');
      expect(item?.fields.retailRateUnitMicro).toBe(5_500_000); // Head Office price, not the branch's 4_000_000
      expect(item?.fields.name).toBe('Cetirizine 10 mg'); // HO renamed later (HLC), so last writer wins
      expect(
        store.conflicts.some(
          (c) => c.field === 'retailRateUnitMicro' && c.reason === 'head_office_wins',
        ),
      ).toBe(true);
      const nameLoss = store.conflicts.find((c) => c.field === 'name');
      expect(nameLoss?.loser.value).toBe('Cetirizine 10mg (branch)'); // the losing value is kept for review
    }
  });
});

describe('resync and repair', () => {
  it('re-pushes acknowledged events after the cloud is restored to an empty point', async () => {
    const conn = cloud.connect(authOf(env));
    queueSales(env, 12);
    await drain(conn);
    const acked =
      env.db.select({ n: count() }).from(syncOutbox).where(isNotNull(syncOutbox.ackAt)).get()?.n ??
      0;

    const restored = new FakeCloud({ now: cloudNow }); // cloud restored from an old backup: empty
    expect(requeueAcked(env.db)).toBe(acked);
    expect(unsentCount(env)).toBe(acked);
    await drain(restored.connect(authOf(env)));
    expect(restored.store.appliedIds).toHaveLength(acked);
    expect(unsentCount(env)).toBe(0);
    // Requeueing against a cloud that already has everything is harmless.
    requeueAcked(env.db);
    await drain(restored.connect(authOf(env)));
    expect(restored.store.appliedIds).toHaveLength(acked);
  });

  it('pulls master data after cursors, survives a failed apply, and can be re-pulled from scratch', async () => {
    const other = remoteSite(
      env,
      '88888888-8888-7888-8888-888888888881',
      '77777777-7777-7777-8777-777777777772',
      false,
      env.clock.ms,
    );
    const otherConn = cloud.connect(other.auth);
    const suppliers = [1, 2, 3, 4, 5].map((n) =>
      other.event('suppliers', `sup-${n}`, 'insert', { id: `sup-${n}`, name: `Supplier ${n}` }),
    );
    await otherConn.push({ idempotencyKey: 'k', epoch: 1, events: suppliers });

    const conn = cloud.connect(authOf(env));
    const applied: string[] = [];
    let failOnce = true;
    const options = {
      entityTypes: ['suppliers'],
      limit: 2,
      now,
      apply: (changes: { event: { entityId: string } }[]) => {
        if (failOnce && changes.some((c) => c.event.entityId === 'sup-3')) {
          failOnce = false;
          throw new Error('disk full');
        }
        applied.push(...changes.map((c) => c.event.entityId));
      },
    };
    await expect(pullChanges(env.db, conn, options)).rejects.toThrow('disk full');
    expect(getCursors(env.db, ['suppliers']).suppliers).toBe('2'); // the cursor stayed behind the failed page
    const summary = await pullChanges(env.db, conn, options);
    expect(applied).toEqual(['sup-1', 'sup-2', 'sup-3', 'sup-4', 'sup-5']);
    expect(summary.duplicates).toBe(0);

    // Nothing new: a second pull is empty.
    expect((await pullChanges(env.db, conn, options)).received).toBe(0);

    // Repair: forget the cursors and pull everything again.
    resetCursors(env.db, ['suppliers']);
    applied.length = 0;
    await pullChanges(env.db, conn, options);
    expect(applied).toHaveLength(5);
  });

  it('a hung cloud call times out instead of hanging the worker', async () => {
    queueSales(env, 2);
    const hung: CloudAdapter = { push: () => new Promise(() => undefined) };
    const r = await pushOutbox(env.db, hung, { now, timeoutMs: 30 });
    expect(r).toMatchObject({ offline: true, error: 'Cloud request timed out' });
    expect(getSyncStatus(env.db).pending).toBeGreaterThan(0);
  });
});
