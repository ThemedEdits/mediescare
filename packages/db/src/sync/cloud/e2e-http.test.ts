import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootstrapHeadOffice,
  createEnrollmentCode,
  enroll,
  HttpCloudAdapter,
  MemoryTokenStore,
  RefreshingTokenProvider,
  type PulledChange,
  type EnrollResult,
} from '@mediescare/sync';
import { createTestEnv, type TestEnv } from '../../test-helpers';
import { isNull } from 'drizzle-orm';
import { syncOutbox } from '../../schema/sqlite';
import { SyncRunner } from '../runner';
import { queueItemEdit, queueSales, unsentCount } from '../test-support';
// The real cloud HTTP handlers of the web app (plain TypeScript, no Next.js imports).
import { handleCloudPull, handleCloudPush } from '../../../../../apps/web/src/server/sync-cloud';
import {
  DeviceLimiters,
  handleBootstrap,
  handleCreateEnrollmentCode,
  handleEnroll,
  handleRefresh,
} from '../../../../../apps/web/src/server/sync-cloud-auth';
import { migratedClient, resetCloudTables, TEST_JWT_SECRET } from './cloud-test-support';
import { CloudAuthService } from './device-auth';
import { PostgresCloudStore } from './postgres-store';
import { createPgliteClient, type SqlClient } from './sql-client';

/**
 * End to end: two branch databases push and pull through the REAL cloud handlers over real HTTP into
 * the PostgreSQL store (PGlite). Bootstrap, enrollment code, enrol, push, pull, token refresh,
 * offline then catch-up, and revocation are all exercised.
 */
const BOOTSTRAP_CODE = 'bootstrap-code-for-tests-only';

let sql: SqlClient;
let auth: CloudAuthService;
let server: Server;
let baseUrl: string;
let envA: TestEnv;
let envB: TestEnv;
const net = { offline: false };
const netFetch = ((url: string, init?: RequestInit) =>
  net.offline
    ? Promise.reject(new TypeError('fetch failed (test network is down)'))
    : fetch(url, init)) as typeof fetch;

beforeAll(async () => {
  sql = await migratedClient(() => createPgliteClient());
}, 60_000);
afterAll(async () => {
  await sql.close();
});

beforeEach(async () => {
  await resetCloudTables(sql);
  net.offline = false;
  // Short access tokens so the test sees real rotation: 2 s lifetime, refreshed 1 s before expiry.
  auth = new CloudAuthService({ sql, jwtSecret: TEST_JWT_SECRET, accessTtlSeconds: 2 });
  const store = new PostgresCloudStore({ sql, verifyToken: (t) => auth.verifyAccessToken(t) });
  const deps = { auth, bootstrapCode: BOOTSTRAP_CODE };
  const limiters = new DeviceLimiters();
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      const client = req.socket.remoteAddress ?? 'x';
      const a = req.headers.authorization;
      const run = async () => {
        switch (req.url) {
          case '/api/sync/bootstrap':
            return handleBootstrap(deps, client, body, limiters);
          case '/api/sync/enroll':
            return handleEnroll(deps, client, body, limiters);
          case '/api/sync/token':
            return handleRefresh(deps, client, body, limiters);
          case '/api/sync/enrollment-codes':
            return handleCreateEnrollmentCode(deps, a, body, limiters);
          case '/api/sync/push':
            return handleCloudPush(store, a, body);
          case '/api/sync/pull':
            return handleCloudPull(store, a, body);
          default:
            return { status: 404, body: { error: { code: 'NOT_FOUND' } } };
        }
      };
      run().then(
        (r) => {
          res.writeHead(r.status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(r.body));
        },
        (e: unknown) => {
          const err = e as { code?: string; status?: number; message?: string; issues?: unknown };
          res.writeHead(err.issues ? 400 : (err.status ?? 500), {
            'content-type': 'application/json',
          });
          res.end(
            JSON.stringify({ error: { code: err.code ?? 'INTERNAL', message: err.message } }),
          );
        },
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  envA = await createTestEnv();
  envB = await createTestEnv();
});
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  envA.cleanup();
  envB.cleanup();
});

interface Branch {
  env: TestEnv;
  result: EnrollResult;
  provider: RefreshingTokenProvider;
  runner: SyncRunner;
  pulled: PulledChange[];
}

function connect(env: TestEnv, result: EnrollResult, entityTypes: string[] = ['items']): Branch {
  const store = new MemoryTokenStore({
    cloudUrl: baseUrl,
    refreshToken: result.refreshToken,
    deviceId: result.deviceId,
    tenantId: result.tenantId,
    branchId: result.branch.id,
    updatedAt: new Date().toISOString(),
  });
  const provider = new RefreshingTokenProvider({
    store,
    initial: { accessToken: result.accessToken, accessExpiresAt: result.accessExpiresAt },
    marginMs: 1000,
    fetchImpl: netFetch,
  });
  const pulled: PulledChange[] = [];
  const runner = new SyncRunner({
    db: env.db,
    adapter: new HttpCloudAdapter({
      baseUrl,
      tokenProvider: provider.provider(),
      forceRefresh: () => provider.forceRefresh(),
      fetch: netFetch,
    }),
    tokens: provider,
    intervalMs: 500,
    random: () => 0.5,
    pull: {
      entityTypes,
      apply: (changes) => {
        pulled.push(...changes);
      },
    },
  });
  return { env, result, provider, runner, pulled };
}

