import { z } from 'zod';
import { assertCan } from '@mediescare/core';
import { branchToday, createExpense, listExpenses } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const empty = (v: unknown) => (v === '' || v === null ? undefined : v);
const date = z.preprocess(
  empty,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
);

const Query = z.object({
  from: date,
  to: date,
  categoryId: z.preprocess(empty, z.string().min(1).optional()),
  modeId: z.preprocess(empty, z.string().min(1).optional()),
  status: z.preprocess(empty, z.enum(['posted', 'void']).optional()),
  page: z.preprocess(empty, z.coerce.number().int().min(1).optional()),
  pageSize: z.preprocess(empty, z.coerce.number().int().min(1).max(200).optional()),
});

export const GET = withPermission('finance.expense.view', (request, auth) =>
  jsonFor(
    auth,
    listExpenses(
      getDb(),
      writeContext(auth.userId),
      Query.parse(Object.fromEntries(request.nextUrl.searchParams)),
    ),
  ),
);

const Body = z.object({
  categoryId: z.string().min(1),
  amountMinor: z.number().int().safe().min(1),
  modeId: z.string().min(1),
  expenseDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  payee: z.string().trim().max(120).optional(),
  reference: z.string().trim().max(80).optional(),
  note: z.string().trim().max(300).optional(),
  fromTill: z.boolean().optional(),
});

export const POST = withPermission('finance.expense.create', async (request, auth) => {
  const input = Body.parse(await request.json());
  const ctx = writeContext(auth.userId);
  // A date other than today is a backdated entry and needs the backdate right.
  if (input.expenseDate && input.expenseDate !== branchToday(getDb(), ctx))
    assertCan(auth.access, 'pharmacy.sale.backdate', auth.branchId ?? undefined);
  return jsonFor(auth, createExpense(getDb(), ctx, input), 201);
});
