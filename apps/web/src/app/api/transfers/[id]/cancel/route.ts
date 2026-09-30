import { z } from 'zod';
import { cancelTransfer } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ reason: z.string().trim().min(3).max(200) });

/** Cancel a transfer note before dispatch. A dispatched transfer cannot be cancelled. */
export const POST = withPermission(
  'inventory.transfer.edit',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const { reason } = Body.parse(await request.json());
    cancelTransfer(getDb(), writeContext(auth.userId), id, reason);
    return jsonFor(auth, { ok: true });
  },
);
