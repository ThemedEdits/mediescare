import { and, asc, count, isNull, lte, or, eq, inArray, sql } from 'drizzle-orm';
import {
  backoffDelayMs,
  partitionResults,
  type CloudAdapter,
  type SyncEvent,
  type SyncOp,
} from '@mediescare/sync';
import type { Db } from './client';
import { syncOutbox } from './schema/sqlite';

export interface PushOptions {
  batchSize?: number;
  now?: () => Date;
  random?: () => number;
}

export interface PushSummary {
  sent: number;
  acked: number;
  rejected: number;
  /** True if the network call failed. Events stay queued and will be retried with backoff. */
  offline: boolean;
}

export interface SyncStatus {
  pending: number;
  rejected: number;
  oldestPendingAt: string | null;
}

/** Numbers shown by the sync status chip. */
export function getSyncStatus(db: Db): SyncStatus {
  const pending = db.select({ n: count() }).from(syncOutbox).where(and(isNull(syncOutbox.ackAt), isNull(syncOutbox.error))).get();
  const rejected = db.select({ n: count() }).from(syncOutbox).where(and(isNull(syncOutbox.ackAt), sql`${syncOutbox.error} IS NOT NULL`)).get();
  const oldest = db
    .select({ at: syncOutbox.createdAt })
    .from(syncOutbox)
    .where(and(isNull(syncOutbox.ackAt), isNull(syncOutbox.error)))
    .orderBy(asc(syncOutbox.seq))
    .limit(1)
    .get();
  return { pending: pending?.n ?? 0, rejected: rejected?.n ?? 0, oldestPendingAt: oldest?.at ?? null };
}

/**
 * One push cycle: send the oldest due events, mark acknowledged ones done, park rejected ones in
 * the error queue, and back off on network failure. Never throws for network errors and never
 * blocks the POS: it only reads and updates outbox rows.
 */
export async function pushOutbox(db: Db, adapter: CloudAdapter, options: PushOptions = {}): Promise<PushSummary> {
  const now = (options.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const rows = db
    .select()
    .from(syncOutbox)
    .where(and(isNull(syncOutbox.ackAt), isNull(syncOutbox.error), or(isNull(syncOutbox.nextAttemptAt), lte(syncOutbox.nextAttemptAt, nowIso))))
    .orderBy(asc(syncOutbox.seq))
    .limit(options.batchSize ?? 200)
    .all();
  if (rows.length === 0) return { sent: 0, acked: 0, rejected: 0, offline: false };

  const events: SyncEvent[] = rows.map((r) => ({
    id: r.id,
    seq: r.seq,
    entityType: r.entityType,
    entityId: r.entityId,
    op: r.op as SyncOp,
    payload: JSON.parse(r.payloadJson) as unknown,
    hlc: r.hlc,
    deviceId: r.deviceId,
    branchId: r.branchId,
    tenantId: r.tenantId,
    schemaVersion: r.schemaVersion,
  }));

  try {
    const response = await adapter.push({ idempotencyKey: events[0]?.id as string, events });
    const { acked, rejected } = partitionResults(response.results);
    db.transaction((tx) => {
      if (acked.length > 0) {
        tx.update(syncOutbox).set({ ackAt: nowIso, sentAt: nowIso, error: null }).where(inArray(syncOutbox.id, acked)).run();
      }
      for (const r of rejected) {
        tx.update(syncOutbox).set({ error: r.reason, sentAt: nowIso }).where(eq(syncOutbox.id, r.id)).run();
      }
    });
    return { sent: events.length, acked: acked.length, rejected: rejected.length, offline: false };
  } catch {
    // Network or server failure: keep every event, schedule the retry with exponential backoff.
    db.transaction((tx) => {
      for (const r of rows) {
        const attempts = r.attempts + 1;
        const next = new Date(now.getTime() + backoffDelayMs(attempts, options.random)).toISOString();
        tx.update(syncOutbox).set({ attempts, nextAttemptAt: next }).where(eq(syncOutbox.id, r.id)).run();
      }
    });
    return { sent: events.length, acked: 0, rejected: 0, offline: true };
  }
}
