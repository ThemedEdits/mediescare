import { APP_NAME } from '@mediescare/config';
import { isCloudMode } from '@/server/sync-cloud-context';
import { json, publicRoute } from '@/server/sync-http';

export const dynamic = 'force-dynamic';

/**
 * Health probe of a cloud-mode deployment (served as /api/health there, see next.config.ts). It never
 * touches the database, so it answers even when the database is paused, and reveals nothing.
 */
export const GET = publicRoute(() =>
  isCloudMode()
    ? json({ status: 'ok', app: APP_NAME, mode: 'cloud', time: new Date().toISOString() })
    : json({ error: { code: 'NOT_CLOUD_MODE' } }, 404),
);
