import { getPurchaseOrder, updateDraftPurchaseOrder } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';
import { PoUpdateBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission(
  'purchasing.purchase_order.view',
  async (_request, auth, ctx: Ctx) => {
    const { id } = await ctx.params;
    return jsonFor(auth, { order: getPurchaseOrder(getDb(), writeContext(auth.userId), id) });
  },
);

export const PUT = withPermission(
  'purchasing.purchase_order.edit',
  async (request, auth, ctx: Ctx) => {
    const { id } = await ctx.params;
    updateDraftPurchaseOrder(
      getDb(),
      writeContext(auth.userId),
      id,
      PoUpdateBody.parse(await request.json()),
    );
    return jsonFor(auth, { ok: true });
  },
);
