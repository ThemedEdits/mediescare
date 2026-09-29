import { createBackup, listBackups, readKeyring } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getRuntime, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('admin.backup.view', () => {
  const runtime = getRuntime();
  return json({
    backups: listBackups(runtime.handle).map(
      ({ id, sizeBytes, sha256, kind, createdAt, verifiedAt }) => ({
        id,
        sizeBytes,
        sha256,
        kind,
        createdAt,
        verifiedAt,
      }),
    ),
    folder: runtime.backupDir,
    recoveryKeyConfigured: readKeyring(runtime.dataDir) !== null,
  });
});

export const POST = withPermission('admin.backup.create', (_request, auth) => {
  const runtime = getRuntime();
  const backup = createBackup(runtime.handle, {
    dir: runtime.backupDir,
    kind: 'manual',
    dbKeyHex: runtime.dbKeyHex,
    wrappedKey: readKeyring(runtime.dataDir),
    ctx: writeContext(auth.userId),
  });
  return json(
    {
      file: backup.file,
      sizeBytes: backup.sizeBytes,
      sha256: backup.sha256,
      createdAt: backup.createdAt,
    },
    201,
  );
});
