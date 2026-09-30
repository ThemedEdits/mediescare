import { listOtherBranches } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Branches this branch can send stock to (every active branch except itself). */
export const GET = withPermission('inventory.transfer.create', (_request, auth) =>
  jsonFor(auth, { branches: listOtherBranches(getDb(), writeContext(auth.userId)) }),
);
