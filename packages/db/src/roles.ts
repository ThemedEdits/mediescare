import { and, count, eq } from 'drizzle-orm';
import { ALL_PERMISSIONS, isPermissionKey } from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from './audit';
import type { Db, DbOrTx } from './client';
import { isoNow, type WriteContext } from './context';
import { DomainError } from './errors';
import { recordChange } from './outbox';
import { rolePermissions, roles, userRoles } from './schema/sqlite';

export interface RoleView {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  discountLimitBp: number;
  refundLimitMinor: number | null;
  priceOverrideLimitBp: number;
  version: number;
  permissionCount: number;
  userCount: number;
}

export interface RoleDetail extends RoleView {
  permissions: string[];
}

export function listRoles(db: DbOrTx, tenantId: string): RoleView[] {
  return db
    .select()
    .from(roles)
    .where(eq(roles.tenantId, tenantId))
    .orderBy(roles.name)
    .all()
    .map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      isSystem: r.isSystem,
      discountLimitBp: r.discountLimitBp,
      refundLimitMinor: r.refundLimitMinor,
      priceOverrideLimitBp: r.priceOverrideLimitBp,
      version: r.version,
      permissionCount:
        db
          .select({ n: count() })
          .from(rolePermissions)
          .where(eq(rolePermissions.roleId, r.id))
          .get()?.n ?? 0,
      userCount:
        db.select({ n: count() }).from(userRoles).where(eq(userRoles.roleId, r.id)).get()?.n ?? 0,
    }));
}

export function getRole(db: DbOrTx, tenantId: string, id: string): RoleDetail {
  const view = listRoles(db, tenantId).find((r) => r.id === id);
  if (!view) throw new DomainError('NOT_FOUND', 'Role not found');
  const permissions = db
    .select({ key: rolePermissions.permissionKey })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, id))
    .all()
    .map((p) => p.key)
    .sort();
  return { ...view, permissions };
}

export interface RoleInput {
  name: string;
  permissions: string[];
  discountLimitBp: number;
  refundLimitMinor: number | null;
  priceOverrideLimitBp: number;
}

function validate(input: RoleInput): void {
  const unknown = input.permissions.filter((p) => !isPermissionKey(p));
  if (unknown.length)
    throw new DomainError('INVALID', `Unknown permissions: ${unknown.slice(0, 3).join(', ')}`);
  if (input.discountLimitBp < 0 || input.discountLimitBp > 10_000)
    throw new DomainError('INVALID', 'Discount limit must be between 0% and 100%');
  if (input.priceOverrideLimitBp < 0 || input.priceOverrideLimitBp > 10_000)
    throw new DomainError('INVALID', 'Price override limit must be between 0% and 100%');
  if (input.refundLimitMinor !== null && input.refundLimitMinor < 0)
    throw new DomainError('INVALID', 'Refund limit cannot be negative');
}

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

/** Roles can only grant permissions the acting user holds (no privilege escalation through a role). */
function assertActorHolds(db: DbOrTx, ctx: WriteContext, keys: string[]): void {
  const held = new Set(
    db
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .innerJoin(userRoles, eq(userRoles.roleId, rolePermissions.roleId))
      .where(eq(userRoles.userId, ctx.userId ?? ''))
      .all()
      .map((r) => r.key),
  );
  const missing = keys.filter((k) => !held.has(k));
  if (missing.length)
    throw new DomainError(
      'PRIVILEGE_ESCALATION',
      'You cannot grant permissions you do not have yourself',
    );
}

