import { z } from 'zod';
import { branchToday, getSupplierLedger, listOpenBills } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Query = z.object({ from: date.optional(), to: date.optional() });

/** Statement of account: running balance, ageing buckets and the bills still open. */
export const GET = withPermission(
  'purchasing.supplier_payment.view',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const range = Query.parse(Object.fromEntries(request.nextUrl.searchParams));
    const db = getDb();
    const wctx = writeContext(auth.userId);
    return jsonFor(auth, {
      ledger: getSupplierLedger(db, wctx, id, branchToday(db, wctx), range),
      openBills: listOpenBills(db, wctx, id),
    });
  },
);
