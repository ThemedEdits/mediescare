import { PairingError } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';
import { auditPairingCode, getPairingCodes } from '@/server/sync-runtime';

export const dynamic = 'force-dynamic';

/** Is a pairing code currently live? (Never returns the code.) */
export const GET = withPermission('admin.device.view', () =>
  json({ active: getPairingCodes().isActive() }),
);

/**
 * Admin creates a one-time pairing code (10 minutes, single use) to show on this server's screen.
 * The terminal exchanges it for a device token at /api/sync/pair. The code is returned only here.
 */
export const POST = withPermission('admin.device.create', (_request, auth) => {
  try {
    const created = getPairingCodes().create(auth.userId);
    auditPairingCode(getDb(), writeContext(auth.userId), created.expiresAt);
    return json(created, 201);
  } catch (error) {
    if (error instanceof PairingError)
      return json({ error: { code: error.code, message: error.message } }, 429);
    throw error;
  }
});
