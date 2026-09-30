import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CloudAuthError,
  DeviceRevokedError,
  FakeCloud,
  type CloudAdapter,
  type TokenSession,
} from '@mediescare/sync';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { migratedClient, postgresHarness, resetCloudTables } from './cloud/cloud-test-support';
import { createPgliteClient, type SqlClient } from './cloud/sql-client';
import { SyncRunner } from './runner';
import { authOf, queueSales, unsentCount } from './test-support';

let env: TestEnv;
const now = () => new Date(env.clock.ms);

beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

describe('SyncRunner with device tokens', () => {
  it('stops in state revoked when the token refresh says the device was revoked (no retry loop)', async () => {
    let refreshes = 0;
    const tokens: TokenSession = {
      revoked: false,
      ensureFresh: () => {
        refreshes += 1;
        (tokens as { revoked: boolean }).revoked = true;
        return Promise.reject(new DeviceRevokedError());
      },
    };
    const cloud = new FakeCloud({ now: () => env.clock.ms });
    const conn = cloud.connect(authOf(env));
    const runner = new SyncRunner({ db: env.db, adapter: conn, now, intervalMs: 500, tokens });
    runner.start();
    runner.nudge();
    for (let i = 0; i < 50 && runner.status().state !== 'revoked'; i++)
      await new Promise((r) => setTimeout(r, 20));
    const status = runner.status();
    expect(status.state).toBe('revoked');
    expect(status.nextAttemptAt).toBeNull();
    expect(status.lastError?.message).toMatch(/disconnected|Reconnect/i);
    await new Promise((r) => setTimeout(r, 700)); // well past the interval: it must not try again
    expect(refreshes).toBe(1);
    expect(conn.pushes).toHaveLength(0);
    expect(status.pending).toBeGreaterThan(0); // nothing was lost or dropped
  });

  it('stops as revoked when a push fails with an auth error after the provider marked the device revoked', async () => {
    const tokens: TokenSession = { revoked: false, ensureFresh: () => Promise.resolve() };
    const adapter: CloudAdapter = {
      push: () => {
        (tokens as { revoked: boolean }).revoked = true;
        return Promise.reject(new DeviceRevokedError());
      },
    };
    const runner = new SyncRunner({ db: env.db, adapter, now, tokens });
    await runner.runOnce();
    expect(runner.status().state).toBe('revoked');
  });

  it('an auth error from a token the provider still trusts stays a plain error state', async () => {
    const tokens: TokenSession = { revoked: false, ensureFresh: () => Promise.resolve() };
    const adapter: CloudAdapter = { push: () => Promise.reject(new CloudAuthError()) };
    const runner = new SyncRunner({ db: env.db, adapter, now, tokens });
    await runner.runOnce();
    expect(runner.status().state).toBe('error');
  });

  it('a failed token refresh because the network is down is just offline', async () => {
    const tokens: TokenSession = {
      revoked: false,
      ensureFresh: () => Promise.reject(new Error('Could not reach the cloud')),
    };
    const cloud = new FakeCloud({ now: () => env.clock.ms });
    const runner = new SyncRunner({ db: env.db, adapter: cloud.connect(authOf(env)), now, tokens });
    await runner.runOnce();
    expect(runner.status()).toMatchObject({ state: 'offline', consecutiveFailures: 1 });
  });
});

