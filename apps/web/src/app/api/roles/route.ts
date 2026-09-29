import { z } from 'zod';
import { createRole, listRoles } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('admin.role.view', (_request, auth) =>
  json({ roles: listRoles(getDb(), writeContext(auth.userId).tenantId) }),
);

const Body = z.object({
  name: z.string().trim().min(2).max(60),
  permissions: z.array(z.string()).max(500),
  discountLimitBp: z.number().int().min(0).max(10_000),
  refundLimitMinor: z.number().int().min(0).nullable(),
  priceOverrideLimitBp: z.number().int().min(0).max(10_000),
});

export const POST = withPermission('admin.role.create', async (request, auth) => {
  const id = createRole(getDb(), writeContext(auth.userId), Body.parse(await request.json()));
  return json({ id }, 201);
});
