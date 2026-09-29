import { randomInt } from 'node:crypto';
import { and, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from './audit';
import { loadAccessContext } from './auth/access';
import { checkPasswordPolicy, hashPassword, verifyPassword } from './auth/password';
import { revokeAllSessionsForUser, revokeOtherSessions } from './auth/session';
import type { Db, DbOrTx } from './client';
import { isoNow, type WriteContext } from './context';
import { DomainError } from './errors';
import { recordChange } from './outbox';
import { branches, roles, userBranches, userRoles, users } from './schema/sqlite';

/** Roles only a Super Admin may hand out (privilege escalation guard). */
const PRIVILEGED_ROLE_CODES = new Set(['super_admin', 'ho_admin']);
const SAFE = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

export function generateTemporaryPassword(): string {
  // 14 characters from an alphabet without look-alikes, always passes the password policy.
  return Array.from({ length: 14 }, () => SAFE[randomInt(SAFE.length)]).join('');
}

const TRIVIAL_PINS = new Set([
  '0000',
  '1111',
  '1234',
  '4321',
  '123456',
  '000000',
  '111111',
  '654321',
]);

export function checkPin(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'PIN must be 4 to 6 digits';
  if (TRIVIAL_PINS.has(pin) || /^(\d)\1+$/.test(pin)) return 'Choose a PIN that is harder to guess';
  return null;
}

export interface UserView {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  language: string;
  status: string;
  hasPin: boolean;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
  version: number;
  roleIds: string[];
  roleCodes: string[];
  allBranches: boolean;
  branchIds: string[];
}

function assertActorMayGrant(
  db: DbOrTx,
  ctx: WriteContext,
  roleIds: string[],
  branchIds: string[],
  allBranches: boolean,
): void {
  const actor = ctx.userId ? loadAccessContext(db, ctx.userId) : null;
  if (!actor)
    throw new DomainError('PRIVILEGE_ESCALATION', 'Only a signed-in user can manage users');
  const wanted = roleIds.length
    ? db.select().from(roles).where(inArray(roles.id, roleIds)).all()
    : [];
  if (wanted.length !== roleIds.length)
    throw new DomainError('INVALID', 'One of the selected roles does not exist');
  const actorRoles = db
    .select({ code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, actor.userId))
    .all()
    .map((r) => r.code);
  const isSuper = actorRoles.includes('super_admin');
  if (!isSuper && wanted.some((r) => PRIVILEGED_ROLE_CODES.has(r.code))) {
    throw new DomainError(
      'PRIVILEGE_ESCALATION',
      'Only a Super Admin can assign the Super Admin or Head Office Admin role',
    );
  }
  if (allBranches && !actor.allBranches) {
    throw new DomainError('PRIVILEGE_ESCALATION', 'You cannot give access to all branches');
  }
  const outside = branchIds.filter((b) => !actor.allBranches && !actor.branchIds.includes(b));
  if (outside.length > 0)
    throw new DomainError(
      'PRIVILEGE_ESCALATION',
      'You can only give access to branches you can access yourself',
    );
  if (branchIds.length) {
    const known = db
      .select({ id: branches.id })
      .from(branches)
      .where(inArray(branches.id, branchIds))
      .all();
    if (known.length !== branchIds.length)
      throw new DomainError('INVALID', 'One of the selected branches does not exist');
  }
}

function activeSuperAdminIds(db: DbOrTx, tenantId: string): string[] {
  return db
    .select({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.status, 'active'),
        isNull(users.deletedAt),
        eq(roles.code, 'super_admin'),
      ),
    )
    .all()
    .map((r) => r.id);
}

function assertNotLastSuperAdmin(db: DbOrTx, tenantId: string, userId: string): void {
  const supers = activeSuperAdminIds(db, tenantId);
  if (supers.length === 1 && supers[0] === userId) {
    throw new DomainError(
      'LAST_SUPER_ADMIN',
      'This is the last active Super Admin. Create another one first',
    );
  }
}

function toView(db: DbOrTx, row: typeof users.$inferSelect): UserView {
  const rr = db
    .select({ id: roles.id, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, row.id))
    .all();
  const scope = db.select().from(userBranches).where(eq(userBranches.userId, row.id)).all();
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    language: row.language,
    status: row.status,
    hasPin: row.pinHash !== null,
    lastLoginAt: row.lastLoginAt,
    mustChangePassword: row.mustChangePassword,
    version: row.version,
    roleIds: rr.map((r) => r.id),
    roleCodes: rr.map((r) => r.code),
    allBranches: scope.some((s) => s.allBranches),
    branchIds: scope.flatMap((s) => (s.branchId ? [s.branchId] : [])),
  };
}

export interface UserFilter {
  q?: string;
  status?: 'active' | 'disabled';
  roleCode?: string;
}

