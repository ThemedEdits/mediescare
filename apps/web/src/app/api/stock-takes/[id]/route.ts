import { getStockTake } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission(
  'inventory.count.view',
  async (_request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    return jsonFor(auth, { take: getStockTake(getDb(), writeContext(auth.userId), id) });
  },
);
