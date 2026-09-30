import { z } from 'zod';
import { receiveTransfer } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  note: z.string().trim().max(300).optional(),
  lines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        qtyReceived: z.number().int().safe().min(0),
        qtyDamaged: z.number().int().safe().min(0).optional(),
      }),
    )
    .max(300)
    .optional(),
});

/** The receiving branch counts the goods: received, damaged, short. Once only. */
export const POST = withPermission(
  'inventory.transfer.create',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const input = Body.parse(await request.json().catch(() => ({})));
    return jsonFor(auth, receiveTransfer(getDb(), writeContext(auth.userId), id, input));
  },
);
