import { performance } from 'node:perf_hooks';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db } from '../client';
import type { WriteContext } from '../context';
import { DomainError } from '../errors';
import { refreshStatistics } from '../maintenance';
import { branchToday } from '../pharmacy/common';
import type { CommitOptions, CommitResult, ImportProgress, PreparedImport } from './types';
import { ItemWriter } from './writer';

/** Rows per transaction: short enough to keep the POS responsive, long enough to keep fsync cost low. */
export const CHUNK_SIZE = 1000;

/**
 * Check the options before anything is written. Returns the default expiry to use (or null).
 * Opening stock rows without an expiry need a future default date, because a batch cannot exist without one.
 */
export function checkCommitOptions(
  db: Db,
  ctx: WriteContext,
  prepared: PreparedImport,
  options: CommitOptions,
): string | null {
  const today = branchToday(db, ctx);
  const expiry = options.defaultExpiry?.trim() || null;
  if (expiry !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || Number.isNaN(Date.parse(expiry))))
    throw new DomainError('INVALID', 'Default expiry must be a date like 2028-12-31');
  if (expiry !== null && expiry <= today)
    throw new DomainError('INVALID', 'Default expiry must be in the future');
  if (options.importStock && prepared.report.needsDefaultExpiry > 0 && expiry === null)
    throw new DomainError(
      'INVALID',
      `${prepared.report.needsDefaultExpiry} rows have a quantity but no expiry date. Enter a default expiry date for opening stock`,
    );
  return expiry;
}

/**
 * Write the prepared rows in chunks of CHUNK_SIZE, one transaction each, and give the event loop a
 * turn between chunks so the server stays responsive. Each chunk writes ONE audit entry (item count,
 * first and last file row) instead of one per item: 53,000 audit rows would add nothing a chunk entry
 * does not say, and every created item still has its own outbox row for sync.
 * A failure stops the import; earlier chunks stay. Running the same file again skips items that
 * already have their barcode, so it can simply be re-run.
 */
export async function commitItemImport(
  db: Db,
  ctx: WriteContext,
  prepared: PreparedImport,
  options: CommitOptions,
  onProgress: (progress: ImportProgress) => void = () => undefined,
): Promise<CommitResult> {
  const defaultExpiry = checkCommitOptions(db, ctx, prepared, options);
  const importId = options.importId ?? newId();
  const started = performance.now();
  const { report, rows } = prepared;
  const writer = new ItemWriter(db, ctx, {
    importStock: options.importStock,
    defaultExpiry,
    today: branchToday(db, ctx),
    importId,
  });

  const progress: ImportProgress = {
    done: report.totalRows - rows.length,
    total: report.totalRows,
    created: 0,
    skipped: report.alreadyExist + report.skippedWithErrors,
    errors: report.skippedWithErrors,
    warnings: report.rowsWithWarnings,
  };
  onProgress({ ...progress });

  for (let start = 0; start < rows.length; start += CHUNK_SIZE) {
    const chunk = rows.slice(start, start + CHUNK_SIZE);
    let created = 0;
    db.transaction((tx) => {
      writer.beginChunk();
      for (const row of chunk) if (writer.write(row) === 'created') created++;
      appendAudit(tx, ctx, {
        action: 'item.import',
        entityType: 'item_import',
        entityId: importId,
        newValue: {
          items: created,
          skipped: chunk.length - created,
          firstRow: chunk[0]?.rowNo,
          lastRow: chunk[chunk.length - 1]?.rowNo,
          openingStock: options.importStock,
        },
      });
    });
    progress.created += created;
    progress.skipped += chunk.length - created;
    progress.done += chunk.length;
    onProgress({ ...progress });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  // The query planner needs fresh statistics after a big import, or searches and sales slow down.
  refreshStatistics(db);
  return {
    created: progress.created,
    skipped: progress.skipped,
    openingBatches: writer.tally.openingBatches,
    openingSkipped: writer.tally.openingSkipped,
    unitsCreated: writer.counts.units,
    categoriesCreated: writer.counts.categories,
    manufacturersCreated: writer.counts.manufacturers,
    racksCreated: writer.counts.racks,
    durationMs: Math.floor(performance.now() - started),
  };
}
