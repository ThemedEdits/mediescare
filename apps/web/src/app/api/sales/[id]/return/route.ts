import { z } from 'zod';
import { RETURN_REASONS, createReturn } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  lines: z
    .array(
      z.object({
        saleLineId: z.string().min(1),
        qtyBase: z.number().int().min(1),
        restock: z.boolean(),
      }),
    )
    .min(1),
  reasonCode: z.enum(RETURN_REASONS),
  reasonText: z.string().trim().max(200).optional(),
  refundModeId: z.string().min(1),
  overrideId: z.string().optional(),
});

export const POST = withPermission(
  'pharmacy.sale_return.create',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    return json(
      createReturn(getDb(), writeContext(auth.userId), {
        saleId: id,
        ...Body.parse(await request.json()),
      }),
      201,
    );
  },
);
