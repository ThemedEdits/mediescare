import { z } from 'zod';
import { voidExpense } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ reason: z.string().trim().min(3).max(300) });

/** Voiding is the only way to correct a posted expense, so it uses the delete right of the catalogue. */
export const POST = withPermission(
  'finance.expense.delete',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const body = Body.parse(await request.json());
    voidExpense(getDb(), writeContext(auth.userId), { expenseId: id, reason: body.reason });
    return jsonFor(auth, { ok: true });
  },
);
