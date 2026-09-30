import { z } from 'zod';
import { createPurchaseReturn, listPurchaseReturns, SUPPLIER_RETURN_REASONS } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Query = z.object({
  supplierId: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withPermission('purchasing.purchase_return.view', (request, auth) =>
  jsonFor(
    auth,
    listPurchaseReturns(
      getDb(),
      writeContext(auth.userId),
      Query.parse(Object.fromEntries(request.nextUrl.searchParams)),
    ),
  ),
);

const Body = z.object({
  supplierId: z.string().min(1),
  grnId: z.string().min(1).nullish(),
  reason: z.enum(SUPPLIER_RETURN_REASONS),
  note: z.string().trim().max(300).optional(),
  creditNoteNo: z.string().trim().max(60).optional(),
  lines: z
    .array(z.object({ batchId: z.string().min(1), qtyBase: z.number().int().safe().min(1) }))
    .min(1)
    .max(300),
});

export const POST = withPermission('purchasing.purchase_return.create', async (request, auth) =>
  jsonFor(
    auth,
    createPurchaseReturn(getDb(), writeContext(auth.userId), Body.parse(await request.json())),
    201,
  ),
);
