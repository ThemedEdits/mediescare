import { z } from 'zod';
import { createPurchaseOrder, listPurchaseOrders } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';
import { PoBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

const Query = z.object({
  status: z.enum(['draft', 'approved', 'partial', 'received', 'cancelled']).optional(),
  supplierId: z.string().optional(),
  q: z.string().max(80).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = withPermission('purchasing.purchase_order.view', (request, auth) => {
  const query = Query.parse(Object.fromEntries(request.nextUrl.searchParams));
  return jsonFor(auth, listPurchaseOrders(getDb(), writeContext(auth.userId), query));
});

export const POST = withPermission('purchasing.purchase_order.create', async (request, auth) =>
  jsonFor(
    auth,
    createPurchaseOrder(getDb(), writeContext(auth.userId), PoBody.parse(await request.json())),
    201,
  ),
);
