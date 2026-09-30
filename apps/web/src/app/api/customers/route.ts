import { z } from 'zod';
import { createCustomer, searchCustomers } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('pharmacy.customer.view', (request, auth) =>
  json({
    customers: searchCustomers(
      getDb(),
      writeContext(auth.userId).tenantId,
      request.nextUrl.searchParams.get('q') ?? '',
    ),
  }),
);

const Body = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30).nullish(),
  cnic: z.string().trim().max(20).nullish(),
  creditLimitMinor: z.number().int().min(0).optional(),
});

export const POST = withPermission('pharmacy.customer.create', async (request, auth) =>
  json(createCustomer(getDb(), writeContext(auth.userId), Body.parse(await request.json())), 201),
);
