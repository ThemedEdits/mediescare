/**
 * Branch join (new PC, e.g. KHI02) against Head Office through the in-memory cloud. The enrollment
 * call is a fake that returns what the real `enroll` returns: no real cloud was used.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MASTER_ENTITIES,
  FakeCloud,
  MemoryTokenStore,
  newId,
  type EnrollResult,
} from '@mediescare/sync';
import { verifyAuditChain } from '../audit';
import { openDatabase, type OpenDatabase } from '../client';
import { isInitialized } from '../firstRun';
import { runMigrations } from '../migrate';
import { getItem, searchItems } from '../pharmacy/catalog';
import { createCategory, createSupplier } from '../pharmacy/lookups';
import { branches, customers, items, syncOutbox, units } from '../schema/sqlite-all';
import { getServerIdentity } from '../identity';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { pushOutbox } from '../syncWorker';
import { createItemAt, rateOf } from './appliers/test-env';
import { issueBranchEnrollment, registerBranch } from './branch-registry';
import { joinOrganisation, JoinError, type JoinDeps, type JoinProgress } from './join-organisation';
import { authOf } from './test-support';

let ho: TestEnv;
let cloud: FakeCloud;
let live: OpenDatabase;
let dir: string;
let tokens: MemoryTokenStore;
let keyHex: string;

const adminInput = {
  username: 'owner',
  fullName: 'Branch Owner',
  passwordHash: 'x-not-a-real-hash',
};

async function pushHeadOffice() {
  const conn = cloud.connect(authOf(ho, true));
  for (let i = 0; i < 50; i++) {
    const r = await pushOutbox(ho.db, conn, {
      now: () => new Date(ho.clock.ms),
      random: () => 0.5,
      batchSize: 100,
    });
    if (r.acked + r.rejected === 0) break;
  }
}

function enrollmentFor(branch: { id: string; code: string; name: string }): EnrollResult {
  return {
    deviceId: newId(),
    tenantId: ho.setup.tenantId,
    tenantName: 'Test Pharmacy Group',
    branch: { ...branch, isHeadOffice: false },
    accessToken: 'access-token-for-tests',
    refreshToken: 'refresh-token-for-tests',
    accessExpiresAt: new Date(ho.clock.ms + 15 * 60_000).toISOString(),
  };
}

function depsFor(
  enrolled: EnrollResult,
  over: Partial<JoinDeps> = {},
): JoinDeps & { offline: { on: boolean } } {
  const offline = { on: false };
  return {
    offline,
    enroll: () => Promise.resolve(enrolled),
    createAdapter: () => {
      const conn = cloud.connect({
        tenantId: enrolled.tenantId,
        branchId: enrolled.branch.id,
        deviceId: enrolled.deviceId,
        headOffice: false,
      });
      const pull = conn.pull.bind(conn);
      conn.pull = (request) => {
        if (offline.on) throw new Error('ECONNRESET (test network down)');
        return pull(request);
      };
      return conn;
    },
    tokenStore: tokens,
    live,
    stagingFile: join(dir, 'mediescare.join.db'),
    keyHex,
    now: () => new Date(ho.clock.ms),
    ...over,
  };
}

beforeEach(async () => {
  ho = await createTestEnv();
  cloud = new FakeCloud({
    now: () => ho.clock.ms,
    masterEntities: [...DEFAULT_MASTER_ENTITIES, 'branches'],
  });
  dir = mkdtempSync(join(tmpdir(), 'mediescare-join-'));
  keyHex = randomBytes(32).toString('hex');
  live = openDatabase({ file: join(dir, 'mediescare.db'), keyHex });
  runMigrations(live.db);
  tokens = new MemoryTokenStore();
});
afterEach(() => {
  ho.cleanup();
  live.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('joining an existing organisation', () => {
  it('creates the branch database with Head Office data, tokens, and a working outbox', async () => {
    const cat = createCategory(ho.db, ho.ctx(ho.setup.adminUserId), 'Antibiotics');
    createSupplier(ho.db, ho.ctx(ho.setup.adminUserId), { name: 'Test Distributor' });
    const itemId = createItemAt(ho, {
      name: 'Cefixime 400mg',
      categoryId: cat,
      barcodes: ['8961002220001'],
      retailRateUnitMicro: rateOf('85.00'),
    });
    const branch = registerBranch(ho.db, ho.ctx(ho.setup.adminUserId), {
      code: 'KHI02',
      name: 'Test Branch Two',
    });
    await pushHeadOffice();
    const enrolled = enrollmentFor(branch);
    const stages: string[] = [];
    let last: JoinProgress | null = null;
    const result = await joinOrganisation(
      depsFor(enrolled, {
        onProgress: (p) => {
          if (stages.at(-1) !== p.stage) stages.push(p.stage);
          last = p;
        },
      }),
      {
        cloudUrl: 'https://cloud.example.test',
        code: 'ABCD-EFGH',
        deviceName: 'KHI02-PC',
        admin: adminInput,
      },
    );

    expect(stages).toEqual(['enrolling', 'preparing', 'syncing', 'checking', 'saving', 'done']);
    expect((last as JoinProgress | null)?.byType.items).toBe(1);
    expect(result.branchCode).toBe('KHI02');
    expect(isInitialized(live.db)).toBe(true);
    expect(getServerIdentity(live.db)).toEqual({
      tenantId: ho.setup.tenantId,
      branchId: branch.id,
      deviceId: enrolled.deviceId,
    });
    const rows = live.db
      .select()
      .from(branches)
      .all()
      .map((b) => [b.code, b.isHeadOffice]);
    expect(rows.sort()).toEqual([
      ['KHI01', true],
      ['KHI02', false],
    ]);
    expect(getItem(live.db, ho.setup.tenantId, itemId).retailRateUnitMicro).toBe(rateOf('85.00'));
    expect(
      searchItems(
        live.db,
        {
          tenantId: ho.setup.tenantId,
          branchId: branch.id,
          deviceId: enrolled.deviceId,
          userId: null,
          clock: ho.ctx(null).clock,
        },
        'cefix',
      )[0]?.id,
    ).toBe(itemId);
    expect(live.db.select({ n: count() }).from(units).get()?.n).toBe(9); // Head Office's units, not a second set
    expect(live.db.select({ n: count() }).from(customers).get()?.n).toBe(1); // local walk-in customer
    expect(verifyAuditChain(live.db, branch.id).ok).toBe(true);

    // The stored credentials are what the sync runner needs next; staging is gone.
    expect(await tokens.load()).toMatchObject({
      deviceId: enrolled.deviceId,
      branchId: branch.id,
      cloudUrl: 'https://cloud.example.test',
    });
    expect(existsSync(join(dir, 'mediescare.join.db'))).toBe(false);

    // Nothing pulled is queued for upload, and the branch's own first events are accepted by the cloud.
    expect(
      live.db.select().from(syncOutbox).where(eq(syncOutbox.entityType, 'items')).all(),
    ).toHaveLength(0);
    const conn = cloud.connect({
      tenantId: enrolled.tenantId,
      branchId: branch.id,
      deviceId: enrolled.deviceId,
      headOffice: false,
    });
    const pushed = await pushOutbox(live.db, conn, { batchSize: 200, random: () => 0.5 });
    expect(pushed.rejected).toBe(0);
    expect(pushed.acked).toBeGreaterThan(0);
    expect(live.db.select({ n: count() }).from(items).get()?.n).toBe(1);
  });

  it('leaves nothing behind when enrollment fails, and can be retried', async () => {
    const branch = registerBranch(ho.db, ho.ctx(ho.setup.adminUserId), {
      code: 'KHI02',
      name: 'Test Branch Two',
    });
    await pushHeadOffice();
    const enrolled = enrollmentFor(branch);
    const input = {
      cloudUrl: 'https://cloud.example.test',
      code: 'WRONG',
      deviceName: 'PC',
      admin: adminInput,
    };
    await expect(
      joinOrganisation(
        depsFor(enrolled, {
          enroll: () =>
            Promise.reject(new Error('The enrollment code is wrong, expired or already used')),
        }),
        input,
      ),
    ).rejects.toThrow(/enrollment code is wrong/);
    expect(isInitialized(live.db)).toBe(false);
    expect(await tokens.load()).toBeNull();
    // Retry with a good code.
    await joinOrganisation(depsFor(enrolled), { ...input, code: 'GOOD' });
    expect(isInitialized(live.db)).toBe(true);
  });

  it('leaves the live database untouched when the network drops during the first sync, then retries', async () => {
    createItemAt(ho, { name: 'Panadol' });
    const branch = registerBranch(ho.db, ho.ctx(ho.setup.adminUserId), {
      code: 'KHI02',
      name: 'Test Branch Two',
    });
    await pushHeadOffice();
    const enrolled = enrollmentFor(branch);
    const deps = depsFor(enrolled);
    deps.offline.on = true;
    const input = {
      cloudUrl: 'https://cloud.example.test',
      code: 'ABCD',
      deviceName: 'PC',
      admin: adminInput,
    };
    await expect(joinOrganisation(deps, input)).rejects.toBeInstanceOf(JoinError);
    expect(isInitialized(live.db)).toBe(false);
    expect(live.db.select({ n: count() }).from(items).get()?.n).toBe(0);
    expect(existsSync(join(dir, 'mediescare.join.db'))).toBe(false);
    expect(await tokens.load()).toBeNull();

    deps.offline.on = false;
    await joinOrganisation(deps, input);
    expect(live.db.select({ n: count() }).from(items).get()?.n).toBe(1);
  });

  it('refuses a code that belongs to Head Office', async () => {
    const enrolled = enrollmentFor({ id: ho.setup.branchId, code: 'KHI01', name: 'Head' });
    enrolled.branch.isHeadOffice = true;
    await expect(
      joinOrganisation(depsFor(enrolled), {
        cloudUrl: 'https://cloud.example.test',
        code: 'X',
        deviceName: 'PC',
        admin: adminInput,
      }),
    ).rejects.toThrow(/belongs to Head Office/);
    expect(isInitialized(live.db)).toBe(false);
  });

  it('joins under the branch id Head Office reserved in the enrollment code (no disagreement)', async () => {
    let reservedId: string | undefined;
    const issued = await issueBranchEnrollment(
      ho.db,
      ho.ctx(ho.setup.adminUserId),
      { code: 'KHI02', name: 'Test Branch Two' },
      {
        cloudUrl: 'https://cloud.example.test',
        provider: () => Promise.resolve('token'),
        createCode: ((_p: unknown, input: { branchId?: string }) => {
          reservedId = input.branchId;
          return Promise.resolve({ code: 'CODE', expiresAt: '2026-10-06T09:00:00.000Z' });
        }) as never,
      },
    );
    await pushHeadOffice();
    // The real cloud enrolls under the reserved id: `code.branch_id ?? newId()` (device-auth.ts).
    const enrolled = enrollmentFor({
      id: reservedId ?? newId(),
      code: 'KHI02',
      name: 'Test Branch Two',
    });
    const result = await joinOrganisation(depsFor(enrolled), {
      cloudUrl: 'https://cloud.example.test',
      code: 'CODE',
      deviceName: 'PC',
      admin: adminInput,
    });
    expect(result.branchId).toBe(issued.branch.id);
    expect(isInitialized(live.db)).toBe(true);
  });

  it('refuses when Head Office and the cloud disagree about the branch record', async () => {
    registerBranch(ho.db, ho.ctx(ho.setup.adminUserId), { code: 'KHI02', name: 'Test Branch Two' });
    await pushHeadOffice();
    // The cloud enrolled the PC under a different id than the one Head Office announced for this code.
    const enrolled = enrollmentFor({ id: newId(), code: 'KHI02', name: 'Test Branch Two' });
    await expect(
      joinOrganisation(depsFor(enrolled), {
        cloudUrl: 'https://cloud.example.test',
        code: 'X',
        deviceName: 'PC',
        admin: adminInput,
      }),
    ).rejects.toThrow(/disagree about this branch/);
    expect(isInitialized(live.db)).toBe(false);
    expect(await tokens.load()).toBeNull();
  });

  it('rejects an invalid cloud address before contacting anything', async () => {
    const branch = registerBranch(ho.db, ho.ctx(ho.setup.adminUserId), {
      code: 'KHI02',
      name: 'Test Branch Two',
    });
    let called = false;
    await expect(
      joinOrganisation(
        depsFor(enrollmentFor(branch), {
          enroll: () => {
            called = true;
            return Promise.reject(new Error('no'));
          },
        }),
        { cloudUrl: 'http://plain.example.test', code: 'X', deviceName: 'PC', admin: adminInput },
      ),
    ).rejects.toThrow(/https/);
    expect(called).toBe(false);
  });
});
