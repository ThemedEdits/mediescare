import { approvePurchaseOrder } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const POST = withPermission(
  'purchasing.purchase_order.approve',
  async (_request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    approvePurchaseOrder(getDb(), writeContext(auth.userId), id);
    return json({ ok: true });
  },
);
