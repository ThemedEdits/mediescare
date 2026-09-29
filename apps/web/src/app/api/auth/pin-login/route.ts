import { z } from 'zod';
import { loginWithPin, SESSION_COOKIE } from '@mediescare/db';
import { json, publicRoute } from '@/server/guard';
import { getDb, getSessionSecret, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  username: z.string().trim().min(1).max(60),
  pin: z.string().min(4).max(6),
});

/** Quick counter sign-in. The session is limited: it locks after 5 idle minutes and cannot open admin screens. */
export const POST = publicRoute(async (request) => {
  const { username, pin } = Body.parse(await request.json());
  const result = await loginWithPin(
    getDb(),
    writeContext(null),
    { username, pin },
    getSessionSecret(),
  );
  const response = json({ user: result.user });
  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: request.nextUrl.protocol === 'https:',
    maxAge: 12 * 60 * 60,
  });
  return response;
});
