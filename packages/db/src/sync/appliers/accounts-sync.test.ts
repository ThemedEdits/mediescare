/**
 * User accounts and roles from Head Office to a branch (ADR-0016): two real databases, the real outbox
 * worker and pull, joined by the in-memory cloud with the default master entities.
 */
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_MASTER_ENTITIES, FakeCloud, type FakeConnection } from '@mediescare/sync';
import { login } from '../../auth/login';
import { loadAccessContext } from '../../auth/access';
import { createRole } from '../../roles';
import { rolePermissions, roles, users } from '../../schema/sqlite-all';
import { createTestEnv, ADMIN_PASSWORD, SESSION_SECRET, type TestEnv } from '../../test-helpers';
import { pushOutbox } from '../../syncWorker';
import {
  changeOwnPassword,
  createUser,
  resetPassword,
  setUserActive,
  setUserBranches,
  setUserRoles,
} from '../../users';
import { pullChanges } from '../pull';
import { authOf } from '../test-support';
import { applierFor, createJoinedBranchEnv, pullTypes } from './test-env';

let ho: TestEnv;
let br: TestEnv;
let cloud: FakeCloud;
let hoConn: FakeConnection;
let brConn: FakeConnection;

const BRANCH_ADMIN_PASSWORD = 'correct-Horse-battery-9'; // createJoinedBranchEnv
const CASHIER_PASSWORD = 'Cashier-Password-2026';

async function push(env: TestEnv, conn: FakeConnection): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const r = await pushOutbox(env.db, conn, {
      now: () => new Date(env.clock.ms),
      random: () => 0.5,
      batchSize: 100,
    });
    if (r.acked + r.rejected === 0) return;
  }
}

async function pull(env: TestEnv, conn: FakeConnection) {
  return pullChanges(env.db, conn, {
    entityTypes: pullTypes(),
    apply: applierFor(env),
    limit: 200,
    maxPages: 1000,
    now: () => new Date(env.clock.ms),
  });
}

async function sync(): Promise<void> {
  await push(ho, hoConn);
  await push(br, brConn);
  await pull(br, brConn);
  await pull(ho, hoConn);
}

const signIn = (env: TestEnv, username: string, password: string) =>
  login(env.db, env.ctx(null), { username, password }, SESSION_SECRET);

const userByName = (env: TestEnv, username: string) =>
  env.db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, env.setup.tenantId), eq(users.username, username)))
    .get();

beforeEach(async () => {
  ho = await createTestEnv();
  br = await createJoinedBranchEnv(ho, { code: 'KHI02', name: 'Test Branch Two' });
  cloud = new FakeCloud({ now: () => ho.clock.ms, masterEntities: DEFAULT_MASTER_ENTITIES });
  hoConn = cloud.connect(authOf(ho, true));
  brConn = cloud.connect(authOf(br, false));
});
afterEach(() => {
  ho.cleanup();
  br.cleanup();
});

describe('accounts created at Head Office reach the branch', () => {
  it('a user made at Head Office for the branch can sign in at the branch PC', async () => {
    const { id } = await createUser(ho.db, ho.ctx(ho.setup.adminUserId), {
      username: 'cashier1',
      fullName: 'Test Cashier',
      password: CASHIER_PASSWORD,
      roleIds: [ho.roleId('cashier')],
      branchIds: [br.setup.branchId],
    });
    await sync();

    const result = await signIn(br, 'cashier1', CASHIER_PASSWORD);
    expect(result.user.id).toBe(id);
    const access = loadAccessContext(br.db, id);
    expect(access?.branchIds).toEqual([br.setup.branchId]);
    expect(access?.permissions.has('pharmacy.sale.create')).toBe(true);
    // The branch now uses Head Office's id for the standard cashier role (matched by code).
    expect(br.roleId('cashier')).toBe(ho.roleId('cashier'));
  });

  it('the branch owner keeps working; a clashing username is renamed to "-local"', async () => {
    // Both databases were set up with the username "admin".
    await sync();
    const hoAdmin = await signIn(br, 'admin', ADMIN_PASSWORD);
    expect(hoAdmin.user.id).toBe(ho.setup.adminUserId);
    const local = await signIn(br, 'admin-local', BRANCH_ADMIN_PASSWORD);
    expect(local.user.id).toBe(br.setup.adminUserId);
    expect(
      loadAccessContext(br.db, br.setup.adminUserId)?.permissions.has('admin.user.create'),
    ).toBe(true);
  });

  it('password resets, role changes and disabling at Head Office apply at the branch', async () => {
    const actor = ho.ctx(ho.setup.adminUserId);
    const { id } = await createUser(ho.db, actor, {
      username: 'pharm1',
      fullName: 'Test Pharmacist',
      password: CASHIER_PASSWORD,
      roleIds: [ho.roleId('cashier')],
      branchIds: [br.setup.branchId],
    });
    await sync();
    ho.clock.ms += 60_000;
    br.clock.ms += 60_000;

    const { temporaryPassword } = await resetPassword(ho.db, actor, id);
    setUserRoles(ho.db, actor, id, [ho.roleId('pharmacist_sr')]);
    await sync();
    await expect(signIn(br, 'pharm1', CASHIER_PASSWORD)).rejects.toThrow();
    const again = await signIn(br, 'pharm1', temporaryPassword);
    expect(again.user.mustChangePassword).toBe(true);
    expect(loadAccessContext(br.db, id)?.permissions.has('pharmacy.sale.refund')).toBe(
      loadAccessContext(ho.db, id)?.permissions.has('pharmacy.sale.refund'),
    );

    ho.clock.ms += 60_000;
    setUserActive(ho.db, actor, id, false);
    await sync();
    await expect(signIn(br, 'pharm1', temporaryPassword)).rejects.toThrow(/disabled/);
  });

  it('a custom role made at Head Office arrives with its permissions', async () => {
    const actor = ho.ctx(ho.setup.adminUserId);
    const roleId = createRole(ho.db, actor, {
      name: 'Night Counter',
      permissions: ['pharmacy.sale.view', 'pharmacy.sale.create'],
      discountLimitBp: 200,
      refundLimitMinor: 0,
      priceOverrideLimitBp: 0,
    });
    await sync();
    const local = br.db.select().from(roles).where(eq(roles.id, roleId)).get();
    expect(local?.name).toBe('Night Counter');
    const keys = br.db
      .select({ k: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId))
      .all()
      .map((r) => r.k)
      .sort();
    expect(keys).toEqual(['pharmacy.sale.create', 'pharmacy.sale.view']);
  });
});

