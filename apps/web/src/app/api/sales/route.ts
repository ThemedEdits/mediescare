import { createSale, listSales } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';
import { SaleBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

export const GET = withPermission('pharmacy.sale.view', (request, auth) => {
  const q = request.nextUrl.searchParams;
  return jsonFor(
    auth,
    listSales(getDb(), writeContext(auth.userId).branchId, {
      q: q.get('q') ?? undefined,
      from: q.get('from') ?? undefined,
      to: q.get('to') ?? undefined,
      page: Number(q.get('page') ?? 1) || 1,
      pageSize: Number(q.get('pageSize') ?? 25) || 25,
    }),
  );
});

/**
 * Save a sale. One transaction on the branch server: stock, money, payments, audit and sync queue.
 * Never waits for the internet. A retry with the same idempotencyKey returns the original sale.
 */
export const POST = withPermission('pharmacy.sale.create', async (request, auth) => {
  const result = createSale(
    getDb(),
    writeContext(auth.userId),
    SaleBody.parse(await request.json()),
  );
  return jsonFor(auth, result, result.replay ? 200 : 201);
});
