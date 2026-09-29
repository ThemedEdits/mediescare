import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAudit, issueRecoveryKey, schema, verifyPassword } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getRuntime, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ password: z.string().min(1).max(200) });

/**
 * Issue a new recovery key (the old one stops working for NEW backups; existing backups keep the
 * key they were made with). Needs the caller's password again, since this protects all data.
 */
export const POST = withPermission('admin.backup.edit', async (request, auth) => {
  const { password } = Body.parse(await request.json());
  const runtime = getRuntime();
  const user = runtime.handle.db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, auth.userId))
    .get();
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    return json({ error: { code: 'INVALID_CREDENTIALS', message: 'Password is incorrect' } }, 401);
  }
  const recoveryKey = issueRecoveryKey(runtime.dataDir, runtime.dbKeyHex);
  appendAudit(runtime.handle.db, writeContext(auth.userId), {
    action: 'recovery_key.rotate',
    entityType: 'keyring',
    entityId: null,
  });
  return json({ recoveryKey });
});
