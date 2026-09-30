import { z } from 'zod';
import { openShift } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ floatMinor: z.number().int().min(0).max(100_000_000) });

export const POST = withPermission('shifts.shift.create', async (request, auth) =>
  json(openShift(getDb(), writeContext(auth.userId), Body.parse(await request.json())), 201),
);
