import { can } from '@mediescare/core';
import { REPORTS } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';

export const dynamic = 'force-dynamic';

/** The reports this user may run, with the filters each supports. */
export const GET = withPermission('reports.sales.view', (_request, auth) =>
  jsonFor(auth, {
    reports: REPORTS.filter((r) =>
      can(auth.access, r.requiredPermission, auth.branchId ?? undefined),
    ).map((r) => ({
      id: r.id,
      title: r.title,
      group: r.group,
      filters: r.filters,
      canExport: can(auth.access, r.exportPermission, auth.branchId ?? undefined),
    })),
  }),
);
