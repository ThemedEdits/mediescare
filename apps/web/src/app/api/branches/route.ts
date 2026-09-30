import { listBranches } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** The organisation's branches as this server knows them (Head Office sends the list down). */
export const GET = withPermission('admin.branch.view', (_request, auth) => {
  return json({ branches: listBranches(getDb(), writeContext(auth.userId).tenantId) });
});
