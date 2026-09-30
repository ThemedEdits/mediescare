import { eq } from 'drizzle-orm';
import { schema } from '@mediescare/db';
import { json, publicRoute } from '@/server/guard';
import { getDb, getIdentity, initialized } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/**
 * What the desktop shell puts in its LAN announcement: branch code and name only. This is exactly
 * what is broadcast on the network anyway, so it is public. No ids, no secrets.
 */
export const GET = publicRoute(() => {
  if (!initialized()) return json({ error: { code: 'NOT_SET_UP' } }, 404);
  const branch = getDb()
    .select({ code: schema.branches.code, name: schema.branches.name })
    .from(schema.branches)
    .where(eq(schema.branches.id, getIdentity().branchId))
    .get();
  if (!branch) return json({ error: { code: 'NOT_SET_UP' } }, 404);
  return json({ branchCode: branch.code, name: branch.name });
});
