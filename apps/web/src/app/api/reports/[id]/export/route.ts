import { NextResponse } from 'next/server';
import { z } from 'zod';
import { withPermission } from '@/server/guard';
import { authorizeReport, describeFilters, parseReportQuery, runReportFor } from '@/server/reports';
import { reportToXlsx } from '@/server/xlsx';

export const dynamic = 'force-dynamic';

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const GET = withPermission(
  'reports.sales.view',
  async (request, auth, ctx: { params: Promise<{ id: string }> }) => {
    const { id } = await ctx.params;
    const params = request.nextUrl.searchParams;
    z.literal('xlsx').parse(params.get('format') ?? 'xlsx');
    const report = authorizeReport(auth, id, 'export');
    const query = parseReportQuery(params);
    const result = runReportFor(auth, report, query);
    const { subtitle, from, to } = describeFilters(auth, report, query);
    const file = await reportToXlsx(result, { subtitle });
    return new NextResponse(new Uint8Array(file), {
      headers: {
        'Content-Type': XLSX_TYPE,
        'Content-Disposition': `attachment; filename="mediescare-${report.id}-${from}-${to}.xlsx"`,
        'Cache-Control': 'no-store',
      },
    });
  },
);
