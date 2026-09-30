import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { authorizeReport, parseReportQuery, runReportFor } from '@/server/reports';

export const dynamic = 'force-dynamic';

export const GET = withPermission(
  'reports.sales.view',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const report = authorizeReport(auth, id, 'view');
    const query = parseReportQuery(request.nextUrl.searchParams);
    return jsonFor(auth, runReportFor(auth, report, query));
  },
);
