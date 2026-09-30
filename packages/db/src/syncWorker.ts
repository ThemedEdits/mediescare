import { and, asc, count, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  backoffDelayMs,
  CloudAuthError,
  partitionResults,
  StaleEpochError,
  type CloudAdapter,
  type SyncEvent,
  type SyncOp,
} from '@mediescare/sync';
import type { Db } from './client';
import { syncOutbox } from './schema/sqlite';
import { getServerEpoch } from './sync/epoch';

export interface PushOptions {
  batchSize?: number;
  /** Stop adding events to a batch once the payloads reach this many characters (default 1 MB). */
  maxBatchChars?: number;
  now?: () => Date;
  random?: () => number;
  /** Server epoch to send. Defaults to the durable epoch of this database (ADR-0004). */
  epoch?: number;
  signal?: AbortSignal;
  /** A hung cloud call is treated as a network failure after this long. Default 60 s. */
  timeoutMs?: number;
}

export type PushErrorKind = 'network' | 'auth' | 'fenced';

export interface PushSummary {
  sent: number;
  acked: number;
  rejected: number;
  /** True if the network call failed. Events stay queued and will be retried with backoff. */
  offline: boolean;
  /** True if the cloud refused our epoch: a newer server was promoted. Nothing is retried. */
  fenced: boolean;
  /** Events the cloud accepted with a `clock_skew` warning. */
  skewFlagged: number;
  errorKind?: PushErrorKind;
  error?: string;
  /** The epoch the cloud reported, when known. */
  cloudEpoch?: number;
}

export interface SyncStatus {
  pending: number;
  rejected: number;
  oldestPendingAt: string | null;
}

/** Numbers shown by the sync status chip. */
export function getSyncStatus(db: Db): SyncStatus {
  const pending = db
    .select({ n: count() })
    .from(syncOutbox)
    .where(and(isNull(syncOutbox.ackAt), isNull(syncOutbox.error)))
    .get();
  const rejected = db
    .select({ n: count() })
    .from(syncOutbox)
    .where(and(isNull(syncOutbox.ackAt), sql`${syncOutbox.error} IS NOT NULL`))
    .get();
  const oldest = db
    .select({ at: syncOutbox.createdAt })
    .from(syncOutbox)
    .where(and(isNull(syncOutbox.ackAt), isNull(syncOutbox.error)))
    .orderBy(asc(syncOutbox.seq))
    .limit(1)
    .get();
  return {
    pending: pending?.n ?? 0,
    rejected: rejected?.n ?? 0,
    oldestPendingAt: oldest?.at ?? null,
  };
}

/** Forget retry delays so the next cycle sends everything now ("Sync now"). Events are untouched. */
export function clearBackoff(db: Db): number {
  const res = db
    .update(syncOutbox)
    .set({ nextAttemptAt: null })
    .where(
      and(
        isNull(syncOutbox.ackAt),
        isNull(syncOutbox.error),
        sql`${syncOutbox.nextAttemptAt} IS NOT NULL`,
      ),
    )
    .run();
  return res.changes;
}

/**
 * One push cycle: send the oldest due events, mark acknowledged ones done, park rejected ones in
 * the error queue, and back off on network failure. Never throws for network errors and never
 * blocks the POS: it only reads and updates outbox rows, and is meant to run off the request path.
 *
 * Safety properties (tested in sync-chaos.test.ts):
 * - a row is marked sent only after the cloud acknowledged that exact event id;
 * - a lost response or duplicate delivery is harmless: the retry comes back `duplicate`;
 * - a stale epoch (`fenced`) leaves every row untouched for the failover export.
 */
export async function pushOutbox(
  db: Db,
  adapter: CloudAdapter,
  options: PushOptions = {},
): Promise<PushSummary> {
  const now = (options.now ?? (() => new Date()))();
  const nowIso = now.toISOString();
  const empty: PushSummary = {
    sent: 0,
    acked: 0,
    rejected: 0,
    offline: false,
    fenced: false,
    skewFlagged: 0,
  };
  const candidates = db
    .select()
    .from(syncOutbox)
    .where(
      and(
        isNull(syncOutbox.ackAt),
        isNull(syncOutbox.error),
        or(isNull(syncOutbox.nextAttemptAt), lte(syncOutbox.nextAttemptAt, nowIso)),
      ),
    )
    .orderBy(asc(syncOutbox.seq))
    .limit(options.batchSize ?? 200)
    .all();
  if (candidates.length === 0) return empty;

  const maxChars = options.maxBatchChars ?? 1_000_000;
  const rows: typeof candidates = [];
  let chars = 0;
  for (const r of candidates) {
    if (rows.length > 0 && chars + r.payloadJson.length > maxChars) break;
    rows.push(r);
    chars += r.payloadJson.length;
  }

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
    const response = await withTimeout(
      (signal) =>
        adapter.push(
          {
            idempotencyKey: events[0]?.id as string,
            epoch: options.epoch ?? getServerEpoch(db),
            events,
          },
          signal,
        ),
      options.timeoutMs ?? 60_000,
      options.signal,
    );
    // Only trust acknowledgements for events we actually sent in this batch.
    const sentIds = new Set(events.map((e) => e.id));
    const { acked, rejected } = partitionResults(response.results.filter((r) => sentIds.has(r.id)));
    db.transaction((tx) => {
      if (acked.length > 0) {
        tx.update(syncOutbox)
          .set({ ackAt: nowIso, sentAt: nowIso, error: null })
          .where(inArray(syncOutbox.id, acked))
          .run();
      }
      for (const r of rejected) {
        tx.update(syncOutbox)
          .set({ error: r.reason, sentAt: nowIso })
          .where(eq(syncOutbox.id, r.id))
          .run();
      }
    });
    const skewFlagged = response.results.filter(
      (r) => r.status === 'applied' && r.flags?.includes('clock_skew'),
    ).length;
    return {
      ...empty,
      sent: events.length,
      acked: acked.length,
      rejected: rejected.length,
      skewFlagged,
      cloudEpoch: response.epoch,
    };
  } catch (error) {
    if (error instanceof StaleEpochError) {
      return {
        ...empty,
        sent: events.length,
        fenced: true,
        errorKind: 'fenced',
        error: error.message,
        cloudEpoch: error.currentEpoch,
      };
    }
    // Network or server failure: keep every event, schedule the retry with exponential backoff.
    db.transaction((tx) => {
      for (const r of rows) {
        const attempts = r.attempts + 1;
        const next = new Date(
          now.getTime() + backoffDelayMs(attempts, options.random),
        ).toISOString();
        tx.update(syncOutbox)
          .set({ attempts, nextAttemptAt: next })
          .where(eq(syncOutbox.id, r.id))
          .run();
      }
    });
    return {
      ...empty,
      sent: events.length,
      offline: true,
      errorKind: error instanceof CloudAuthError ? 'auth' : 'network',
      error: error instanceof Error ? error.message : 'Unknown network error',
    };
  }
}

/** Run a cloud call so that it can never hang the worker: abort and fail after `timeoutMs`. */
async function withTimeout<T>(
  call: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  outer?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onOuter = () => controller.abort();
  outer?.addEventListener('abort', onOuter, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.race([
      call(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener(
          'abort',
          () => reject(new Error('Cloud request timed out')),
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}
