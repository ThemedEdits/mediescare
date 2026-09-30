import { z } from 'zod';
import { createSupplier, listSuppliers } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('purchasing.supplier.view', (request, auth) =>
  json({
    suppliers: listSuppliers(
      getDb(),
      writeContext(auth.userId).tenantId,
      request.nextUrl.searchParams.get('q') ?? undefined,
    ),
  }),
);

const Body = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).nullish(),
  ntn: z.string().trim().max(30).nullish(),
  strn: z.string().trim().max(30).nullish(),
  termsDays: z.number().int().min(0).max(365).optional(),
  creditLimitMinor: z.number().int().min(0).optional(),
});

export const POST = withPermission('purchasing.supplier.create', async (request, auth) =>
  json(
    { id: createSupplier(getDb(), writeContext(auth.userId), Body.parse(await request.json())) },
    201,
  ),
);
