import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../audit';
import { DomainError } from '../errors';
import { auditLog, branches, syncOutbox } from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { createJoinedBranchEnv } from './appliers/test-env';
import { issueBranchEnrollment, listBranches, registerBranch } from './branch-registry';

let env: TestEnv;
const ctx = () => env.ctx(env.setup.adminUserId);
const provider = () => Promise.resolve('access-token-for-tests');
const fakeCode = (code = 'SECRET-CODE-1') =>
  (() => Promise.resolve({ code, expiresAt: '2026-10-06T09:00:00.000Z' })) as never;

beforeEach(async () => {
  env = await createTestEnv();
});
afterEach(() => env.cleanup());

describe('Head Office branch registry', () => {
  it('registers a branch, queues the normal branches change and audits it', () => {
    const b = registerBranch(env.db, ctx(), { code: 'khi02', name: 'Test Branch Two' });
    expect(b).toMatchObject({ code: 'KHI02', isHeadOffice: false });
    expect(listBranches(env.db, env.setup.tenantId).map((x) => x.code)).toEqual(['KHI01', 'KHI02']);
    const event = env.db.select().from(syncOutbox).where(eq(syncOutbox.entityId, b.id)).get();
    expect(event).toMatchObject({ entityType: 'branches', op: 'insert' });
    expect(verifyAuditChain(env.db, env.setup.branchId).ok).toBe(true);
  });

  it('rejects a bad or duplicate code', () => {
    registerBranch(env.db, ctx(), { code: 'KHI02', name: 'Test Branch Two' });
    expect(() => registerBranch(env.db, ctx(), { code: 'KHI02', name: 'Another' })).toThrow(
      /already used/,
    );
    expect(() => registerBranch(env.db, ctx(), { code: '2X', name: 'Bad Code' })).toThrow(
      DomainError,
    );
    expect(() => registerBranch(env.db, ctx(), { code: 'KHI03', name: 'x' })).toThrow(/too short/);
  });

  it('only Head Office can add branches', async () => {
    const branch = await createJoinedBranchEnv(env, { code: 'KHI02', name: 'Test Branch Two' });
    try {
      expect(() =>
        registerBranch(branch.db, branch.ctx(branch.setup.adminUserId), {
          code: 'KHI03',
          name: 'Third',
        }),
      ).toThrow(/Only Head Office/);
    } finally {
      branch.cleanup();
    }
  });
});

describe('enrollment codes', () => {
  const cloud = (over: Record<string, unknown> = {}) => ({
    cloudUrl: 'https://cloud.example.test',
    provider,
    createCode: fakeCode(),
    ...over,
  });

  it('adds the branch and returns the code once; the code is not written to the audit log', async () => {
    const r = await issueBranchEnrollment(
      env.db,
      ctx(),
      { code: 'KHI02', name: 'Test Branch Two' },
      cloud(),
    );
    expect(r).toMatchObject({ code: 'SECRET-CODE-1', branchCreated: true });
    const audits = env.db.select().from(auditLog).all();
    expect(audits.some((a) => a.action === 'branch.enrollment_code.create')).toBe(true);
    expect(JSON.stringify(audits)).not.toContain('SECRET-CODE-1');
  });

  it('a second request for the same branch issues a new code without a second branch row', async () => {
    await issueBranchEnrollment(env.db, ctx(), { code: 'KHI02', name: 'Test Branch Two' }, cloud());
    const again = await issueBranchEnrollment(
      env.db,
      ctx(),
      { code: 'KHI02', name: 'test branch two' },
      cloud({ createCode: fakeCode('SECRET-CODE-2') }),
    );
    expect(again).toMatchObject({ code: 'SECRET-CODE-2', branchCreated: false });
    expect(env.db.select().from(branches).all()).toHaveLength(2);
    await expect(
      issueBranchEnrollment(env.db, ctx(), { code: 'KHI02', name: 'Different Name' }, cloud()),
    ).rejects.toThrow(/already used by/);
    await expect(
      issueBranchEnrollment(env.db, ctx(), { code: 'KHI01', name: 'Test Branch One' }, cloud()),
    ).rejects.toThrow(/already part/);
  });

  it('keeps the branch when the cloud cannot be reached, and a retry gets the code', async () => {
    const failing = cloud({
      createCode: () => Promise.reject(new Error('Could not reach the cloud')),
    });
    await expect(
      issueBranchEnrollment(env.db, ctx(), { code: 'KHI02', name: 'Test Branch Two' }, failing),
    ).rejects.toThrow(/branch was added here, but the cloud did not issue a code/);
    expect(env.db.select().from(branches).all()).toHaveLength(2);
    const retry = await issueBranchEnrollment(
      env.db,
      ctx(),
      { code: 'KHI02', name: 'Test Branch Two' },
      cloud(),
    );
    expect(retry.code).toBe('SECRET-CODE-1');
  });
});
