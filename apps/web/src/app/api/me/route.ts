import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { getUser, schema, updateUser } from '@mediescare/db';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from '@/i18n/core';
import { authenticate, json, publicRoute } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = publicRoute(async (request) => {
  const auth = await authenticate(request);
  const user = getDb().select().from(schema.users).where(eq(schema.users.id, auth.userId)).get();
  return json({
    user: user && {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      language: user.language,
    },
    branchId: auth.branchId,
    allBranches: auth.access.allBranches,
    permissionCount: auth.access.permissions.size,
  });
});

const Patch = z.object({ language: z.enum(['en', 'ur']) });

/** A signed-in user changes their own display language. Saved on the user (audited, synced) and in the cookie. */
export const PATCH = publicRoute(async (request) => {
  const auth = await authenticate(request);
  const { language } = Patch.parse(await request.json());
  const db = getDb();
  const ctx = writeContext(auth.userId);
  const current = getUser(db, ctx.tenantId, auth.userId);
  if (current.language !== language)
    updateUser(db, ctx, auth.userId, { language, expectedVersion: current.version });
  const response = json({ language });
  response.cookies.set(LOCALE_COOKIE, language, {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
  });
  return response;
});
