import { z } from 'zod';
import { suggestTransferBatches } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Query = z.object({
  itemId: z.string().min(1),
  qtyBase: z.coerce.number().int().safe().min(1),
});

/** First-expiry-first batches for an item and quantity (expired and blocked batches are never offered). */
export const GET = withPermission('inventory.transfer.create', (request, auth) => {
  const q = Query.parse(Object.fromEntries(request.nextUrl.searchParams));
  return jsonFor(
    auth,
    suggestTransferBatches(getDb(), writeContext(auth.userId), q.itemId, q.qtyBase),
  );
});
