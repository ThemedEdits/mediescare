import { z } from 'zod';
import { setUserBranches } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ branchIds: z.array(z.string()), allBranches: z.boolean() });

export const PUT = withPermission(
  'admin.user.edit',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    setUserBranches(getDb(), writeContext(auth.userId), id, Body.parse(await request.json()));
    return json({ ok: true });
  },
);