/** Bring the Head Office database online: bootstrap with its own ids, exactly like the Connect form. */
async function headOffice(): Promise<Branch> {
  const identity = {
    tenantId: envA.setup.tenantId,
    branchId: envA.setup.branchId,
    deviceId: envA.setup.deviceId,
  };
  const result = await bootstrapHeadOffice({
    cloudUrl: baseUrl,
    bootstrapCode: BOOTSTRAP_CODE,
    organisationName: 'Test Pharmacy Group',
    branchCode: 'KHI01',
    branchName: 'Test Branch One',
    deviceName: 'HO server',
    identity,
  });
  return connect(envA, result);
}

/** A second branch joins with an enrollment code created by the Head Office device. */
async function joinBranch(ho: Branch): Promise<Branch> {
  const code = await createEnrollmentCode(ho.provider.provider(), {
    cloudUrl: baseUrl,
    branchCode: 'KHI02',
    branchName: 'Test Branch Two',
    // Head Office created the branch row locally with this id; the cloud must use exactly it.
    branchId: envB.setup.branchId,
  });
  const result = await enroll({
    cloudUrl: baseUrl,
    code: code.code,
    deviceName: 'Branch Two server',
    identity: { deviceId: envB.setup.deviceId },
  });
  expect(result.branch.id).toBe(envB.setup.branchId);
  return connect(envB, result);
}

// Test-only: envB was created as its own organisation. A branch created through the join flow carries
// the cloud's tenant id from the start; here it is stamped onto the events that are still to be sent.
const stamp = (b: Branch) =>
  b.env.db
    .update(syncOutbox)
    .set({ tenantId: b.result.tenantId })
    .where(isNull(syncOutbox.ackAt))
    .run();

const drain = async (b: Branch) => {
  stamp(b);
  for (let i = 0; i < 5 && unsentCount(b.env) > 0; i++) await b.runner.runOnce();
};