export function createRole(db: Db, ctx: WriteContext, input: RoleInput): string {
  validate(input);
  const code = `custom_${slug(input.name)}`;
  if (code === 'custom_') throw new DomainError('INVALID', 'Give the role a name');
  return db.transaction((tx) => {
    if (
      tx
        .select({ id: roles.id })
        .from(roles)
        .where(and(eq(roles.tenantId, ctx.tenantId), eq(roles.code, code)))
        .get()
    ) {
      throw new DomainError('CONFLICT', 'A role with this name already exists');
    }
    assertActorHolds(tx, ctx, input.permissions);
    const id = newId();
    const now = isoNow(ctx);
    const row = {
      id,
      tenantId: ctx.tenantId,
      code,
      name: input.name.trim(),
      isSystem: false,
      discountLimitBp: input.discountLimitBp,
      refundLimitMinor: input.refundLimitMinor,
      priceOverrideLimitBp: input.priceOverrideLimitBp,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(roles).values(row).run();
    if (input.permissions.length) {
      tx.insert(rolePermissions)
        .values(
          input.permissions.map((permissionKey) => ({
            roleId: id,
            permissionKey,
            fieldRules: null,
          })),
        )
        .run();
    }
    recordChange(tx, ctx, {
      entityType: 'roles',
      entityId: id,
      op: 'insert',
      payload: { ...row, permissions: input.permissions },
    });
    appendAudit(tx, ctx, {
      action: 'role.create',
      entityType: 'role',
      entityId: id,
      newValue: { name: row.name, permissionCount: input.permissions.length },
    });
    return id;
  });
}

export function updateRole(
  db: Db,
  ctx: WriteContext,
  id: string,
  input: RoleInput & { expectedVersion: number },
): void {
  validate(input);
  db.transaction((tx) => {
    const before = tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId)))
      .get();
    if (!before) throw new DomainError('NOT_FOUND', 'Role not found');
    if (before.code === 'super_admin')
      throw new DomainError('IMMUTABLE_ROLE', 'The Super Admin role cannot be changed');
    if (before.version !== input.expectedVersion)
      throw new DomainError(
        'VERSION_CONFLICT',
        'This role was changed by someone else. Reload and try again',
      );
    const oldKeys = tx
      .select({ key: rolePermissions.permissionKey })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, id))
      .all()
      .map((p) => p.key);
    const added = input.permissions.filter((k) => !oldKeys.includes(k));
    assertActorHolds(tx, ctx, added);
    const change = {
      name: before.isSystem ? before.name : input.name.trim(),
      discountLimitBp: input.discountLimitBp,
      refundLimitMinor: input.refundLimitMinor,
      priceOverrideLimitBp: input.priceOverrideLimitBp,
      version: before.version + 1,
      updatedAt: isoNow(ctx),
      hlc: ctx.clock.tick(),
    };
    tx.update(roles).set(change).where(eq(roles.id, id)).run();
    tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id)).run();
    if (input.permissions.length) {
      tx.insert(rolePermissions)
        .values(
          input.permissions.map((permissionKey) => ({
            roleId: id,
            permissionKey,
            fieldRules: null,
          })),
        )
        .run();
    }
    recordChange(tx, ctx, {
      entityType: 'roles',
      entityId: id,
      op: 'update',
      payload: { id, ...change, permissions: input.permissions, baseVersion: before.version },
    });
    appendAudit(tx, ctx, {
      action: 'role.update',
      entityType: 'role',
      entityId: id,
      oldValue: {
        name: before.name,
        discountLimitBp: before.discountLimitBp,
        refundLimitMinor: before.refundLimitMinor,
        permissionCount: oldKeys.length,
      },
      newValue: {
        name: change.name,
        discountLimitBp: change.discountLimitBp,
        refundLimitMinor: change.refundLimitMinor,
        permissionCount: input.permissions.length,
        added,
        removed: oldKeys.filter((k) => !input.permissions.includes(k)),
      },
    });
  });
}

export function deleteRole(db: Db, ctx: WriteContext, id: string): void {
  db.transaction((tx) => {
    const row = tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), eq(roles.tenantId, ctx.tenantId)))
      .get();
    if (!row) throw new DomainError('NOT_FOUND', 'Role not found');
    if (row.isSystem) throw new DomainError('IMMUTABLE_ROLE', 'Built-in roles cannot be deleted');
    if (
      (tx.select({ n: count() }).from(userRoles).where(eq(userRoles.roleId, id)).get()?.n ?? 0) > 0
    ) {
      throw new DomainError(
        'CONFLICT',
        'This role is still assigned to users. Reassign them first',
      );
    }
    tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id)).run();
    tx.delete(roles).where(eq(roles.id, id)).run();
    recordChange(tx, ctx, { entityType: 'roles', entityId: id, op: 'void', payload: { id } });
    appendAudit(tx, ctx, {
      action: 'role.delete',
      entityType: 'role',
      entityId: id,
      oldValue: { name: row.name },
    });
  });
}

/** The permission catalogue grouped for the role editor. */
export function permissionCatalogue(): { module: string; resource: string; keys: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const key of ALL_PERMISSIONS) {
    const [module, resource] = key.split('.');
    const g = `${module}.${resource}`;
    groups.set(g, [...(groups.get(g) ?? []), key]);
  }
  return [...groups.entries()].map(([g, keys]) => {
    const [module, resource] = g.split('.') as [string, string];
    return { module, resource, keys };
  });
}
