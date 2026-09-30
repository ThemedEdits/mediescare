import { z } from 'zod';
import { ADJUSTMENT_REASONS, adjustStock } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  batchId: z.string().min(1),
  qtyDeltaBase: z.number().int().safe(),
  reason: z.enum(ADJUSTMENT_REASONS),
  note: z.string().trim().max(300).optional(),
});

export const POST = withPermission('inventory.adjustment.create', async (request, auth) =>
  json(adjustStock(getDb(), writeContext(auth.userId), Body.parse(await request.json())), 201),
);
