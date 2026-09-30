import { NextResponse } from 'next/server';
import { getCloudContext } from '@/server/sync-cloud-context';
import { handleEnroll } from '@/server/sync-cloud-auth';
import { clientKey, CloudConfigError, json, publicRoute } from '@/server/sync-http';

export const dynamic = 'force-dynamic';

/**
 * Cloud mode only. A new branch trades a one-time enrollment code for its device and tokens. The code
 * is the credential: wrong, expired and used codes all answer the same, and attempts are rate limited.
 */
export const POST = publicRoute(async (request) => {
  const cloud = await getCloudContext();
  if (!cloud) return json({ error: { code: 'NOT_CLOUD_MODE' } }, 404);
  if (!cloud.auth) throw new CloudConfigError('This cloud store has no device registry.');
  const result = await handleEnroll(
    { auth: cloud.auth, bootstrapCode: cloud.bootstrapCode },
    clientKey(request),
    await request.text(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
});
