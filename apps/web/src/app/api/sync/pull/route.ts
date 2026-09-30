import { NextResponse } from 'next/server';
import { getCloudContext } from '@/server/sync-cloud-context';
import { handleCloudPull } from '@/server/sync-cloud';
import { json, publicRoute } from '@/server/sync-http';

export const dynamic = 'force-dynamic';

/**
 * Cloud mode only: a branch server pulls changes after its per-entity cursors. Authenticated by the
 * device's access token (not a user session); see sync-cloud.ts.
 */
export const POST = publicRoute(async (request) => {
  const cloud = await getCloudContext();
  if (!cloud) return json({ error: { code: 'NOT_CLOUD_MODE' } }, 404);
  const result = await handleCloudPull(
    cloud.store,
    request.headers.get('authorization'),
    await request.text(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
});
