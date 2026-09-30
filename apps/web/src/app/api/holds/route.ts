import { z } from 'zod';
import { holdInvoice, listHolds } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('pharmacy.hold_invoice.view', (_request, auth) =>
  json({ holds: listHolds(getDb(), writeContext(auth.userId).branchId) }),
);

const Body = z.object({
  id: z.string().optional(),
  label: z.string().trim().max(60).optional(),
  payload: z.unknown(),
});

/** Park a cart on the server so any counter of this branch can resume it. */
export const POST = withPermission('pharmacy.hold_invoice.create', async (request, auth) =>
  json(
    { id: holdInvoice(getDb(), writeContext(auth.userId), Body.parse(await request.json())) },
    201,
  ),
);
