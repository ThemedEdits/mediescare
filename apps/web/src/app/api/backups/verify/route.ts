import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { BackupError, schema, verifyBackup } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getRuntime } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ id: z.string().min(1) });

/** Re-check a stored backup: checksum, opens with the key, integrity check. */
export const POST = withPermission('admin.backup.view', async (request) => {
  const { id } = Body.parse(await request.json());
  const runtime = getRuntime();
  const row = runtime.handle.db
    .select()
    .from(schema.backups)
    .where(eq(schema.backups.id, id))
    .get();
  if (!row) return json({ error: { code: 'NOT_FOUND' } }, 404);
  try {
    verifyBackup(row.path, runtime.dbKeyHex);
    return json({ ok: true });
  } catch (error) {
    if (error instanceof BackupError) return json({ ok: false, problem: error.message });
    throw error;
  }
});
