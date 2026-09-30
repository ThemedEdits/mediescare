import { NextResponse } from 'next/server';
import { json, publicRoute } from '@/server/guard';
import { CloudStoreNotImplementedError, getCloudStore, handleCloudPush } from '@/server/sync-cloud';

export const dynamic = 'force-dynamic';

/**
 * Cloud mode only: a branch server pushes a batch of outbox events. Authenticated by device
 * token (not a user session); validation, idempotency and epoch fencing live in sync-cloud.ts.
 */
export const POST = publicRoute(async (request) => {
  const store = getCloudStore();
  if (!store) return json({ error: { code: 'NOT_CLOUD_MODE' } }, 404);
  try {
    const result = await handleCloudPush(
      store,
      request.headers.get('authorization'),
      await request.text(),
    );
    return NextResponse.json(result.body, {
      status: result.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof CloudStoreNotImplementedError)
      return json({ error: { code: 'NOT_IMPLEMENTED' } }, 501);
    throw error;
  }
});
