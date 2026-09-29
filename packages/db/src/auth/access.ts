import { eq, inArray } from 'drizzle-orm';
import type { AccessContext } from '@mediescare/core';
import type { DbOrTx } from '../client';
import { rolePermissions, userBranches, userRoles, users } from '../schema/sqlite';

/** Build the authorization subject for a user from the database (roles, permissions, branch scope). */
export function loadAccessContext(db: DbOrTx, userId: string): AccessContext | null {
  const user = db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, userId)).get();
  if (!user || user.status !== 'active') return null;

  const roleIds = db.select({ roleId: userRoles.roleId }).from(userRoles).where(eq(userRoles.userId, userId)).all().map((r) => r.roleId);
  const keys =
    roleIds.length === 0
      ? []
      : db
          .select({ key: rolePermissions.permissionKey })
          .from(rolePermissions)
          .where(inArray(rolePermissions.roleId, roleIds))
          .all()
          .map((r) => r.key);

  const scope = db.select().from(userBranches).where(eq(userBranches.userId, userId)).all();
  return {
    userId,
    permissions: new Set(keys),
    allBranches: scope.some((s) => s.allBranches),
    branchIds: scope.flatMap((s) => (s.branchId ? [s.branchId] : [])),
  };
}
