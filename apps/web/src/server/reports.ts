import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { assertCan, can, type AccessContext } from '@mediescare/core';
import {
  applyColumnRights,
  DomainError,
  EXPIRY_BUCKETS,
  getReport,
  resolveRange,
  schema,
  type ColumnRights,
  type ReportDefinition,
  type ReportResult,
} from '@mediescare/db';
import type { AuthedRequest } from './guard';
import { getDb, writeContext } from './runtime';

/** Same rule as field-level stripping: any of the cost rights shows cost, profit needs its own right. */
export function columnRights(access: AccessContext): ColumnRights {
  return {
    cost: ['pharmacy.sale.view_cost', 'pharmacy.item.view_cost', 'inventory.stock.view_cost'].some(
      (k) => can(access, k),
    ),
    profit: can(access, 'pharmacy.sale.view_profit'),
  };
}

const empty = (v: unknown) => (v === '' || v === null ? undefined : v);
const date = z.preprocess(
  empty,
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-05')
    .optional(),
);

export const reportQuerySchema = z.object({
  from: date,
  to: date,
  q: z.preprocess(empty, z.string().trim().max(100).optional()),
  bucket: z.preprocess(empty, z.enum(EXPIRY_BUCKETS).optional()),
  limit: z.preprocess(empty, z.coerce.number().int().min(1).max(100_000).optional()),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;

export function parseReportQuery(params: URLSearchParams): ReportQuery {
  return reportQuerySchema.parse({
    from: params.get('from'),
    to: params.get('to'),
    q: params.get('q'),
    bucket: params.get('bucket'),
    limit: params.get('limit'),
  });
}

/** Find the report and check the user holds its own view (or export) right. 404 when it does not exist. */
export function authorizeReport(
  auth: AuthedRequest,
  id: string,
  action: 'view' | 'export',
): ReportDefinition {
  const report = getReport(id);
  if (!report) throw new DomainError('NOT_FOUND', 'Report not found');
  assertCan(
    auth.access,
    action === 'view' ? report.requiredPermission : report.exportPermission,
    auth.branchId ?? undefined,
  );
  return report;
}

/** Run the report for the session's branch and remove the columns the user may not see. */
export function runReportFor(
  auth: AuthedRequest,
  report: ReportDefinition,
  query: ReportQuery,
): ReportResult {
  const result = report.run(getDb(), writeContext(auth.userId), query);
  return applyColumnRights(result, columnRights(auth.access));
}

/** Line under the title of exports: branch, dates and filters used. */
export function describeFilters(auth: AuthedRequest, report: ReportDefinition, query: ReportQuery) {
  const ctx = writeContext(auth.userId);
  const db = getDb();
  const branch = db
    .select({ name: schema.branches.name })
    .from(schema.branches)
    .where(eq(schema.branches.id, ctx.branchId))
    .get();
  const range = resolveRange(db, ctx, query);
  const parts = [branch?.name ?? 'Branch'];
  if (report.filters.includes('range')) parts.push(`${range.from} to ${range.to}`);
  if (query.q) parts.push(`Search: ${query.q}`);
  if (query.bucket) parts.push(`Bucket: ${query.bucket}`);
  return { subtitle: parts.join(' | '), from: range.from, to: range.to };
}
