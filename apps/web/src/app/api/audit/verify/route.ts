import { verifyAuditChain } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/** Verify the hash chain of the caller's branch. */
export const GET = withPermission('admin.audit_log.view', (_request, auth) => {
  if (!auth.branchId) return json({ error: { code: 'NO_BRANCH' } }, 400);
  return json(verifyAuditChain(getDb(), auth.branchId));
});