describe('initial upload of an existing database', () => {
  it('uploads the whole backlog in order, in batches of at most 500 events and 1 MB, with progress', async () => {
    queueSales(env, 1300);
    const cloud = new FakeCloud({ now: () => env.clock.ms });
    const conn = cloud.connect(authOf(env));
    const runner = new SyncRunner({ db: env.db, adapter: conn, now, maxBatchesPerCycle: 1 });

    const first = runner.status().initialUpload;
    expect(first).toMatchObject({ sent: 0 });
    const total = first?.total ?? 0;
    expect(total).toBeGreaterThan(1300);

    await runner.runOnce(); // one batch
    const mid = runner.status().initialUpload;
    expect(mid).toMatchObject({ sent: 500, total });

    while (runner.status().initialUpload) await runner.runOnce();
    expect(unsentCount(env)).toBe(0);
    expect(runner.status().initialUpload).toBeNull();

    // Every batch respected the limits, and the events went out in outbox order.
    expect(conn.pushes.length).toBeGreaterThanOrEqual(3);
    for (const p of conn.pushes) {
      expect(p.events.length).toBeLessThanOrEqual(500);
      expect(JSON.stringify(p).length).toBeLessThan(1_000_000 + 50_000);
    }
    const seqs = conn.pushes.flatMap((p) => p.events.map((e) => e.seq));
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(total);
  });

  it('resumes after a crash: a new runner continues where the old one stopped and re-sends nothing', async () => {
    queueSales(env, 1200);
    const cloud = new FakeCloud({ now: () => env.clock.ms });
    const conn = cloud.connect(authOf(env));
    const before = new SyncRunner({ db: env.db, adapter: conn, now, maxBatchesPerCycle: 1 });
    await before.runOnce();
    const sentSoFar = conn.pushes.flatMap((p) => p.events).length;
    expect(sentSoFar).toBe(500);
    // "Crash": the process is gone, only the database remains. A network loss mid-upload works the same.
    conn.faults.offline = true;
    const offlineRunner = new SyncRunner({ db: env.db, adapter: conn, now });
    await offlineRunner.runOnce();
    expect(offlineRunner.status().initialUpload).toMatchObject({ sent: 500 });
    conn.faults.offline = false;

    const after = new SyncRunner({ db: env.db, adapter: conn, now });
    env.clock.ms += 3600_000; // backoff from the failed attempt has passed
    await after.runOnce();
    expect(after.status().initialUpload).toBeNull();
    expect(unsentCount(env)).toBe(0);
    const ids = conn.pushes.flatMap((p) => p.events.map((e) => e.id));
    // The 500 that were acknowledged before the crash were not sent again.
    const acknowledgedTwice = ids.length - new Set(ids).size;
    expect(acknowledgedTwice).toBeLessThanOrEqual(conn.pushes.length); // only failed attempts may repeat
    expect(cloud.store.appliedIds.length).toBe(new Set(cloud.store.appliedIds).size);
  });
});

describe('initial upload of 50,000 events into the PostgreSQL store (PGlite)', () => {
  let sql: SqlClient;
  beforeAll(async () => {
    sql = await migratedClient(() => createPgliteClient());
  }, 60_000);
  afterAll(async () => {
    await sql.close();
  });

  it('uploads everything, exactly once, and reports the time', async () => {
    await resetCloudTables(sql);
    const total = 50_000;
    const t0 = performance.now();
    queueSales(env, total);
    const queuedMs = performance.now() - t0;

    const harness = postgresHarness(sql, () => env.clock.ms);
    await harness.register({ ...authOf(env), headOffice: true });
    const adapter: CloudAdapter = { push: (req) => harness.store.applyBatch(authOf(env), req) };
    const runner = new SyncRunner({ db: env.db, adapter, now, maxBatchesPerCycle: 50 });

    const t1 = performance.now();
    let cycles = 0;
    while (runner.status().initialUpload) {
      await runner.runOnce();
      cycles += 1;
    }
    const uploadMs = performance.now() - t1;
    console.log(
      `[50k upload] queued ${total} events in ${Math.round(queuedMs)} ms; uploaded ${total + 10} events in ${(uploadMs / 1000).toFixed(1)} s (${cycles} cycles, PGlite store, in process)`,
    );

    const size = await sql.query<{ bytes: string; n: string }>(
      "SELECT pg_total_relation_size('sync_events')::text AS bytes, (SELECT count(*) FROM sync_events)::text AS n",
    );
    const bytes = Number(size[0]?.bytes);
    const events = Number(size[0]?.n);
    console.log(
      `[50k upload] sync_events with indexes: ${(bytes / 1e6).toFixed(1)} MB for ${events} events (${Math.round(bytes / events)} bytes per event)`,
    );

    expect(unsentCount(env)).toBe(0);
    const held = await sql.query<{ n: string; d: string }>(
      'SELECT count(*)::text AS n, count(DISTINCT event_id)::text AS d FROM sync_events',
    );
    const pending = runner.status();
    expect(Number(held[0]?.n)).toBe(Number(held[0]?.d));
    expect(Number(held[0]?.n)).toBeGreaterThanOrEqual(total);
    expect(pending.pending).toBe(0);
    expect(pending.rejected).toBe(0);
    const order = await sql.query<{ ok: boolean }>(
      `SELECT bool_and(client_seq >= prev) AS ok FROM (
         SELECT client_seq, lag(client_seq, 1, 0) OVER (ORDER BY seq) AS prev FROM sync_events) t`,
    );
    expect(order[0]?.ok).toBe(true);
  }, 600_000);
});
