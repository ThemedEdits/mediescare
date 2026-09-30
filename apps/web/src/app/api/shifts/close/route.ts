import { z } from 'zod';
import { closeShift } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  shiftId: z.string().min(1),
  countedCashMinor: z.number().int().min(0).max(1_000_000_000),
  denominations: z.record(z.string(), z.number().int().min(0)).optional(),
});

/** Closes the caller's shift with a blind count. The variance is returned only after the count is saved. */
export const POST = withPermission('shifts.shift.create', async (request, auth) =>
  json(closeShift(getDb(), writeContext(auth.userId), Body.parse(await request.json()))),
);
