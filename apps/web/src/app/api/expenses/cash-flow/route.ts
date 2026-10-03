import { z } from 'zod';
import { cashFlow } from '@mediescare/db';
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
const Query = z.object({ from: date, to: date });

/** Cash book for a date range: opening, in and out by source, by payment mode and by category, daily closing. */
export const GET = withPermission('reports.financial.view', (request, auth) =>
  jsonFor(
    auth,
    cashFlow(
      getDb(),
      writeContext(auth.userId),
      Query.parse(Object.fromEntries(request.nextUrl.searchParams)),
    ),
  ),
);
