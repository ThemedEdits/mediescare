import { getBatchStock } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('inventory.batch.view', (request, auth) => {
  const itemId = request.nextUrl.searchParams.get('itemId');
  if (!itemId) return json({ error: { code: 'INVALID', message: 'itemId is required' } }, 400);
  const includeEmpty = request.nextUrl.searchParams.get('all') === '1';
  return jsonFor(auth, {
    batches: getBatchStock(getDb(), writeContext(auth.userId).branchId, itemId, { includeEmpty }),
  });
});
