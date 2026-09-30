import { listStock } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('inventory.stock.view', (request, auth) => {
  const q = request.nextUrl.searchParams;
  return jsonFor(
    auth,
    listStock(getDb(), writeContext(auth.userId), {
      q: q.get('q') ?? undefined,
      page: Number(q.get('page') ?? 1) || 1,
      pageSize: Number(q.get('pageSize') ?? 25) || 25,
      lowOnly: q.get('low') === '1',
      onlyInStock: q.get('inStock') === '1',
    }),
  );
});
