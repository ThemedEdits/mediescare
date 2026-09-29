import { z } from 'zod';
import { grantOverride } from '@mediescare/db';
import { authenticate, json, publicRoute } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  approverUsername: z.string().trim().min(1).max(60),
  approverPin: z.string().min(4).max(6),
  kind: z.enum(['discount', 'refund', 'override_price', 'void', 'backdate']),
  amountMinor: z.number().int().min(0).optional(),
  percentBp: z.number().int().min(0).max(10_000).optional(),
  reference: z.string().max(80).optional(),
  reason: z.string().max(300).optional(),
});

/**
 * A signed-in user (for example a cashier) asks a manager to approve one action. The manager types
 * their own PIN. The result is a single-use, 2-minute approval id that the sale or return then uses.
 */
export const POST = publicRoute(async (request) => {
  const auth = await authenticate(request);
  const body = Body.parse(await request.json());
  return json(
    await grantOverride(getDb(), writeContext(auth.userId), { requesterId: auth.userId, ...body }),
    201,
  );
});
