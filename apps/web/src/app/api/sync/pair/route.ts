import { PairingError, pairTerminal } from '@mediescare/db';
import { json, publicRoute } from '@/server/guard';
import { getDb, getRuntime, writeContext } from '@/server/runtime';
import { RequestLimiter } from '@/server/sync-cloud';
import { PairBodySchema } from '@/server/sync-schemas';
import { getPairingCodes } from '@/server/sync-runtime';

export const dynamic = 'force-dynamic';

// A global brake on guesses: 10 attempts a minute for the whole server, on top of the per-code
// limit of five wrong guesses (PairingCodes). Pairing is rare, so this never affects real use.
const attempts = new RequestLimiter(10, 60_000);

/**
 * A terminal exchanges the one-time code shown on this branch server for its device token.
 * Public route: the code is the credential. Wrong, expired and used codes give the same answer.
 */
export const POST = publicRoute(async (request) => {
  const mode = getRuntime().mode;
  if (mode !== 'branch-server') return json({ error: { code: 'NOT_BRANCH_SERVER' } }, 404);
  if (!attempts.allow('pair')) return json({ error: { code: 'RATE_LIMITED' } }, 429);
  const body = PairBodySchema.parse(await request.json());
  try {
    const paired = pairTerminal(getDb(), writeContext(null), getPairingCodes(), body);
    return json(paired, 201);
  } catch (error) {
    if (error instanceof PairingError) {
      return json(
        { error: { code: error.code, message: error.message } },
        error.code === 'RATE_LIMITED' ? 429 : 403,
      );
    }
    throw error;
  }
});
