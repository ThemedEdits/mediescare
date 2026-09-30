import { NextResponse } from 'next/server';
import { getCloudContext } from '@/server/sync-cloud-context';
import { handleCreateEnrollmentCode } from '@/server/sync-cloud-auth';
import { CloudConfigError, json, publicRoute } from '@/server/sync-http';

export const dynamic = 'force-dynamic';

/**
 * Cloud mode only. A Head Office device (access token) creates a one-time enrollment code, valid 24
 * hours, that lets a new branch join. The code is returned once and stored only as a hash.
 */
export const POST = publicRoute(async (request) => {
  const cloud = await getCloudContext();
  if (!cloud) return json({ error: { code: 'NOT_CLOUD_MODE' } }, 404);
  if (!cloud.auth) throw new CloudConfigError('This cloud store has no device registry.');
  const result = await handleCreateEnrollmentCode(
    { auth: cloud.auth, bootstrapCode: cloud.bootstrapCode },
    request.headers.get('authorization'),
    await request.text(),
  );
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store' },
  });
});
