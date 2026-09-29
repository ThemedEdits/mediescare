import { z } from 'zod';
import { changeOwnPassword } from '@mediescare/db';
import { authenticate, json, publicRoute } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(1).max(200),
});

/** Works while a temporary password is pending (it is how the user gets out of that state). */
export const POST = publicRoute(async (request) => {
  const auth = await authenticate(request);
  const body = Body.parse(await request.json());
  await changeOwnPassword(getDb(), writeContext(auth.userId), {
    userId: auth.userId,
    currentSessionId: auth.sessionId,
    ...body,
  });
  return json({ ok: true });
});