export function listUsers(db: DbOrTx, tenantId: string, filter: UserFilter = {}): UserView[] {
  const term = filter.q?.trim();
  const rows = db
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        isNull(users.deletedAt),
        filter.status ? eq(users.status, filter.status) : undefined,
        term
          ? or(
              like(users.username, `%${term}%`),
              like(users.fullName, `%${term}%`),
              like(users.email, `%${term}%`),
              like(users.phone, `%${term}%`),
            )
          : undefined,
      ),
    )
    .orderBy(users.fullName)
    .all();
  const views = rows.map((r) => toView(db, r));
  return filter.roleCode
    ? views.filter((v) => v.roleCodes.includes(filter.roleCode as string))
    : views;
}

export function getUser(db: DbOrTx, tenantId: string, id: string): UserView {
  const row = db
    .select()
    .from(users)
    .where(and(eq(users.id, id), eq(users.tenantId, tenantId), isNull(users.deletedAt)))
    .get();
  if (!row) throw new DomainError('NOT_FOUND', 'User not found');
  return toView(db, row);
}

export interface CreateUserInput {
  username: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  language?: 'en' | 'ur';
  /** Omit to generate a temporary password, returned once. */
  password?: string;
  roleIds: string[];
  branchIds: string[];
  allBranches?: boolean;
}

export async function createUser(
  db: Db,
  ctx: WriteContext,
  input: CreateUserInput,
): Promise<{ id: string; temporaryPassword?: string }> {
  const temporaryPassword = input.password ? undefined : generateTemporaryPassword();
  const password = input.password ?? (temporaryPassword as string);
  const policy = checkPasswordPolicy(password, input.username);
  if (!policy.ok) throw new DomainError('INVALID', policy.problems.join('. '), policy.problems);
  const passwordHash = await hashPassword(password);
  const allBranches = input.allBranches ?? false;

  const id = db.transaction((tx) => {
    assertActorMayGrant(tx, ctx, input.roleIds, input.branchIds, allBranches);
    if (input.roleIds.length === 0) throw new DomainError('INVALID', 'Choose at least one role');
    if (!allBranches && input.branchIds.length === 0)
      throw new DomainError('INVALID', 'Choose at least one branch');
    const dup = tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, ctx.tenantId), eq(users.username, input.username)))
      .get();
    if (dup) throw new DomainError('CONFLICT', 'That username is already taken');

    const now = isoNow(ctx);
    const userId = newId();
    const row = {
      id: userId,
      tenantId: ctx.tenantId,
      username: input.username,
      fullName: input.fullName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      passwordHash,
      pinHash: null,
      totpSecretEnc: null,
      language: input.language ?? 'en',
      status: 'active',
      mustChangePassword: true,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: null,
      priorityModules: null,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(users).values(row).run();
    recordChange(tx, ctx, { entityType: 'users', entityId: userId, op: 'insert', payload: row });
    for (const roleId of input.roleIds) {
      tx.insert(userRoles).values({ userId, roleId }).run();
      recordChange(tx, ctx, {
        entityType: 'user_roles',
        entityId: `${userId}:${roleId}`,
        op: 'insert',
        payload: { userId, roleId },
      });
    }
    const scopes = allBranches
      ? [{ branchId: null, allBranches: true }]
      : input.branchIds.map((branchId) => ({ branchId, allBranches: false }));
    for (const scope of scopes) {
      const scopeRow = {
        id: newId(),
        userId,
        ...scope,
        createdAt: now,
        updatedAt: now,
        hlc: ctx.clock.tick(),
        version: 1,
      };
      tx.insert(userBranches).values(scopeRow).run();
      recordChange(tx, ctx, {
        entityType: 'user_branches',
        entityId: scopeRow.id,
        op: 'insert',
        payload: scopeRow,
      });
    }
    appendAudit(tx, ctx, {
      action: 'user.create',
      entityType: 'user',
      entityId: userId,
      newValue: {
        username: input.username,
        fullName: input.fullName,
        roleIds: input.roleIds,
        branchIds: input.branchIds,
        allBranches,
      },
    });
    return userId;
  });
  return { id, temporaryPassword };
}

export interface UpdateUserInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  language?: 'en' | 'ur';
  expectedVersion: number;
}

