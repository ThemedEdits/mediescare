import { count, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from './audit';
import { AuthError, login } from './auth/login';
import { loginWithPin } from './auth/pin';
import { touchSession, verifySessionToken } from './auth/session';
import { DomainError } from './errors';
import { auditLog, sessions, syncOutbox, users } from './schema/sqlite';
import { ADMIN_PASSWORD, SESSION_SECRET, createTestEnv, type TestEnv } from './test-helpers';
import {
  changeOwnPassword,
  checkPin,
  clearPin,
  createUser,
  forceLogout,
  getUser,
  listUsers,
  resetPassword,
  setPin,
  setUserActive,
  setUserBranches,
  setUserRoles,
  updateUser,
} from './users';

let env: TestEnv;
let admin: string;

beforeEach(async () => {
  env = await createTestEnv();
  admin = env.setup.adminUserId;
});
afterEach(() => env.cleanup());

const expectDomain = async (p: Promise<unknown> | (() => unknown), code: string) => {
  const err = await (typeof p === 'function'
    ? Promise.resolve()
        .then(p)
        .catch((e: unknown) => e)
    : p.catch((e: unknown) => e));
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

describe('createUser', () => {
  it('creates a user with roles and branch scope, queues sync events, and keeps secrets out of the audit log', async () => {
    const before = env.db.select({ n: count() }).from(syncOutbox).get()?.n ?? 0;
    const { id, temporaryPassword } = await createUser(env.db, env.ctx(admin), {
      username: 'sara.cashier',
      fullName: 'Sara Test',
      phone: '0300-0000000',
      roleIds: [env.roleId('cashier')],
      branchIds: [env.setup.branchId],
    });
    expect(temporaryPassword).toHaveLength(14);
    const view = getUser(env.db, env.setup.tenantId, id);
    expect(view).toMatchObject({
      username: 'sara.cashier',
      roleCodes: ['cashier'],
      mustChangePassword: true,
      status: 'active',
      allBranches: false,
    });
    expect(view.branchIds).toEqual([env.setup.branchId]);
    expect((env.db.select({ n: count() }).from(syncOutbox).get()?.n ?? 0) - before).toBe(3); // user, role, branch scope
    const audit = JSON.stringify(env.db.select().from(auditLog).all());
    expect(audit).not.toMatch(/passwordHash|argon2/);
    expect(audit).not.toContain(temporaryPassword as string);
    expect(verifyAuditChain(env.db, env.setup.branchId).ok).toBe(true);
    // The temporary password works for the first login.
    const result = await login(
      env.db,
      env.ctx(null),
      { username: 'sara.cashier', password: temporaryPassword as string },
      SESSION_SECRET,
    );
    expect(result.user.mustChangePassword).toBe(true);
  });

  it('rejects duplicate usernames, weak passwords and empty role or branch choices', async () => {
    await env.addUser(admin, 'dup', 'cashier');
    const base = {
      fullName: 'X Test',
      roleIds: [env.roleId('cashier')],
      branchIds: [env.setup.branchId],
    };
    await expectDomain(
      createUser(env.db, env.ctx(admin), { ...base, username: 'dup' }),
      'CONFLICT',
    );
    await expectDomain(
      createUser(env.db, env.ctx(admin), { ...base, username: 'weak1', password: 'short' }),
      'INVALID',
    );
    await expectDomain(
      createUser(env.db, env.ctx(admin), { ...base, username: 'norole', roleIds: [] }),
      'INVALID',
    );
    await expectDomain(
      createUser(env.db, env.ctx(admin), { ...base, username: 'nobranch', branchIds: [] }),
      'INVALID',
    );
    await expectDomain(
      createUser(env.db, env.ctx(admin), { ...base, username: 'badrole', roleIds: ['nope'] }),
      'INVALID',
    );
  });

  it('stops a branch manager from escalating privileges', async () => {
    const mgr = await env.addUser(admin, 'mgr', 'branch_manager');
    const base = {
      fullName: 'X Test',
      branchIds: [env.setup.branchId],
      password: 'user-Password-2026',
    };
    await expectDomain(
      createUser(env.db, env.ctx(mgr), {
        ...base,
        username: 'evil1',
        roleIds: [env.roleId('super_admin')],
      }),
      'PRIVILEGE_ESCALATION',
    );
    await expectDomain(
      createUser(env.db, env.ctx(mgr), {
        ...base,
        username: 'evil2',
        roleIds: [env.roleId('ho_admin')],
      }),
      'PRIVILEGE_ESCALATION',
    );
    await expectDomain(
      createUser(env.db, env.ctx(mgr), {
        ...base,
        username: 'evil3',
        roleIds: [env.roleId('cashier')],
        allBranches: true,
      }),
      'PRIVILEGE_ESCALATION',
    );
    await expectDomain(
      createUser(env.db, env.ctx(mgr), {
        ...base,
        username: 'evil4',
        roleIds: [env.roleId('cashier')],
        branchIds: ['00000000-0000-7000-8000-000000000000'],
      }),
      'PRIVILEGE_ESCALATION',
    );
    const ok = await createUser(env.db, env.ctx(mgr), {
      ...base,
      username: 'fine',
      roleIds: [env.roleId('cashier')],
    });
    expect(ok.id).toBeTruthy();
  });

  it('requires a signed-in actor', async () => {
    await expectDomain(
      createUser(env.db, env.ctx(null), {
        username: 'ghost',
        fullName: 'G',
        roleIds: [env.roleId('cashier')],
        branchIds: [env.setup.branchId],
      }),
      'PRIVILEGE_ESCALATION',
    );
  });
});

describe('list and update', () => {
  it('filters by text, status and role', async () => {
    const a = await env.addUser(admin, 'amna', 'cashier');
    await env.addUser(admin, 'bilal', 'pharmacist_sr');
    setUserActive(env.db, env.ctx(admin), a, false);
    const tenant = env.setup.tenantId;
    expect(listUsers(env.db, tenant, { q: 'bila' }).map((u) => u.username)).toEqual(['bilal']);
    expect(listUsers(env.db, tenant, { status: 'disabled' }).map((u) => u.username)).toEqual([
      'amna',
    ]);
    expect(listUsers(env.db, tenant, { roleCode: 'pharmacist_sr' }).map((u) => u.username)).toEqual(
      ['bilal'],
    );
    expect(listUsers(env.db, tenant).length).toBe(3);
  });

  it('uses optimistic locking on edits', async () => {
    const id = await env.addUser(admin, 'omar', 'cashier');
    const v1 = getUser(env.db, env.setup.tenantId, id);
    const updated = updateUser(env.db, env.ctx(admin), id, {
      fullName: 'Omar Renamed',
      expectedVersion: v1.version,
    });
    expect(updated).toMatchObject({ fullName: 'Omar Renamed', version: v1.version + 1 });
    await expectDomain(
      () =>
        updateUser(env.db, env.ctx(admin), id, { fullName: 'Stale', expectedVersion: v1.version }),
      'VERSION_CONFLICT',
    );
  });

  it('changes roles and branches with an audit trail', async () => {
    const id = await env.addUser(admin, 'zain', 'cashier');
    setUserRoles(env.db, env.ctx(admin), id, [env.roleId('pharmacist_jr'), env.roleId('cashier')]);
    expect(getUser(env.db, env.setup.tenantId, id).roleCodes.sort()).toEqual([
      'cashier',
      'pharmacist_jr',
    ]);
    setUserBranches(env.db, env.ctx(admin), id, { branchIds: [], allBranches: true });
    expect(getUser(env.db, env.setup.tenantId, id).allBranches).toBe(true);
    const actions = env.db
      .select()
      .from(auditLog)
      .all()
      .map((a) => a.action);
    expect(actions).toContain('user.roles_change');
    expect(actions).toContain('user.branches_change');
  });
});

describe('disable, reset and sessions', () => {
  it('disabling signs the user out and blocks login; enabling restores it', async () => {
    const id = await env.addUser(admin, 'hina', 'cashier');
    const first = await login(
      env.db,
      env.ctx(null),
      { username: 'hina', password: 'user-Password-2026' },
      SESSION_SECRET,
    );
    expect(touchSession(env.db, first.sessionId, new Date(env.clock.ms))).not.toBeNull();
    setUserActive(env.db, env.ctx(admin), id, false);
    expect(touchSession(env.db, first.sessionId, new Date(env.clock.ms))).toBeNull();
    const err = await login(
      env.db,
      env.ctx(null),
      { username: 'hina', password: 'user-Password-2026' },
      SESSION_SECRET,
    ).catch((e: unknown) => e);
    expect((err as AuthError).code).toBe('DISABLED');
    setUserActive(env.db, env.ctx(admin), id, true);
    expect(
      (
        await login(
          env.db,
          env.ctx(null),
          { username: 'hina', password: 'user-Password-2026' },
          SESSION_SECRET,
        )
      ).user.username,
    ).toBe('hina');
  });

  it('never lets the last Super Admin be disabled, demoted or self-disabled', async () => {
    await expectDomain(() => setUserActive(env.db, env.ctx(admin), admin, false), 'CONFLICT'); // self
    const second = await createUser(env.db, env.ctx(admin), {
      username: 'boss2',
      fullName: 'Boss Two',
      roleIds: [env.roleId('super_admin')],
      branchIds: [],
      allBranches: true,
    });
    setUserActive(env.db, env.ctx(second.id), admin, false); // fine: another super admin exists
    await expectDomain(
      () => setUserActive(env.db, env.ctx(admin), second.id, false),
      'LAST_SUPER_ADMIN',
    ); // admin is disabled now, second is the last
    await expectDomain(
      () => setUserRoles(env.db, env.ctx(second.id), second.id, [env.roleId('cashier')]),
      'LAST_SUPER_ADMIN',
    );
  });

  it('reset password issues a new temporary password, invalidates the old one and all sessions', async () => {
    const id = await env.addUser(admin, 'kiran', 'cashier');
    const session = await login(
      env.db,
      env.ctx(null),
      { username: 'kiran', password: 'user-Password-2026' },
      SESSION_SECRET,
    );
    const { temporaryPassword } = await resetPassword(env.db, env.ctx(admin), id);
    expect(touchSession(env.db, session.sessionId, new Date(env.clock.ms))).toBeNull();
    const old = await login(
      env.db,
      env.ctx(null),
      { username: 'kiran', password: 'user-Password-2026' },
      SESSION_SECRET,
    ).catch((e: unknown) => e);
    expect(old).toBeInstanceOf(AuthError);
    const fresh = await login(
      env.db,
      env.ctx(null),
      { username: 'kiran', password: temporaryPassword },
      SESSION_SECRET,
    );
    expect(fresh.user.mustChangePassword).toBe(true);
    expect(JSON.stringify(env.db.select().from(auditLog).all())).not.toContain(temporaryPassword);
  });

  it('force logout revokes every session', async () => {
    const id = await env.addUser(admin, 'lubna', 'cashier');
    const s1 = await login(
      env.db,
      env.ctx(null),
      { username: 'lubna', password: 'user-Password-2026' },
      SESSION_SECRET,
    );
    forceLogout(env.db, env.ctx(admin), id);
    expect(touchSession(env.db, s1.sessionId, new Date(env.clock.ms))).toBeNull();
  });

  it('change own password: needs the current one, follows the policy, keeps only this session', async () => {
    const id = await env.addUser(admin, 'nida', 'cashier');
    const a = await login(
      env.db,
      env.ctx(null),
      { username: 'nida', password: 'user-Password-2026' },
      SESSION_SECRET,
    );
    const b = await login(
      env.db,
      env.ctx(null),
      { username: 'nida', password: 'user-Password-2026' },
      SESSION_SECRET,
    );
    const args = {
      userId: id,
      currentSessionId: a.sessionId,
      currentPassword: 'user-Password-2026',
      newPassword: 'brand-New-Password-55',
    };
    await expectDomain(
      changeOwnPassword(env.db, env.ctx(id), { ...args, currentPassword: 'wrong-wrong-wrong' }),
      'INVALID',
    );
    await expectDomain(
      changeOwnPassword(env.db, env.ctx(id), { ...args, newPassword: 'short' }),
      'INVALID',
    );
    await expectDomain(
      changeOwnPassword(env.db, env.ctx(id), { ...args, newPassword: 'user-Password-2026' }),
      'INVALID',
    );
    await changeOwnPassword(env.db, env.ctx(id), args);
    expect(touchSession(env.db, a.sessionId, new Date(env.clock.ms))).not.toBeNull();
    expect(touchSession(env.db, b.sessionId, new Date(env.clock.ms))).toBeNull();
    expect(
      (
        await login(
          env.db,
          env.ctx(null),
          { username: 'nida', password: 'brand-New-Password-55' },
          SESSION_SECRET,
        )
      ).user.mustChangePassword,
    ).toBe(false);
  });
});

describe('PIN', () => {
  it('validates PIN strength', () => {
    expect(checkPin('482913')).toBeNull();
    expect(checkPin('5931')).toBeNull();
    for (const bad of ['123', '1234567', 'abcd', '1234', '0000', '7777', '654321'])
      expect(checkPin(bad)).not.toBeNull();
  });

  it('PIN login gives a limited session that locks after 5 idle minutes and never appears in audit as text', async () => {
    await env.addUser(admin, 'rida', 'cashier', { pin: '482913' });
    const res = await loginWithPin(
      env.db,
      env.ctx(null),
      { username: 'rida', pin: '482913' },
      SESSION_SECRET,
    );
    expect(await verifySessionToken(res.token, SESSION_SECRET)).toMatchObject({
      sid: res.sessionId,
    });
    const row = env.db.select().from(sessions).where(eq(sessions.id, res.sessionId)).get();
    expect(row?.authMethod).toBe('pin');
    expect(touchSession(env.db, res.sessionId, new Date(env.clock.ms + 4 * 60_000))).not.toBeNull();
    expect(
      touchSession(env.db, res.sessionId, new Date(env.clock.ms + 4 * 60_000 + 6 * 60_000)),
    ).toBeNull();
    expect(JSON.stringify(env.db.select().from(auditLog).all())).not.toContain('482913');
  });

  it('rejects wrong PIN, missing PIN and disabled users with one generic message, and locks after 5 failures', async () => {
    const id = await env.addUser(admin, 'sami', 'cashier', { pin: '482913' });
    await env.addUser(admin, 'nopin', 'cashier');
    const wrong = await loginWithPin(
      env.db,
      env.ctx(null),
      { username: 'sami', pin: '111222' },
      SESSION_SECRET,
    ).catch((e: unknown) => e);
    const none = await loginWithPin(
      env.db,
      env.ctx(null),
      { username: 'nopin', pin: '482913' },
      SESSION_SECRET,
    ).catch((e: unknown) => e);
    const ghost = await loginWithPin(
      env.db,
      env.ctx(null),
      { username: 'ghost', pin: '482913' },
      SESSION_SECRET,
    ).catch((e: unknown) => e);
    for (const e of [wrong, none, ghost])
      expect((e as AuthError).message).toBe('Invalid username or PIN');
    for (let i = 0; i < 4; i++)
      await loginWithPin(
        env.db,
        env.ctx(null),
        { username: 'sami', pin: '111222' },
        SESSION_SECRET,
      ).catch(() => undefined);
    const locked = await loginWithPin(
      env.db,
      env.ctx(null),
      { username: 'sami', pin: '482913' },
      SESSION_SECRET,
    ).catch((e: unknown) => e);
    expect((locked as AuthError).code).toBe('LOCKED');
    env.clock.ms += 16 * 60_000;
    expect(
      (
        await loginWithPin(
          env.db,
          env.ctx(null),
          { username: 'sami', pin: '482913' },
          SESSION_SECRET,
        )
      ).user.username,
    ).toBe('sami');
    setUserActive(env.db, env.ctx(admin), id, false);
    const off = await loginWithPin(
      env.db,
      env.ctx(null),
      { username: 'sami', pin: '482913' },
      SESSION_SECRET,
    ).catch((e: unknown) => e);
    expect((off as AuthError).code).toBe('DISABLED');
  });

  it('clearing the PIN disables PIN login; a bad PIN is not stored', async () => {
    const id = await env.addUser(admin, 'tariq', 'cashier', { pin: '482913' });
    await expectDomain(setPin(env.db, env.ctx(admin), id, '1234'), 'INVALID');
    clearPin(env.db, env.ctx(admin), id);
    expect(env.db.select().from(users).where(eq(users.id, id)).get()?.pinHash).toBeNull();
    const err = await loginWithPin(
      env.db,
      env.ctx(null),
      { username: 'tariq', pin: '482913' },
      SESSION_SECRET,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
  });

  it('refuses PIN login from a device that is not registered to the branch', async () => {
    await env.addUser(admin, 'uzma', 'cashier', { pin: '482913' });
    const foreign = { ...env.ctx(null), deviceId: '00000000-0000-7000-8000-00000000dead' };
    const err = await loginWithPin(
      env.db,
      foreign,
      { username: 'uzma', pin: '482913' },
      SESSION_SECRET,
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError);
  });
});

describe('admin bootstrap', () => {
  it('keeps the admin password valid', async () => {
    expect(
      (
        await login(
          env.db,
          env.ctx(null),
          { username: 'admin', password: ADMIN_PASSWORD },
          SESSION_SECRET,
        )
      ).user.username,
    ).toBe('admin');
  });
});
