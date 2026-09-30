import { interBranchPosition } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Value dispatched, received, in transit and lost (damage, shortage) with every other branch, at cost. */
export const GET = withPermission('inventory.transfer.view', (_request, auth) =>
  jsonFor(auth, interBranchPosition(getDb(), writeContext(auth.userId))),
);
