import { z } from 'zod';
import { recordMissedSale } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  itemId: z.string().nullish(),
  itemText: z.string().trim().max(120).optional(),
  unitId: z.string().nullish(),
  qty: z.number().int().min(1).max(100_000),
  customerPhone: z.string().trim().max(30).optional(),
  supplierId: z.string().nullish(),
});

/** Something a customer wanted that was not available. Feeds purchasing suggestions. */
export const POST = withPermission('pharmacy.missed_sale.create', async (request, auth) =>
  json(
    { id: recordMissedSale(getDb(), writeContext(auth.userId), Body.parse(await request.json())) },
    201,
  ),
);
