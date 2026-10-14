import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { verifyPassword } from './auth/password';
import type { DbOrTx } from './client';
import { CLEAR_DATABASE_PHRASE } from '@mediescare/core';
import { DomainError } from './errors';
import { roles, userRoles, users } from './schema/sqlite';

/** Database file of a branch server data folder (matches runtime.ts). */
export const DATABASE_FILE = 'mediescare.db';

/** True when the user holds the Super Admin role. A custom role with every permission is not enough. */
export function isSuperAdmin(db: DbOrTx, userId: string): boolean {
  return (
    db
      .select({ id: roles.id })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(and(eq(userRoles.userId, userId), eq(roles.code, 'super_admin')))
      .get() !== undefined
  );
}

/**
 * Checks the two confirmations for clearing the database: the typed phrase and the Super Admin's own
 * password. Throws FORBIDDEN-style DomainErrors with safe messages; never reveals which user exists.
 */
export async function assertFactoryResetAllowed(
  db: DbOrTx,
  userId: string,
  input: { password: string; phrase: string },
): Promise<void> {
  if (!isSuperAdmin(db, userId))
    throw new DomainError('PRIVILEGE_ESCALATION', 'Only a Super Admin can clear the database');
  if (input.phrase.trim() !== CLEAR_DATABASE_PHRASE)
    throw new DomainError('INVALID', `Type ${CLEAR_DATABASE_PHRASE} to confirm`);
  const user = db
    .select({ hash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!user?.hash || !(await verifyPassword(user.hash, input.password)))
    throw new DomainError('INVALID', 'The password is not correct');
}

/**
 * Deletes the database and the cloud login of a data folder. The database must already be closed.
 * The recovery keyring stays: the database key does not change, so the backup taken just before can
 * still be restored with the same recovery key.
 */
export function deleteDatabaseFiles(dataDir: string): void {
  for (const name of [
    DATABASE_FILE,
    `${DATABASE_FILE}-wal`,
    `${DATABASE_FILE}-shm`,
    `${DATABASE_FILE}-journal`,
    'cloud-auth.json',
  ]) {
    rmSync(join(dataDir, name), { force: true });
  }
}
