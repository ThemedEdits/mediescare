import { z } from 'zod';
import { getUser, updateUser } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission('admin.user.view', async (_request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  return json({ user: getUser(getDb(), writeContext(auth.userId).tenantId, id) });
});

const Patch = z.object({
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(200).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  language: z.enum(['en', 'ur']).optional(),
  expectedVersion: z.number().int().min(1),
});

export const PATCH = withPermission('admin.user.edit', async (request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = Patch.parse(await request.json());
  return json({ user: updateUser(getDb(), writeContext(auth.userId), id, body) });
});
