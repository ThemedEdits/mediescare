import { z } from 'zod';
import { createCashAdjustment, listCashAdjustments } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Cash book entries of this branch (opening balance and corrections), newest first. */
export const GET = withPermission('reports.financial.view', (_request, auth) =>
  jsonFor(auth, { entries: listCashAdjustments(getDb(), writeContext(auth.userId)) }),
);

const Body = z.object({
  kind: z.enum(['opening', 'adjustment']),
  /** Signed paisa: positive adds cash, negative removes it. */
  amountMinor: z.number().int().safe(),
  entryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  note: z.string().trim().min(3).max(300),
});

/** Opening balance or correction. Needs the ledger right (Accountant, Branch Manager, admins). */
export const POST = withPermission('finance.ledger.create', async (request, auth) =>
  jsonFor(
    auth,
    createCashAdjustment(getDb(), writeContext(auth.userId), Body.parse(await request.json())),
    201,
  ),
);
