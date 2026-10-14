import { z } from 'zod';
import { assertFactoryResetAllowed, SESSION_COOKIE } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { clearDatabase, getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  password: z.string().min(1).max(200),
  phrase: z.string().max(100),
});

/**
 * Clear the whole database on this PC (Super Admin only). The screen asks twice: a warning first, then
 * the typed phrase and the Super Admin's own password, both checked here. A backup is always taken
 * first; the cloud copy is not touched. Afterwards the app opens first-run setup.
 */
export const POST = withPermission('admin.backup.create', async (request, auth) => {
  const input = Body.parse(await request.json());
  await assertFactoryResetAllowed(getDb(), auth.userId, input);
  const backupFile = clearDatabase(writeContext(auth.userId));
  const response = json({ ok: true, backupFile });
  response.cookies.delete(SESSION_COOKIE);
  return response;
});
