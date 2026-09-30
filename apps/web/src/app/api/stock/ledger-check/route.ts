import { verifyStockLedger } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Recompute every batch balance from the ledger and flag negatives and movements with no batch. Read only. */
export const GET = withPermission('inventory.stock.view', (_request, auth) =>
  jsonFor(auth, verifyStockLedger(getDb(), writeContext(auth.userId))),
);
