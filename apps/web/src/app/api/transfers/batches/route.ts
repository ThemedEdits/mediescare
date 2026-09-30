import { z } from 'zod';
import { listTransferBatches } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Query = z.object({ itemId: z.string().min(1) });

/** Every batch of an item at this branch for the batch picker, with why a batch cannot be sent. */
export const GET = withPermission('inventory.transfer.create', (request, auth) => {
  const q = Query.parse(Object.fromEntries(request.nextUrl.searchParams));
  return jsonFor(auth, {
    batches: listTransferBatches(getDb(), writeContext(auth.userId), q.itemId),
  });
});
