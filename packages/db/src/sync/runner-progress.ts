import { count, eq, isNotNull } from 'drizzle-orm';
import type { InitialUploadProgress } from '@mediescare/sync';
import type { Db } from '../client';
import { syncCursors, syncOutbox } from '../schema/sqlite';

/**
 * Progress of the first upload of the backlog that existed before this PC was connected.
 *
 * The outbox keeps every write since the database was created, so connecting uploads the whole
 * history in order, batch by batch. Progress is derived from the outbox itself (acknowledged rows
 * out of all rows), so it survives a crash or restart. A marker row in `sync_cursors` records that
 * the first upload finished once; it is not an entity cursor and never read by pull.
 */
const MARKER = '_initial_upload';

export function isInitialUploadDone(db: Db): boolean {
  return (
    db
      .select({ t: syncCursors.entityType })
      .from(syncCursors)
      .where(eq(syncCursors.entityType, MARKER))
      .get() !== undefined
  );
}

export function markInitialUploadDone(db: Db, nowIso: string): void {
  db.insert(syncCursors)
    .values({ entityType: MARKER, remoteCursor: 'done', lastPulledAt: nowIso })
    .onConflictDoNothing()
    .run();
}

export function initialUploadProgress(db: Db, active: boolean): InitialUploadProgress | null {
  if (isInitialUploadDone(db)) return null;
  const total = db.select({ n: count() }).from(syncOutbox).get()?.n ?? 0;
  if (total === 0) return null;
  const sent =
    db.select({ n: count() }).from(syncOutbox).where(isNotNull(syncOutbox.ackAt)).get()?.n ?? 0;
  return { active, sent, total };
}
