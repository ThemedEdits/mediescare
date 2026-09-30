import { json, withPermission } from '@/server/guard';
import { getDb } from '@/server/runtime';
import { syncStatus } from '@/server/sync-runtime';

export const dynamic = 'force-dynamic';

/**
 * Sync status for the Settings screen and the status chip (typed as `SyncStatusReport` in
 * @mediescare/sync). Keeps the original `pending`, `rejected` and `oldestPendingAt` fields.
 */
export const GET = withPermission('admin.sync.view', () => json(syncStatus(getDb())));
