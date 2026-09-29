import { eq } from 'drizzle-orm';
import { schema } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('admin.branch.view', (_request, auth) => {
  const rows = getDb()
    .select()
    .from(schema.branches)
    .where(eq(schema.branches.tenantId, writeContext(auth.userId).tenantId))
    .orderBy(schema.branches.code)
    .all();
  return json({
    branches: rows.map((b) => ({
      id: b.id,
      code: b.code,
      name: b.name,
      isHeadOffice: b.isHeadOffice,
      status: b.status,
    })),
  });
});
