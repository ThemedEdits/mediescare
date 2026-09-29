import { eq } from 'drizzle-orm';
import { schema } from '@mediescare/db';
import { authenticate, json, publicRoute } from '@/server/guard';
import { getDb } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = publicRoute(async (request) => {
  const auth = await authenticate(request);
  const user = getDb().select().from(schema.users).where(eq(schema.users.id, auth.userId)).get();
  return json({
    user: user && { id: user.id, username: user.username, fullName: user.fullName, language: user.language },
    branchId: auth.branchId,
    allBranches: auth.access.allBranches,
    permissionCount: auth.access.permissions.size,
  });
});