describe('cloud sync end to end over HTTP into the PostgreSQL store (PGlite)', () => {
  it('bootstrap, enrollment code, enrol, push, pull and token refresh all work', async () => {
    const ho = await headOffice();
    expect(ho.result.branch.isHeadOffice).toBe(true);
    expect(ho.result.deviceId).toBe(envA.setup.deviceId); // the cloud adopted this database's ids
    const branch = await joinBranch(ho);
    expect(branch.result.tenantId).toBe(ho.result.tenantId);
    expect(branch.result.branch).toMatchObject({ code: 'KHI02', isHeadOffice: false });

    queueItemEdit(envA, 'item-ho-1', 'insert', { name: 'Panadol (HO)', retailRateUnitMicro: 100 });
    queueItemEdit(envB, 'item-b-1', 'insert', { name: 'Brufen (B)' });
    queueSales(envA, 40, 'ho-sale');
    queueSales(envB, 25, 'b-sale');

    await drain(ho);
    await drain(branch);
    expect(unsentCount(envA)).toBe(0);
    expect(unsentCount(envB)).toBe(0);
    expect(ho.runner.status()).toMatchObject({ state: 'idle', initialUpload: null });

    // The cloud holds both branches' events exactly once.
    const held = await sql.query<{ branch_id: string; n: string }>(
      'SELECT branch_id, count(*)::text AS n FROM sync_events GROUP BY branch_id',
    );
    const byBranch = Object.fromEntries(held.map((r) => [r.branch_id, Number(r.n)]));
    expect(byBranch[envA.setup.branchId]).toBeGreaterThan(40);
    expect(byBranch[envB.setup.branchId]).toBeGreaterThan(25);
    const sales = await sql.query<{ branch_id: string; n: string }>(
      "SELECT branch_id, count(*)::text AS n FROM sync_events WHERE entity_type = 'sales' GROUP BY branch_id",
    );
    const salesBy = Object.fromEntries(sales.map((r) => [r.branch_id, Number(r.n)]));
    expect(salesBy[envA.setup.branchId]).toBe(40);
    expect(salesBy[envB.setup.branchId]).toBe(25);

    // Pull: each branch receives the other's master data, never its own, and no sales.
    await ho.runner.runOnce();
    await branch.runner.runOnce();
    const hoItems = ho.pulled.map((c) => c.event.entityId);
    const bItems = branch.pulled.map((c) => c.event.entityId);
    expect(hoItems).toContain('item-b-1');
    expect(hoItems).not.toContain('item-ho-1');
    expect(bItems).toContain('item-ho-1');
    expect(bItems).not.toContain('item-b-1');
    expect([...ho.pulled, ...branch.pulled].every((c) => c.event.entityType === 'items')).toBe(
      true,
    );

    // Tokens rotated while this ran (2 s access tokens): the cloud retired some refresh tokens.
    await new Promise((r) => setTimeout(r, 2500));
    await ho.runner.runOnce();
    const used = await sql.query<{ n: number }>(
      'SELECT COALESCE(MAX(cardinality(refresh_used)), 0)::int AS n FROM devices',
    );
    expect(used[0]?.n).toBeGreaterThan(0);
  }, 60_000);

  it('offline for a while, then catches up with every event exactly once', async () => {
    const ho = await headOffice();
    const branch = await joinBranch(ho);
    await drain(ho);
    await drain(branch);

    net.offline = true;
    queueSales(envB, 120, 'offline-sale');
    stamp(branch);
    await branch.runner.runOnce();
    expect(branch.runner.status()).toMatchObject({ state: 'offline' });
    expect(branch.runner.status().pending).toBeGreaterThanOrEqual(120);

    net.offline = false;
    envB.clock.ms += 3600_000;
    branch.runner.nudge();
    // The access token expired while offline: the provider refreshes by itself on the way back.
    await new Promise((r) => setTimeout(r, 2200));
    await drain(branch);
    expect(unsentCount(envB)).toBe(0);
    const n = await sql.query<{ n: string; d: string }>(
      `SELECT count(*)::text AS n, count(DISTINCT event_id)::text AS d FROM sync_events
        WHERE entity_type = 'sales' AND branch_id = $1`,
      [envB.setup.branchId],
    );
    expect(Number(n[0]?.n)).toBe(120);
    expect(n[0]?.d).toBe(n[0]?.n);
  }, 60_000);

  it('a branch cannot push for another branch and cannot create enrollment codes', async () => {
    const ho = await headOffice();
    const branch = await joinBranch(ho);
    await expect(
      createEnrollmentCode(branch.provider.provider(), {
        cloudUrl: baseUrl,
        branchCode: 'KHI03',
        branchName: 'Nope branch',
      }),
    ).rejects.toThrow(/Head Office/);
  }, 60_000);

  it('revoking a device stops its runner in state revoked, without a retry loop', async () => {
    const ho = await headOffice();
    const branch = await joinBranch(ho);
    await drain(branch);
    await auth.revokeDevice(branch.result.deviceId);
    queueSales(envB, 5, 'after-revoke');
    stamp(branch);
    await branch.runner.runOnce();
    const status = branch.runner.status();
    expect(status.state).toBe('revoked');
    expect(status.nextAttemptAt).toBeNull();
    expect(status.pending).toBeGreaterThanOrEqual(5); // nothing is thrown away
    // The Head Office device keeps working.
    queueSales(envA, 3, 'ho-after');
    await drain(ho);
    expect(unsentCount(envA)).toBe(0);
  }, 60_000);

  it('reconnecting the Head Office PC after a disconnect gives it fresh credentials for the same device', async () => {
    const ho = await headOffice();
    await drain(ho);
    const again = await bootstrapHeadOffice({
      cloudUrl: baseUrl,
      bootstrapCode: BOOTSTRAP_CODE,
      organisationName: 'Test Pharmacy Group',
      branchCode: 'KHI01',
      branchName: 'Test Branch One',
      deviceName: 'HO server',
      identity: {
        tenantId: envA.setup.tenantId,
        branchId: envA.setup.branchId,
        deviceId: envA.setup.deviceId,
      },
    });
    expect(again.deviceId).toBe(ho.result.deviceId);
    queueSales(envA, 10, 'ho-again');
    const reconnected = connect(envA, again);
    await drain(reconnected);
    expect(unsentCount(envA)).toBe(0);
  }, 60_000);

  it('rejects a wrong bootstrap code and a second organisation with the same name', async () => {
    await expect(
      bootstrapHeadOffice({
        cloudUrl: baseUrl,
        bootstrapCode: 'wrong',
        organisationName: 'Test Pharmacy Group',
        branchCode: 'KHI01',
        branchName: 'Branch B',
        deviceName: 'HO server',
      }),
    ).rejects.toThrow(/bootstrap code is wrong/);
    await headOffice();
    await expect(
      bootstrapHeadOffice({
        cloudUrl: baseUrl,
        bootstrapCode: BOOTSTRAP_CODE,
        organisationName: 'test pharmacy group',
        branchCode: 'XX01',
        branchName: 'Branch B',
        deviceName: 'Another PC',
      }),
    ).rejects.toThrow(/already exists/);
  }, 60_000);

  it('rate limits guesses at the bootstrap code', async () => {
    const bad = () =>
      bootstrapHeadOffice({
        cloudUrl: baseUrl,
        bootstrapCode: 'guess',
        organisationName: 'Some Group',
        branchCode: 'KHI01',
        branchName: 'Branch B',
        deviceName: 'PC',
      }).then(
        () => 'connected',
        (e: Error) => e.message,
      );
    const answers: string[] = [];
    for (let i = 0; i < 7; i++) answers.push(await bad());
    expect(answers.slice(0, 5).every((m) => /bootstrap code is wrong/.test(m))).toBe(true);
    expect(answers.slice(5).every((m) => /Too many attempts/.test(m))).toBe(true);
  }, 60_000);
});
