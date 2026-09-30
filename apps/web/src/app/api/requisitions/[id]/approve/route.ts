import { z } from 'zod';
import { approveRequisition } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  lines: z
    .array(z.object({ lineId: z.string().min(1), qtyApprovedBase: z.number().int().safe().min(0) }))
    .max(300)
    .optional(),
});

/** Head Office approves a branch requisition, optionally lowering quantities. */
export const POST = withPermission(
  'inventory.requisition.approve',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const input = Body.parse(await request.json().catch(() => ({})));
    return jsonFor(auth, approveRequisition(getDb(), writeContext(auth.userId), id, input));
  },
);
