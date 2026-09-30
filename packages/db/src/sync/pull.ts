import { and, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { CloudAdapter, HybridLogicalClock, PulledChange } from '@mediescare/sync';
import type { Db } from '../client';
import { syncCursors, syncInboxSeen, syncOutbox } from '../schema/sqlite';

/**
 * What an applier tells the pull about one page.
 *
 * - `handled`: ids of the events that took effect or were deliberately skipped. Only these are
 *   recorded in the seen ledger. An event that is not listed was NOT handled (for example it is
 *   waiting for a parent row) and will be delivered again.
 * - `blocked`: entity types that stopped at an event whose parent has not arrived. For such a type
 *   the cursor only moves past the handled prefix, so nothing is lost and the runner retries later.
 */
export interface ApplyReport {
  applied: number;
  skipped: number;
  conflicts: number;
  handled: ReadonlySet<string>;
  blocked: Readonly<Record<string, string>>;
}

/**
 * Applies pulled changes to the domain tables. MUST be idempotent: after a crash between apply and
 * cursor save, the same changes are delivered again. A plain `void` return means "every change was
 * handled". The real appliers live in `./appliers` (`createChangeApplier`).
 */
export type ChangeApplier = (
  changes: PulledChange[],
) => void | ApplyReport | Promise<void | ApplyReport>;

export interface PullProgress {
  pages: number;
  received: number;
  applied: number;
  /** Events handled so far per entity type (applied, skipped or merged). */
  byType: Record<string, number>;
}

export interface PullOptions {
  entityTypes: readonly string[];
  apply: ChangeApplier;
  limit?: number;
  /** Safety valve: pages fetched in one call. */
  maxPages?: number;
  /** Merges the remote HLC so local edits after a pull sort after what we have seen. */
  clock?: Pick<HybridLogicalClock, 'receive'>;
  now?: () => Date;
  signal?: AbortSignal;
  /** Called after every page (the initial sync of a new branch shows a progress bar with it). */
  onProgress?: (progress: PullProgress) => void;
}

export interface PullSummary {
  pages: number;
  received: number;
  applied: number;
  /** Changes already seen (delivered twice) and skipped. */
  duplicates: number;
  /** Changes the appliers deliberately left alone (older than local state, not for this branch). */
  skipped: number;
  /** Changes merged with a conflict note. */
  conflicts: number;
  /** Entity types waiting for a parent row, with the reason. Empty when fully caught up. */
  blocked: Record<string, string>;
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
 *
 * An entity type the applier reports as blocked (missing parent) keeps its cursor behind the first
 * unhandled event. The loop carries on while other types still move (their parents may be among
 * them) and stops as soon as a page makes no progress at all.
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
    skipped: 0,
    conflicts: 0,
    blocked: {},
    skewSeen: false,
  };
  const byType: Record<string, number> = {};
  const nowIso = (options.now ? options.now() : new Date()).toISOString();
  for (let page = 0; page < (options.maxPages ?? 50); page++) {
    const cursors = getCursors(db, options.entityTypes);
    const response = await adapter.pull({ cursors, limit: options.limit ?? 200 }, options.signal);
    summary.pages += 1;
    summary.received += response.changes.length;

    const seen = seenEventIds(
      db,
      response.changes.map((c) => c.event.id),
    );
    const fresh = response.changes.filter((c) => !seen.has(c.event.id));
    summary.duplicates += response.changes.length - fresh.length;

    let report: ApplyReport | null = null;
    if (fresh.length > 0) {
      const result = await options.apply(fresh);
      if (result) report = result;
    }
    const handled = fresh.filter((c) => !report || report.handled.has(c.event.id));
    const handledIds = new Set(handled.map((c) => c.event.id));
    for (const c of handled) {
      if (options.clock && options.clock.receive(c.event.hlc).skewed) summary.skewSeen = true;
    }

    // Cursor per type: the cloud's new cursor, except for a blocked type, which stops after its handled prefix.
    const nextCursors: Record<string, string> = {};
    let moved = false;
    const blockedThisPage: Record<string, string> = {};
    for (const [entityType, remoteCursor] of Object.entries(response.cursors)) {
      if (!options.entityTypes.includes(entityType)) continue;
      const before = cursors[entityType] ?? '0';
      const reason = report?.blocked[entityType];
      if (reason === undefined) {
        nextCursors[entityType] = remoteCursor;
      } else {
        blockedThisPage[entityType] = reason;
        let cursor = before;
        for (const c of response.changes) {
          if (c.event.entityType !== entityType) continue;
          if (!seen.has(c.event.id) && !handledIds.has(c.event.id)) break;
          cursor = c.cursor;
        }
        nextCursors[entityType] = cursor;
      }
      if (nextCursors[entityType] !== before) moved = true;
    }
    summary.blocked = blockedThisPage;

    db.transaction((tx) => {
      for (const c of handled)
        tx.insert(syncInboxSeen)
          .values({ eventId: c.event.id, appliedAt: nowIso })
          .onConflictDoNothing()
          .run();
      for (const [entityType, remoteCursor] of Object.entries(nextCursors)) {
        tx.insert(syncCursors)
          .values({ entityType, remoteCursor, lastPulledAt: nowIso })
          .onConflictDoUpdate({
            target: syncCursors.entityType,
            set: { remoteCursor, lastPulledAt: nowIso },
          })
          .run();
      }
    });
    summary.applied += report ? report.applied : handled.length;
    summary.skipped += report?.skipped ?? 0;
    summary.conflicts += report?.conflicts ?? 0;
    for (const c of handled) byType[c.event.entityType] = (byType[c.event.entityType] ?? 0) + 1;
    options.onProgress?.({
      pages: summary.pages,
      received: summary.received,
      applied: summary.applied,
      byType: { ...byType },
    });

    const blocked = Object.keys(blockedThisPage).length > 0;
    const progressed = moved || handled.length > 0;
    if (blocked && !progressed) break; // stuck on a parent that has not arrived: retry next cycle
    if (!response.hasMore && !(blocked && progressed)) break;
  }
  return summary;
}

/** Which of these event ids are already in the seen ledger (queried in chunks, SQLite limits bound variables). */
function seenEventIds(db: Db, ids: string[]): Set<string> {
  const seen = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    db.select({ id: syncInboxSeen.eventId })
      .from(syncInboxSeen)
      .where(inArray(syncInboxSeen.eventId, ids.slice(i, i + 500)))
      .all()
      .forEach((r) => seen.add(r.id));
  }
  return seen;
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
