import { NextResponse } from 'next/server';
import { getCloudContext } from '@/server/sync-cloud-context';
import { handleBootstrap } from '@/server/sync-cloud-auth';
import { clientKey, CloudConfigError, json, publicRoute } from '@/server/sync-http';

export const dynamic = 'force-dynamic';

/**
 * Cloud mode only. The first Head Office PC creates the organisation, its Head Office branch and its
 * device. The credential is the cloud's bootstrap code (MEDIESCARE_CLOUD_BOOTSTRAP_CODE), compared
 * in constant time and rate limited. Works once per organisation name.
 */
export const POST = publicRoute(async (request) => {
  const cloud = await getCloudContext();
  if (!cloud) return json({ error: { code: 'NOT_CLOUD_MODE' } }, 404);
  if (!cloud.auth) throw new CloudConfigError('This cloud store has no device registry.');
  const result = await handleBootstrap(
    { auth: cloud.auth, bootstrapCode: cloud.bootstrapCode },
    clientKey(request),
    await request.text(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
});
