import { z } from 'zod';
import { deleteRole, getRole, updateRole } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission('admin.role.view', async (_request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  return json({ role: getRole(getDb(), writeContext(auth.userId).tenantId, id) });
});

const Body = z.object({
  name: z.string().trim().min(2).max(60),
  permissions: z.array(z.string()).max(500),
  discountLimitBp: z.number().int().min(0).max(10_000),
  refundLimitMinor: z.number().int().min(0).nullable(),
  priceOverrideLimitBp: z.number().int().min(0).max(10_000),
  expectedVersion: z.number().int().min(1),
});

export const PUT = withPermission('admin.role.edit', async (request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  updateRole(getDb(), writeContext(auth.userId), id, Body.parse(await request.json()));
  return json({ ok: true });
});

export const DELETE = withPermission('admin.role.delete', async (_request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  deleteRole(getDb(), writeContext(auth.userId), id);
  return json({ ok: true });
});
