import { newId } from '@mediescare/sync';
import type { Db } from '../client';
import type { WriteContext } from '../context';
import { DomainError } from '../errors';
import { checkCommitOptions, commitItemImport } from './commit';
import { detectMapping, type ColumnMapping } from './columns';
import type { ParsedTable } from './parse';
import type {
  CommitOptions,
  CommitResult,
  ImportProgress,
  ItemImportReport,
  PreparedImport,
  ValidationOptions,
} from './types';
import { validateItemRows } from './validate';

export const JOB_TTL_MS = 30 * 60 * 1000;

export type ImportJobStatus = 'ready' | 'queued' | 'running' | 'done' | 'failed';

export interface ImportJob {
  id: string;
  tenantId: string;
  userId: string | null;
  fileName: string;
  headers: string[];
  status: ImportJobStatus;
  mapping: ColumnMapping;
  validationOptions: ValidationOptions;
  report: ItemImportReport;
  progress: ImportProgress;
  result: CommitResult | null;
  error: string | null;
  touchedAt: number;
  /** Released once the commit starts, to free memory. */
  table: ParsedTable | null;
  prepared: PreparedImport | null;
}

interface Registry {
  jobs: Map<string, ImportJob>;
  running: string | null;
}

// On globalThis so dev-server hot reloads keep running jobs. Jobs live in memory only: a restart drops them.
const holder = globalThis as unknown as { __mediescareImportJobs?: Registry };
const registry = (): Registry =>
  (holder.__mediescareImportJobs ??= { jobs: new Map(), running: null });

function cleanup(now = Date.now()): void {
  const reg = registry();
  for (const [id, job] of reg.jobs)
    if (id !== reg.running && now - job.touchedAt > JOB_TTL_MS) reg.jobs.delete(id);
}

function progressFor(report: ItemImportReport): ImportProgress {
  return {
    done: 0,
    total: report.totalRows,
    created: 0,
    skipped: report.alreadyExist + report.skippedWithErrors,
    errors: report.skippedWithErrors,
    warnings: report.rowsWithWarnings,
  };
}

/** Parse result to a previewed job: auto-detect the mapping (or use the given one) and validate. */
export function createPreviewJob(
  db: Db,
  ctx: WriteContext,
  table: ParsedTable,
  mapping: ColumnMapping | null,
  validationOptions: ValidationOptions,
): ImportJob {
  cleanup();
  const used = mapping ?? detectMapping(table.headers);
  const prepared = validateItemRows(db, ctx, table, used, validationOptions);
  const job: ImportJob = {
    id: newId(),
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    fileName: table.fileName,
    headers: table.headers,
    status: 'ready',
    mapping: used,
    validationOptions,
    report: prepared.report,
    progress: progressFor(prepared.report),
    result: null,
    error: null,
    touchedAt: Date.now(),
    table,
    prepared,
  };
  registry().jobs.set(job.id, job);
  return job;
}

/** The job of this user, or NOT_FOUND. Another tenant's or user's job is never revealed. */
export function getImportJob(id: string, tenantId: string, userId: string | null): ImportJob {
  cleanup();
  const job = registry().jobs.get(id);
  if (!job || job.tenantId !== tenantId || job.userId !== userId)
    throw new DomainError(
      'NOT_FOUND',
      'This import was not found. It may have expired: upload the file again',
    );
  job.touchedAt = Date.now();
  return job;
}

/** Validate the same file again with another mapping or options. Only before the commit starts. */
export function remapImportJob(
  db: Db,
  ctx: WriteContext,
  job: ImportJob,
  mapping: ColumnMapping,
  validationOptions: ValidationOptions,
): ImportJob {
  if (job.status !== 'ready' || !job.table)
    throw new DomainError('CONFLICT', 'This import has already started');
  const prepared = validateItemRows(db, ctx, job.table, mapping, validationOptions);
  job.mapping = mapping;
  job.validationOptions = validationOptions;
  job.report = prepared.report;
  job.prepared = prepared;
  job.progress = progressFor(prepared.report);
  job.touchedAt = Date.now();
  return job;
}

/**
 * Start the commit in the background and return at once. Only one import runs per server at a time.
 * Bad options are refused here, before anything is written.
 */
export function startImportJob(
  db: Db,
  ctx: WriteContext,
  job: ImportJob,
  options: CommitOptions,
): ImportJob {
  const reg = registry();
  if (job.status !== 'ready' || !job.prepared)
    throw new DomainError('CONFLICT', 'This import has already started');
  if (reg.running !== null)
    throw new DomainError('CONFLICT', 'Another import is running. Wait for it to finish');
  const prepared = job.prepared;
  checkCommitOptions(db, ctx, prepared, options);

  reg.running = job.id;
  job.status = 'queued';
  job.table = null;
  job.prepared = null;
  void (async () => {
    try {
      job.status = 'running';
      job.result = await commitItemImport(
        db,
        ctx,
        prepared,
        { ...options, importId: job.id },
        (p) => {
          job.progress = p;
          job.touchedAt = Date.now();
        },
      );
      job.status = 'done';
    } catch (error) {
      job.status = 'failed';
      job.error =
        error instanceof DomainError
          ? error.message
          : 'The import stopped because of an unexpected error. Items saved so far are kept: run the file again to continue';
      if (!(error instanceof DomainError))
        console.error('[import] failed:', error instanceof Error ? error.message : 'unknown');
    } finally {
      reg.running = null;
      job.touchedAt = Date.now();
    }
  })();
  return job;
}

/** Test helper: forget all jobs. */
export function resetImportJobs(): void {
  holder.__mediescareImportJobs = { jobs: new Map(), running: null };
}
