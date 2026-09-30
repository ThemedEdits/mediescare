import { z } from 'zod';
import { createTransfer, listTransfers } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Query = z.object({
  status: z.enum(['draft', 'dispatched', 'received', 'cancelled']).optional(),
  direction: z.enum(['outgoing', 'incoming']).optional(),
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withPermission('inventory.transfer.view', (request, auth) =>
  jsonFor(
    auth,
    listTransfers(
      getDb(),
      writeContext(auth.userId),
      Query.parse(Object.fromEntries(request.nextUrl.searchParams)),
    ),
  ),
);

const Body = z.object({
  requisitionId: z.string().min(1).nullish(),
  toBranchId: z.string().min(1).nullish(),
  note: z.string().trim().max(300).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        batchId: z.string().min(1),
        qtyBase: z.number().int().safe().min(1),
      }),
    )
    .max(300)
    .optional(),
});

/** Head Office writes a transfer note (a draft). Nothing leaves stock until it is dispatched. */
export const POST = withPermission('inventory.transfer.create', async (request, auth) =>
  jsonFor(
    auth,
    createTransfer(getDb(), writeContext(auth.userId), Body.parse(await request.json())),
    201,
  ),
);
