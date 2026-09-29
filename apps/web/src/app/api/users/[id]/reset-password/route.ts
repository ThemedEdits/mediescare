import { resetPassword } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Issues a new temporary password (shown once) and signs the user out everywhere. */
export const POST = withPermission(
  'admin.user.edit',
  async (_request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    return json(await resetPassword(getDb(), writeContext(auth.userId), id));
  },
);
