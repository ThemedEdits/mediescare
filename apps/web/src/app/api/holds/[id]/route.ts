import { deleteHold, getHold } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission(
  'pharmacy.hold_invoice.view',
  async (_request, auth, ctx: Ctx) => {
    const { id } = await ctx.params;
    return json({ hold: getHold(getDb(), writeContext(auth.userId).branchId, id) });
  },
);

export const DELETE = withPermission(
  'pharmacy.hold_invoice.delete',
  async (_request, auth, ctx: Ctx) => {
    const { id } = await ctx.params;
    deleteHold(getDb(), writeContext(auth.userId), id);
    return json({ ok: true });
  },
);
