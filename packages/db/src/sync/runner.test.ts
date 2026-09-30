import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeCloud, type CloudAdapter } from '@mediescare/sync';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { disabledSyncStatus, SyncRunner } from './runner';
import { authOf, queueSales, unsentCount } from './test-support';

let env: TestEnv;
const now = () => new Date(env.clock.ms);

beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

describe('SyncRunner status and behaviour', () => {
  it('reports disabled status when sync is not configured', () => {
    const s = disabledSyncStatus(env.db, now());
    expect(s).toMatchObject({ enabled: false, state: 'disabled', serverEpoch: 1, cloudHost: null });
    expect(s.pending).toBeGreaterThan(0); // first-run rows wait in the outbox, harmlessly
  });

  it('goes offline with backoff and an error, then recovers on "sync now"', async () => {
    const cloud = new FakeCloud({ now: () => env.clock.ms });
    const conn = cloud.connect(authOf(env, false));
    conn.faults.offline = true;
    const runner = new SyncRunner({
      db: env.db,
      adapter: conn,
      now,
      random: () => 0.5,
      cloudHost: 'cloud.example.test',
    });

    await runner.runOnce();
    const offline = runner.status();
    expect(offline).toMatchObject({
      enabled: true,
      state: 'offline',
      consecutiveFailures: 1,
      lastSuccessAt: null,
      cloudHost: 'cloud.example.test',
    });
    expect(offline.lastError?.message).toMatch(/offline/);
    expect(offline.pending).toBeGreaterThan(0);
    expect(offline.oldestPendingAgeSeconds).toBe(0);

    env.clock.ms += 3600_000;
    expect(runner.status().oldestPendingAgeSeconds).toBe(3600);

    conn.faults.offline = false;
    runner.nudge(); // clears backoff; the runner is not started so we run the cycle ourselves
    await runner.runOnce();
    const ok = runner.status();
    expect(ok).toMatchObject({
      state: 'idle',
      pending: 0,
      consecutiveFailures: 0,
      lastError: null,
    });
    expect(ok.lastSuccessAt).toBe(now().toISOString());
    expect(unsentCount(env)).toBe(0);
  });

  it('a revoked device token shows as an error state, not as plain offline', async () => {
    const cloud = new FakeCloud({ now: () => env.clock.ms });
    const conn = cloud.connect(authOf(env));
    conn.faults.revoked = true;
    const runner = new SyncRunner({ db: env.db, adapter: conn, now, random: () => 0.5 });
    await runner.runOnce();
    expect(runner.status().state).toBe('error');
    expect(runner.status().lastError?.message).toMatch(/token/i);
  });

  it('drains a large backlog in one cycle and flags a skewed clock', async () => {
    const cloud = new FakeCloud({ now: () => env.clock.ms - 3 * 24 * 3600_000 });
    const runner = new SyncRunner({
      db: env.db,
      adapter: cloud.connect(authOf(env)),
      now,
      batchSize: 50,
      maxBatchesPerCycle: 10,
    });
    queueSales(env, 320);
    await runner.runOnce();
    expect(runner.status()).toMatchObject({ pending: 0, state: 'idle', clockSkewSuspected: true });
  });

  it('the POS is never blocked: writes proceed while a cloud call hangs, and stop() ends the loop', async () => {
    let release: () => void = () => undefined;
    const hung: CloudAdapter = {
      push: () =>
        new Promise((resolve) => {
          release = () => resolve({ results: [] });
        }),
    };
    const runner = new SyncRunner({ db: env.db, adapter: hung, now });
    const cycle = runner.runOnce(); // in flight, awaiting the "network"
    const t0 = performance.now();
    queueSales(env, 50); // a POS burst: synchronous transactions on the same database
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(runner.status().state).toBe('syncing');
    release();
    await cycle;
    runner.stop();
  });

  it('start() runs cycles on a timer and stop() halts them', async () => {
    const cloud = new FakeCloud({ now: () => env.clock.ms });
    const conn = cloud.connect(authOf(env));
    const runner = new SyncRunner({ db: env.db, adapter: conn, intervalMs: 500 });
    runner.start();
    runner.nudge(); // run now instead of waiting for the first 1 s tick
    for (let i = 0; i < 100 && unsentCount(env) > 0; i++)
      await new Promise((r) => setTimeout(r, 20));
    runner.stop();
    expect(unsentCount(env)).toBe(0);
    const pushes = conn.pushes.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(conn.pushes.length).toBe(pushes);
  });
});
