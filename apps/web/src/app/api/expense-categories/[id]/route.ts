import { z } from 'zod';
import { EXPENSE_KINDS, updateExpenseCategory } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  version: z.number().int().min(1),
  name: z.string().trim().min(2).max(60).optional(),
  kind: z.enum(EXPENSE_KINDS).optional(),
  isActive: z.boolean().optional(),
});

/** Rename, change kind or deactivate. A category is never deleted: past expenses keep pointing at it. */
export const PATCH = withPermission(
  'finance.expense_category.edit',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const body = Body.parse(await request.json());
    return jsonFor(auth, {
      category: updateExpenseCategory(getDb(), writeContext(auth.userId), { id, ...body }),
    });
  },
);
