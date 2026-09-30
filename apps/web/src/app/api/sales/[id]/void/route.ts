import { z } from 'zod';
import { voidSale } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  reason: z.string().trim().min(3).max(200),
  overrideId: z.string().optional(),
});

/**
 * Void a sale from the open shift. Reachable by cashiers so they can ask for a manager PIN; the
 * service itself refuses unless the user holds the void right or presents a valid override.
 */
export const POST = withPermission(
  'pharmacy.sale.create',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    voidSale(getDb(), writeContext(auth.userId), {
      saleId: id,
      ...Body.parse(await request.json()),
    });
    return json({ ok: true });
  },
);
