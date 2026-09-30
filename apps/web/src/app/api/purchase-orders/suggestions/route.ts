import { branchToday, suggestOrder } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Items to reorder: at or below their reorder level, or asked for by customers and not in stock. */
export const GET = withPermission('purchasing.purchase_order.view', (_request, auth) => {
  const db = getDb();
  const ctx = writeContext(auth.userId);
  return jsonFor(auth, { suggestions: suggestOrder(db, ctx, branchToday(db, ctx)) });
});
