import { z } from 'zod';
import { login, SESSION_COOKIE } from '@mediescare/db';
import { json, publicRoute } from '@/server/guard';
import { getDb, getSessionSecret, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ username: z.string().trim().min(1).max(60), password: z.string().min(1).max(200) });

export const POST = publicRoute(async (request) => {
  const { username, password } = Body.parse(await request.json());
  const result = await login(getDb(), writeContext(null), { username, password }, getSessionSecret());
  const response = json({ user: result.user });
  response.cookies.set(SESSION_COOKIE, result.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    // Plain HTTP is normal on a pharmacy LAN. Secure is enabled when the server is served over TLS.
    secure: request.nextUrl.protocol === 'https:',
    maxAge: 12 * 60 * 60,
  });
  return response;
});