export function updateUser(
  db: Db,
  ctx: WriteContext,
  id: string,
  patch: UpdateUserInput,
): UserView {
  return db.transaction((tx) => {
    const before = tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId), isNull(users.deletedAt)))
      .get();
    if (!before) throw new DomainError('NOT_FOUND', 'User not found');
    if (before.version !== patch.expectedVersion)
      throw new DomainError(
        'VERSION_CONFLICT',
        'This user was changed by someone else. Reload and try again',
      );
    const change = {
      fullName: patch.fullName ?? before.fullName,
      email: patch.email === undefined ? before.email : patch.email,
      phone: patch.phone === undefined ? before.phone : patch.phone,
      language: patch.language ?? before.language,
      version: before.version + 1,
      updatedAt: isoNow(ctx),
      hlc: ctx.clock.tick(),
    };
    tx.update(users).set(change).where(eq(users.id, id)).run();
    recordChange(tx, ctx, {
      entityType: 'users',
      entityId: id,
      op: 'update',
      payload: { id, ...change, baseVersion: before.version },
    });
    appendAudit(tx, ctx, {
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      oldValue: {
        fullName: before.fullName,
        email: before.email,
        phone: before.phone,
        language: before.language,
      },
      newValue: {
        fullName: change.fullName,
        email: change.email,
        phone: change.phone,
        language: change.language,
      },
    });
    return toView(
      tx,
      tx.select().from(users).where(eq(users.id, id)).get() as typeof users.$inferSelect,
    );
  });
}

export function setUserActive(db: Db, ctx: WriteContext, id: string, active: boolean): void {
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId), isNull(users.deletedAt)))
      .get();
    if (!row) throw new DomainError('NOT_FOUND', 'User not found');
    if (!active) {
      if (id === ctx.userId)
        throw new DomainError('CONFLICT', 'You cannot disable your own account');
      assertNotLastSuperAdmin(tx, ctx.tenantId, id);
    }
    const change = {
      status: active ? 'active' : 'disabled',
      version: row.version + 1,
      updatedAt: isoNow(ctx),
      hlc: ctx.clock.tick(),
      failedLogins: 0,
      lockedUntil: null,
    };
    tx.update(users).set(change).where(eq(users.id, id)).run();
    if (!active) revokeAllSessionsForUser(tx, id, new Date(isoNow(ctx)));
    recordChange(tx, ctx, {
      entityType: 'users',
      entityId: id,
      op: 'update',
      payload: { id, ...change, baseVersion: row.version },
    });
    appendAudit(tx, ctx, {
      action: active ? 'user.enable' : 'user.disable',
      entityType: 'user',
      entityId: id,
      oldValue: { status: row.status },
      newValue: { status: change.status },
    });
  });
}

/** Sets a new temporary password (shown once), forces a change at next login, and signs the user out everywhere. */
export async function resetPassword(
  db: Db,
  ctx: WriteContext,
  id: string,
): Promise<{ temporaryPassword: string }> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId), isNull(users.deletedAt)))
      .get();
    if (!row) throw new DomainError('NOT_FOUND', 'User not found');
    const change = {
      passwordHash,
      mustChangePassword: true,
      failedLogins: 0,
      lockedUntil: null,
      version: row.version + 1,
      updatedAt: isoNow(ctx),
      hlc: ctx.clock.tick(),
    };
    tx.update(users).set(change).where(eq(users.id, id)).run();
    revokeAllSessionsForUser(tx, id, new Date(isoNow(ctx)));
    recordChange(tx, ctx, {
      entityType: 'users',
      entityId: id,
      op: 'update',
      payload: { id, ...change, baseVersion: row.version },
    });
    appendAudit(tx, ctx, { action: 'user.password_reset', entityType: 'user', entityId: id });
  });
  return { temporaryPassword };
}

export async function changeOwnPassword(
  db: Db,
  ctx: WriteContext,
  input: { userId: string; currentSessionId: string; currentPassword: string; newPassword: string },
): Promise<void> {
  const row = db.select().from(users).where(eq(users.id, input.userId)).get();
  if (!row || !(await verifyPassword(row.passwordHash, input.currentPassword))) {
    throw new DomainError('INVALID', 'Current password is incorrect');
  }
  const policy = checkPasswordPolicy(input.newPassword, row.username);
  if (!policy.ok) throw new DomainError('INVALID', policy.problems.join('. '), policy.problems);
  if (await verifyPassword(row.passwordHash, input.newPassword))
    throw new DomainError('INVALID', 'Choose a password you have not used just now');
  const passwordHash = await hashPassword(input.newPassword);
  db.transaction((tx) => {
    const change = {
      passwordHash,
      mustChangePassword: false,
      version: row.version + 1,
      updatedAt: isoNow(ctx),
      hlc: ctx.clock.tick(),
    };
    tx.update(users).set(change).where(eq(users.id, input.userId)).run();
    revokeOtherSessions(tx, input.userId, input.currentSessionId, new Date(isoNow(ctx)));
    recordChange(tx, ctx, {
      entityType: 'users',
      entityId: input.userId,
      op: 'update',
      payload: { id: input.userId, ...change, baseVersion: row.version },
    });
    appendAudit(tx, ctx, {
      action: 'user.password_change',
      entityType: 'user',
      entityId: input.userId,
    });
  });
}