describe('accounts made at a branch stay at that branch', () => {
  it('Head Office ignores users and role grants that come from a branch', async () => {
    await createUser(br.db, br.ctx(br.setup.adminUserId), {
      username: 'branchonly',
      fullName: 'Branch Only',
      password: CASHIER_PASSWORD,
      roleIds: [br.roleId('super_admin')],
      branchIds: [br.setup.branchId],
    });
    await sync();
    expect(userByName(ho, 'branchonly')).toBeUndefined();
    await expect(signIn(ho, 'branchonly', CASHIER_PASSWORD)).rejects.toThrow();
  });
});

describe('the owner-reported sequence (2026-10-14)', () => {
  it('branch joined as "arsalan11"; Head Office made its own "arsalan11", who changed the password', async () => {
    // The branch PC was set up with this username before Head Office created the same one.
    br.db
      .update(users)
      .set({ username: 'arsalan11' })
      .where(eq(users.id, br.setup.adminUserId))
      .run();
    const actor = ho.ctx(ho.setup.adminUserId);
    const { id, temporaryPassword } = await createUser(ho.db, actor, {
      username: 'arsalan11',
      fullName: 'Arsalan Test',
      roleIds: [ho.roleId('cashier')],
      branchIds: [ho.setup.branchId],
    });
    await sync();
    ho.clock.ms += 60_000;
    br.clock.ms += 60_000;
    // First sign-in at Head Office: the temporary password is replaced.
    const first = await signIn(ho, 'arsalan11', temporaryPassword as string);
    await changeOwnPassword(ho.db, ho.ctx(id), {
      userId: id,
      currentSessionId: first.sessionId,
      currentPassword: temporaryPassword as string,
      newPassword: 'Head-Office-Pass-2026',
    });
    ho.clock.ms += 60_000;
    setUserBranches(ho.db, actor, id, { branchIds: [], allBranches: true });
    await sync();

    const atBranch = await signIn(br, 'arsalan11', 'Head-Office-Pass-2026');
    expect(atBranch.user.id).toBe(id);
    const owner = await signIn(br, 'arsalan11-local', BRANCH_ADMIN_PASSWORD);
    expect(owner.user.id).toBe(br.setup.adminUserId);
  });
});

describe('lock-out at a branch', () => {
  it('says how long to wait, and a password reset at Head Office unlocks the branch too', async () => {
    const actor = ho.ctx(ho.setup.adminUserId);
    const { id } = await createUser(ho.db, actor, {
      username: 'locked1',
      fullName: 'Locked User',
      password: CASHIER_PASSWORD,
      roleIds: [ho.roleId('cashier')],
      branchIds: [br.setup.branchId],
    });
    await sync();
    for (let i = 0; i < 5; i++)
      await expect(signIn(br, 'locked1', 'wrong-Password-1')).rejects.toThrow();
    await expect(signIn(br, 'locked1', CASHIER_PASSWORD)).rejects.toThrow(
      /locked on this computer for 15 more minutes/,
    );

    ho.clock.ms += 60_000;
    br.clock.ms += 60_000;
    const { temporaryPassword } = await resetPassword(ho.db, actor, id);
    await sync();
    const ok = await signIn(br, 'locked1', temporaryPassword);
    expect(ok.user.id).toBe(id);
  });
});
