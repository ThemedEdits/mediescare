import { and, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { CloudAdapter, HybridLogicalClock, PulledChange } from '@mediescare/sync';
import type { Db } from '../client';
import { syncCursors, syncInboxSeen, syncOutbox } from '../schema/sqlite';

/**
 * Applies pulled changes to the domain tables. MUST be idempotent: after a crash between apply and
 * cursor save, the same changes are delivered again. The real appliers (items, suppliers, ...) are
 * per-entity and are not written yet (docs/sync.md, "What remains").
 */
export type ChangeApplier = (changes: PulledChange[]) => void | Promise<void>;

export interface PullOptions {
  entityTypes: readonly string[];
  apply: ChangeApplier;
  limit?: number;
  /** Safety valve: pages fetched in one call. */
  maxPages?: number;
  /** Merges the remote HLC so local edits after a pull sort after what we have seen. */
  clock?: HybridLogicalClock;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface PullSummary {
  pages: number;
  received: number;
  applied: number;
  /** Changes already seen (delivered twice) and skipped. */
  duplicates: number;
  /** A remote HLC was more than 24 h ahead of this device's clock. */
  skewSeen: boolean;
}

export function getCursors(db: Db, entityTypes: readonly string[]): Record<string, string> {
  const rows = db
    .select()
    .from(syncCursors)
    .where(inArray(syncCursors.entityType, [...entityTypes]))
    .all();
  const known = new Map(rows.map((r) => [r.entityType, r.remoteCursor]));
  return Object.fromEntries(entityTypes.map((t) => [t, known.get(t) ?? '0']));
}

/**
 * Pull deltas after the stored per-entity cursors. The cursor only advances after `apply`
 * succeeded, in the same transaction that records the event ids as seen. Throws on network
 * failure (the caller schedules the retry); nothing is lost because cursors stay put.
 */
export async function pullChanges(
  db: Db,
  adapter: CloudAdapter,
  options: PullOptions,
): Promise<PullSummary> {
  if (!adapter.pull) throw new Error('This cloud adapter cannot pull');
  const summary: PullSummary = {
    pages: 0,
    received: 0,
    applied: 0,
    duplicates: 0,
    skewSeen: false,
  };
  const nowIso = (options.now ? options.now() : new Date()).toISOString();
  for (let page = 0; page < (options.maxPages ?? 50); page++) {
    const cursors = getCursors(db, options.entityTypes);
    const response = await adapter.pull({ cursors, limit: options.limit ?? 200 }, options.signal);
    summary.pages += 1;
    summary.received += response.changes.length;

    const ids = response.changes.map((c) => c.event.id);
    const seen = new Set(
      ids.length
        ? db
            .select({ id: syncInboxSeen.eventId })
            .from(syncInboxSeen)
            .where(inArray(syncInboxSeen.eventId, ids))
            .all()
            .map((r) => r.id)
        : [],
    );
    const fresh = response.changes.filter((c) => !seen.has(c.event.id));
    summary.duplicates += response.changes.length - fresh.length;

    if (fresh.length > 0) await options.apply(fresh);
    for (const c of fresh) {
      if (options.clock && options.clock.receive(c.event.hlc).skewed) summary.skewSeen = true;
    }

    db.transaction((tx) => {
      for (const c of fresh)
        tx.insert(syncInboxSeen)
          .values({ eventId: c.event.id, appliedAt: nowIso })
          .onConflictDoNothing()
          .run();
      for (const [entityType, remoteCursor] of Object.entries(response.cursors)) {
        if (!options.entityTypes.includes(entityType)) continue;
        tx.insert(syncCursors)
          .values({ entityType, remoteCursor, lastPulledAt: nowIso })
          .onConflictDoUpdate({
            target: syncCursors.entityType,
            set: { remoteCursor, lastPulledAt: nowIso },
          })
          .run();
      }
    });
    summary.applied += fresh.length;
    if (!response.hasMore) break;
  }
  return summary;
}

/**
 * Repair tools (sync-design.md §5). Manager and Super Admin only; the caller audits them.
 *
 * `resetCursors`: re-pull entities from scratch on the next pull (keeps the outbox). Pulled changes are
 * applied again, so appliers must be idempotent.
 */
export function resetCursors(db: Db, entityTypes?: readonly string[]): number {
  const where = entityTypes?.length ? inArray(syncCursors.entityType, [...entityTypes]) : undefined;
  return db.transaction((tx) => {
    // The seen ledger has no entity column, so it is cleared as a whole; appliers are idempotent by contract.
    tx.delete(syncInboxSeen).run();
    return tx.delete(syncCursors).where(where).run().changes;
  });
}

/**
 * `requeueAcked`: mark already acknowledged events as unsent again, for example after the cloud
 * was restored to an older point (scenario 14) or a range is suspect. Safe because the cloud
 * dedupes by event id.
 */
export function requeueAcked(
  db: Db,
  range: { fromSeq?: number; toSeq?: number; sinceIso?: string } = {},
): number {
  const conds = [isNotNull(syncOutbox.ackAt)];
  if (range.fromSeq !== undefined) conds.push(gte(syncOutbox.seq, range.fromSeq));
  if (range.toSeq !== undefined) conds.push(lte(syncOutbox.seq, range.toSeq));
  if (range.sinceIso) conds.push(gte(syncOutbox.createdAt, range.sinceIso));
  return db
    .update(syncOutbox)
    .set({ ackAt: null, sentAt: null, error: null, attempts: 0, nextAttemptAt: null })
    .where(and(...conds))
    .run().changes;
}

/** `retryRejected`: put events the cloud rejected back in the queue (after a cloud-side fix). */
export function retryRejected(db: Db, exceptFenced = true): number {
  return db
    .update(syncOutbox)
    .set({ error: null, sentAt: null, attempts: 0, nextAttemptAt: null })
    .where(
      and(
        isNull(syncOutbox.ackAt),
        isNotNull(syncOutbox.error),
        exceptFenced ? sql`${syncOutbox.error} NOT LIKE 'fenced:%'` : undefined,
      ),
    )
    .run().changes;
}
