import { json, withPermission } from '@/server/guard';
import { getDb, getRuntime, writeContext } from '@/server/runtime';
import { auditCloudLink, disconnectFromCloud, syncStatus } from '@/server/sync-runtime';

export const dynamic = 'force-dynamic';

/**
 * Stop syncing and forget the cloud credentials on this PC. Nothing local is deleted: every sale,
 * item and ledger row stays, and events that were not uploaded yet stay queued for a later connect.
 */
export const POST = withPermission('admin.sync.edit', (_request, auth) => {
  const runtime = getRuntime();
  const db = getDb();
  const host = syncStatus(db).cloudHost;
  disconnectFromCloud({ db, dataDir: runtime.dataDir, auditContext: () => writeContext(null) });
  auditCloudLink(db, writeContext(auth.userId), 'sync.cloud.disconnect', { cloudHost: host });
  return json(syncStatus(db));
});
