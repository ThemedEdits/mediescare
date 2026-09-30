import { z } from 'zod';
import { listGrns, receiveGrn } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';
import { GrnBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Query = z.object({
  supplierId: z.string().optional(),
  from: date.optional(),
  to: date.optional(),
  unpaidOnly: z.enum(['1', 'true']).optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

/** Supplier bills (goods receipts), newest first. */
export const GET = withPermission('purchasing.grn.view', (request, auth) => {
  const { unpaidOnly, ...rest } = Query.parse(Object.fromEntries(request.nextUrl.searchParams));
  return jsonFor(
    auth,
    listGrns(getDb(), writeContext(auth.userId), { ...rest, unpaidOnly: Boolean(unpaidOnly) }),
  );
});

/** Goods receipt ("Add stock"): creates batches and posts purchase movements in one transaction. */
export const POST = withPermission('purchasing.grn.create', async (request, auth) => {
  const result = receiveGrn(
    getDb(),
    writeContext(auth.userId),
    GrnBody.parse(await request.json()),
  );
  return jsonFor(auth, result, 201);
});
