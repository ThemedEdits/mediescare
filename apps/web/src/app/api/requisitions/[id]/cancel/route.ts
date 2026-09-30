import { z } from 'zod';
import { cancelRequisition } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ reason: z.string().trim().min(3).max(200) });

/** Cancel a requisition that has not been approved yet. */
export const POST = withPermission(
  'inventory.requisition.create',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const { reason } = Body.parse(await request.json());
    cancelRequisition(getDb(), writeContext(auth.userId), id, reason);
    return jsonFor(auth, { ok: true });
  },
);
