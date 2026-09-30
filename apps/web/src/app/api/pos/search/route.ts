import { searchItems } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Counter search: barcode (scanner) or typed name, with sellable stock and batches. Cost is stripped per role. */
export const GET = withPermission('pharmacy.sale.create', (request, auth) => {
  const q = request.nextUrl.searchParams.get('q') ?? '';
  return jsonFor(auth, {
    hits: searchItems(getDb(), writeContext(auth.userId), q.slice(0, 80), 20),
  });
});
