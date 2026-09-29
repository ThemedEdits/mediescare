import { z } from 'zod';
import { clearPin, setPin } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };
const Body = z.object({ pin: z.string().min(4).max(6) });

export const POST = withPermission('admin.user.edit', async (request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  const { pin } = Body.parse(await request.json());
  await setPin(getDb(), writeContext(auth.userId), id, pin);
  return json({ ok: true });
});

export const DELETE = withPermission('admin.user.edit', async (_request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  clearPin(getDb(), writeContext(auth.userId), id);
  return json({ ok: true });
});
