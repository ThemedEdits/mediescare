import { z } from 'zod';
import { listStockTakes, startStockTake } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('inventory.count.view', (_request, auth) =>
  jsonFor(auth, { takes: listStockTakes(getDb(), writeContext(auth.userId)) }),
);

const Body = z.object({
  title: z.string().trim().min(2).max(120),
  note: z.string().trim().max(300).optional(),
  scope: z
    .object({
      categoryId: z.string().min(1).nullish(),
      rackId: z.string().min(1).nullish(),
      itemIds: z.array(z.string().min(1)).max(5000).optional(),
    })
    .optional(),
});

/** Open a count: freezes the system quantity of every batch in scope. */
export const POST = withPermission('inventory.count.create', async (request, auth) =>
  jsonFor(
    auth,
    startStockTake(getDb(), writeContext(auth.userId), Body.parse(await request.json())),
    201,
  ),
);
