import { sql } from 'drizzle-orm';
import type { Db } from './client';

/**
 * Refresh the query planner's statistics.
 *
 * Without statistics SQLite guesses, and on a large catalogue it can pick a wide index scan instead of
 * a primary-key lookup. The Phase 2 benchmark on 100,000 items measured a 200x difference for the same
 * invoice save (1.5 s without statistics, 6 ms with). `analysis_limit` keeps the refresh to a moment,
 * even on a large database. Run at server start, daily, and after any bulk import.
 */
export function refreshStatistics(db: Db): void {
  db.run(sql`PRAGMA analysis_limit = 2000`);
  db.run(sql`ANALYZE`);
  db.run(sql`PRAGMA optimize`);
}

/** Number of tables the planner has statistics for (used by tests and diagnostics). */
export function statisticsTableCount(db: Db): number {
  try {
    return db.get<{ n: number }>(sql`SELECT count(DISTINCT tbl) AS n FROM sqlite_stat1`)?.n ?? 0;
  } catch {
    return 0; // sqlite_stat1 does not exist until the first ANALYZE
  }
}
