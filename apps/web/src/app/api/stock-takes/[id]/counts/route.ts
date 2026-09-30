import { z } from 'zod';
import { recordCounts } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  counts: z
    .array(
      z.object({
        lineId: z.string().min(1),
        countedQtyBase: z.number().int().safe().min(0).nullable(),
      }),
    )
    .min(1)
    .max(1000),
});

export const POST = withPermission(
  'inventory.count.create',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const { counts } = Body.parse(await request.json());
    return json(recordCounts(getDb(), writeContext(auth.userId), id, counts));
  },
);
