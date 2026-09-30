import { z } from 'zod';
import { cancelPurchaseOrder } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ reason: z.string().trim().min(3).max(300) });

export const POST = withPermission(
  'purchasing.purchase_order.edit',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const { reason } = Body.parse(await request.json());
    cancelPurchaseOrder(getDb(), writeContext(auth.userId), id, reason);
    return json({ ok: true });
  },
);
