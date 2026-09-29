import { appendAudit, revokeSession, SESSION_COOKIE } from '@mediescare/db';
import { authenticate, json, publicRoute } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const POST = publicRoute(async (request) => {
  const response = json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  try {
    const auth = await authenticate(request);
    const db = getDb();
    db.transaction((tx) => {
      revokeSession(tx, auth.sessionId, new Date());
      appendAudit(tx, writeContext(auth.userId), { action: 'auth.logout', entityType: 'user', entityId: auth.userId });
    });
  } catch {
    // Already signed out: clearing the cookie is all that is left to do.
  }
  return response;
});
