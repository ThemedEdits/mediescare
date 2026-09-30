import { z } from 'zod';
import { listStockTakeLines } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Query = z.object({
  filter: z.enum(['all', 'uncounted', 'variance']).optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withPermission(
  'inventory.count.view',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const query = Query.parse(Object.fromEntries(request.nextUrl.searchParams));
    return jsonFor(auth, listStockTakeLines(getDb(), writeContext(auth.userId), id, query));
  },
);
