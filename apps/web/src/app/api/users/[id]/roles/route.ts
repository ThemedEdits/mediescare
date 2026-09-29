import { z } from 'zod';
import { setUserRoles } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ roleIds: z.array(z.string()).min(1) });

export const PUT = withPermission(
  'admin.user.edit',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const { roleIds } = Body.parse(await request.json());
    setUserRoles(getDb(), writeContext(auth.userId), id, roleIds);
    return json({ ok: true });
  },
);
