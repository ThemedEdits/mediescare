import { dispatchTransfer } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Goods leave Head Office and are in transit. Needs the approve right, separate from writing the note. */
export const POST = withPermission(
  'inventory.transfer.approve',
  async (_request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    return jsonFor(auth, dispatchTransfer(getDb(), writeContext(auth.userId), id));
  },
);
