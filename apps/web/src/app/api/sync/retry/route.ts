import { json, withPermission } from '@/server/guard';
import { getDb } from '@/server/runtime';
import { getSyncRunner, syncStatus } from '@/server/sync-runtime';

export const dynamic = 'force-dynamic';

/** "Sync now": clears retry delays and wakes the worker. Returns at once; it never waits for the network. */
export const POST = withPermission('admin.sync.edit', () => {
  const runner = getSyncRunner();
  if (!runner) {
    return json(
      {
        error: {
          code: 'SYNC_NOT_CONFIGURED',
          message: 'Cloud sync is not configured on this server',
        },
      },
      409,
    );
  }
  runner.nudge();
  return json(syncStatus(getDb()), 202);
});
