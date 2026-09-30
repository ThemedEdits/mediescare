import { NextResponse } from 'next/server';
import { getCloudContext } from '@/server/sync-cloud-context';
import { handleRefresh } from '@/server/sync-cloud-auth';
import { clientKey, CloudConfigError, json, publicRoute } from '@/server/sync-http';

export const dynamic = 'force-dynamic';

/**
 * Cloud mode only. A device trades its refresh token for a new access token AND a new refresh token
 * (the old one stops working). Presenting a refresh token that was already used revokes the device.
 */
export const POST = publicRoute(async (request) => {
  const cloud = await getCloudContext();
  if (!cloud) return json({ error: { code: 'NOT_CLOUD_MODE' } }, 404);
  if (!cloud.auth) throw new CloudConfigError('This cloud store has no device registry.');
  const result = await handleRefresh(
    { auth: cloud.auth, bootstrapCode: cloud.bootstrapCode },
    clientKey(request),
    await request.text(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
});
