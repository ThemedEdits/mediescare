import { salesSummary, stockValueMinor } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Dashboard cards for today. Cost, profit and stock value are removed for roles without view_cost / view_profit. */
export const GET = withPermission('pharmacy.sale.view', (_request, auth) => {
  const ctx = writeContext(auth.userId);
  const db = getDb();
  // "Today" in the branch time zone, as a UTC range.
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const from = new Date(`${day}T00:00:00+05:00`).toISOString();
  const to = new Date(`${day}T23:59:59.999+05:00`).toISOString();
  return jsonFor(auth, {
    day,
    ...salesSummary(db, ctx.branchId, from, to),
    costValueMinor: stockValueMinor(db, ctx.branchId),
  });
});
