import { z } from 'zod';
import { createExpenseCategory, EXPENSE_KINDS, listExpenseCategories } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('finance.expense.view', (request, auth) =>
  jsonFor(auth, {
    categories: listExpenseCategories(getDb(), writeContext(auth.userId), {
      includeInactive: request.nextUrl.searchParams.get('all') === '1',
    }),
  }),
);

const Body = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(EXPENSE_KINDS).optional(),
});

export const POST = withPermission('finance.expense_category.create', async (request, auth) =>
  jsonFor(
    auth,
    createExpenseCategory(getDb(), writeContext(auth.userId), Body.parse(await request.json())),
    201,
  ),
);
