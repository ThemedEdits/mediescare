import { z } from 'zod';
import { postStockTake } from '@mediescare/db';
import { jsonFor } from '@/server/respond';
import { withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ uncounted: z.enum(['ignore', 'zero']) });

/** Post the differences to the stock ledger. Needs the approve right, separate from counting. */
export const POST = withPermission(
  'inventory.count.approve',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const opts = Body.parse(await request.json());
    return jsonFor(auth, { result: postStockTake(getDb(), writeContext(auth.userId), id, opts) });
  },
);
