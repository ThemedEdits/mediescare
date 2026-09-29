import { isAbsolute } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { appendAudit, BackupError, exportBackup, schema } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getRuntime, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  id: z.string().min(1),
  // Folder on an external drive, for example E:\Backups. Must be an absolute path.
  destination: z
    .string()
    .min(3)
    .max(260)
    .refine((p) => isAbsolute(p), 'Use a full folder path, for example E:\\Backups'),
});

/** Copy one of the recorded backups (and its manifest) to another folder, then verify the copy. */
export const POST = withPermission('admin.backup.create', async (request, auth) => {
  const { id, destination } = Body.parse(await request.json());
  const runtime = getRuntime();
  const row = runtime.handle.db
    .select()
    .from(schema.backups)
    .where(eq(schema.backups.id, id))
    .get();
  if (!row) return json({ error: { code: 'NOT_FOUND' } }, 404);
  try {
    const target = exportBackup(row.path, destination);
    appendAudit(runtime.handle.db, writeContext(auth.userId), {
      action: 'backup.export',
      entityType: 'backup',
      entityId: id,
      newValue: { destination },
    });
    return json({ ok: true, file: target });
  } catch (error) {
    if (error instanceof BackupError) return json({ ok: false, problem: error.message }, 422);
    return json(
      {
        ok: false,
        problem: 'Could not write to that folder. Check the drive is connected and not read-only.',
      },
      422,
    );
  }
});
