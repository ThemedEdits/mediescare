import { createItem, listStock } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';
import { ItemBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** Item list with stock figures, server-side search and paging. */
export const GET = withPermission('pharmacy.item.view', (request, auth) => {
  const q = request.nextUrl.searchParams;
  const result = listStock(getDb(), writeContext(auth.userId), {
    q: q.get('q') ?? undefined,
    page: Number(q.get('page') ?? 1) || 1,
    pageSize: Number(q.get('pageSize') ?? 25) || 25,
    lowOnly: q.get('low') === '1',
    onlyInStock: q.get('inStock') === '1',
  });
  return jsonFor(auth, result);
});

export const POST = withPermission('pharmacy.item.create', async (request, auth) => {
  const id = createItem(getDb(), writeContext(auth.userId), ItemBody.parse(await request.json()));
  return jsonFor(auth, { id }, 201);
});
