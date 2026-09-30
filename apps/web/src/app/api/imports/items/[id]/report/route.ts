import { buildIssueReportCsv, getImportJob } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** The skipped and warned rows as a CSV file, with the row number and the reason for each. */
export const GET = withPermission('pharmacy.item.import', async (_request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  const job = getImportJob(id, writeContext(auth.userId).tenantId, auth.userId);
  return new Response(buildIssueReportCsv(job.report), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="item-import-issues.csv"',
      'Cache-Control': 'no-store',
    },
  });
});
