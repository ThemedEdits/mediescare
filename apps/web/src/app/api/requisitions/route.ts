import { z } from 'zod';
import { createRequisition, listRequisitions } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Query = z.object({
  status: z.enum(['submitted', 'approved', 'fulfilled', 'cancelled']).optional(),
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withPermission('inventory.requisition.view', (request, auth) =>
  jsonFor(
    auth,
    listRequisitions(
      getDb(),
      writeContext(auth.userId),
      Query.parse(Object.fromEntries(request.nextUrl.searchParams)),
    ),
  ),
);

const Body = z.object({
  neededBy: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  note: z.string().trim().max(300).optional(),
  lines: z
    .array(z.object({ itemId: z.string().min(1), qtyBase: z.number().int().safe().min(1) }))
    .min(1)
    .max(300),
});

/** A branch asks Head Office for stock. */
export const POST = withPermission('inventory.requisition.create', async (request, auth) =>
  jsonFor(
    auth,
    createRequisition(getDb(), writeContext(auth.userId), Body.parse(await request.json())),
    201,
  ),
);