export async function setPin(db: Db, ctx: WriteContext, id: string, pin: string): Promise<void> {
  const problem = checkPin(pin);
  if (problem) throw new DomainError('INVALID', problem);
  const pinHash = await hashPassword(pin);
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId), isNull(users.deletedAt)))
      .get();
    if (!row) throw new DomainError('NOT_FOUND', 'User not found');
    const change = {
      pinHash,
      version: row.version + 1,
      updatedAt: isoNow(ctx),
      hlc: ctx.clock.tick(),
    };
    tx.update(users).set(change).where(eq(users.id, id)).run();
    recordChange(tx, ctx, {
      entityType: 'users',
      entityId: id,
      op: 'update',
      payload: { id, ...change, baseVersion: row.version },
    });
    appendAudit(tx, ctx, { action: 'user.pin_set', entityType: 'user', entityId: id });
  });
}

export function clearPin(db: Db, ctx: WriteContext, id: string): void {
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId), isNull(users.deletedAt)))
      .get();
    if (!row) throw new DomainError('NOT_FOUND', 'User not found');
    const change = {
      pinHash: null,
      version: row.version + 1,
      updatedAt: isoNow(ctx),
      hlc: ctx.clock.tick(),
    };
    tx.update(users).set(change).where(eq(users.id, id)).run();
    recordChange(tx, ctx, {
      entityType: 'users',
      entityId: id,
      op: 'update',
      payload: { id, ...change, baseVersion: row.version },
    });
    appendAudit(tx, ctx, { action: 'user.pin_clear', entityType: 'user', entityId: id });
  });
}

export function setUserRoles(db: Db, ctx: WriteContext, id: string, roleIds: string[]): void {
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId), isNull(users.deletedAt)))
      .get();
    if (!row) throw new DomainError('NOT_FOUND', 'User not found');
    if (roleIds.length === 0) throw new DomainError('INVALID', 'Choose at least one role');
    assertActorMayGrant(tx, ctx, roleIds, [], false);
    const before = toView(tx, row);
    const superRole = tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, ctx.tenantId), eq(roles.code, 'super_admin')))
      .get();
    if (superRole && before.roleIds.includes(superRole.id) && !roleIds.includes(superRole.id))
      assertNotLastSuperAdmin(tx, ctx.tenantId, id);
    tx.delete(userRoles).where(eq(userRoles.userId, id)).run();
    for (const roleId of roleIds) tx.insert(userRoles).values({ userId: id, roleId }).run();
    recordChange(tx, ctx, {
      entityType: 'user_roles',
      entityId: id,
      op: 'update',
      payload: { userId: id, roleIds },
    });
    appendAudit(tx, ctx, {
      action: 'user.roles_change',
      entityType: 'user',
      entityId: id,
      oldValue: { roleIds: before.roleIds },
      newValue: { roleIds },
    });
  });
}

export function setUserBranches(
  db: Db,
  ctx: WriteContext,
  id: string,
  input: { branchIds: string[]; allBranches: boolean },
): void {
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId), isNull(users.deletedAt)))
      .get();
    if (!row) throw new DomainError('NOT_FOUND', 'User not found');
    if (!input.allBranches && input.branchIds.length === 0)
      throw new DomainError('INVALID', 'Choose at least one branch');
    assertActorMayGrant(tx, ctx, [], input.branchIds, input.allBranches);
    const before = toView(tx, row);
    tx.delete(userBranches).where(eq(userBranches.userId, id)).run();
    const now = isoNow(ctx);
    const scopes = input.allBranches
      ? [{ branchId: null, allBranches: true }]
      : input.branchIds.map((branchId) => ({ branchId, allBranches: false }));
    for (const scope of scopes) {
      tx.insert(userBranches)
        .values({
          id: newId(),
          userId: id,
          ...scope,
          createdAt: now,
          updatedAt: now,
          hlc: ctx.clock.tick(),
          version: 1,
        })
        .run();
    }
    recordChange(tx, ctx, {
      entityType: 'user_branches',
      entityId: id,
      op: 'update',
      payload: { userId: id, ...input },
    });
    appendAudit(tx, ctx, {
      action: 'user.branches_change',
      entityType: 'user',
      entityId: id,
      oldValue: { branchIds: before.branchIds, allBranches: before.allBranches },
      newValue: input,
    });
  });
}

export function forceLogout(db: Db, ctx: WriteContext, id: string): void {
  db.transaction((tx) => {
    const row = tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId)))
      .get();
    if (!row) throw new DomainError('NOT_FOUND', 'User not found');
    revokeAllSessionsForUser(tx, id, new Date(isoNow(ctx)));
    appendAudit(tx, ctx, { action: 'user.force_logout', entityType: 'user', entityId: id });
  });
}
