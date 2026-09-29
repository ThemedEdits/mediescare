import { z } from 'zod';
import { setUserActive } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ active: z.boolean() });

export const POST = withPermission(
  'admin.user.edit',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const { active } = Body.parse(await request.json());
    setUserActive(getDb(), writeContext(auth.userId), id, active);
    return json({ ok: true });
  },
);
