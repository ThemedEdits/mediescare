import { z } from 'zod';
import { transferReconciliation } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Query = z.object({
  branchId: z.string().min(1).optional(),
  itemId: z.string().min(1).optional(),
  status: z.enum(['dispatched', 'received']).optional(),
  from: date.optional(),
  to: date.optional(),
});

/** Dispatched against received, damaged, short and in transit, per transfer and per item. */
export const GET = withPermission('inventory.transfer.view', (request, auth) =>
  jsonFor(
    auth,
    transferReconciliation(
      getDb(),
      writeContext(auth.userId),
      Query.parse(Object.fromEntries(request.nextUrl.searchParams)),
    ),
  ),
);
