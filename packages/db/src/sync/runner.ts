import {
  backoffDelayMs,
  type CloudAdapter,
  type HybridLogicalClock,
  type SyncState,
  type SyncStatusReport,
} from '@mediescare/sync';
import type { Db } from '../client';
import type { WriteContext } from '../context';
import { clearBackoff, getSyncStatus, pushOutbox, type PushSummary } from '../syncWorker';
import { getServerEpoch } from './epoch';
import { exportUnsentTail } from './failover';
import { pullChanges, type ChangeApplier } from './pull';

export interface SyncRunnerOptions {
  db: Db;
  adapter: CloudAdapter;
  /** Pause between cycles when everything is in sync. Default 5 s. */
  intervalMs?: number;
  batchSize?: number;
  /** Batches pushed back to back in one cycle, so a long backlog drains without waiting 5 s each. */
  maxBatchesPerCycle?: number;
  /** Where a fenced server writes its unsent tail for review. Without it, a fenced runner only stops. */
  exportDir?: string;
  /** Actor for the audit entry of a fence export. */
  auditContext?: () => WriteContext | null;
  /** Optional pull side. Without an applier the runner only pushes. */
  pull?: { entityTypes: readonly string[]; apply: ChangeApplier; clock?: HybridLogicalClock };
  /** Shown in the status, host only. */
  cloudHost?: string | null;
  now?: () => Date;
  random?: () => number;
}

/**
 * Background sync loop. Runs on timers inside the branch server process, entirely off the request
 * path: the POS never calls into it and never awaits it. Every failure is caught and turned into
 * status; the loop itself cannot throw into the server.
 */
export class SyncRunner {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;
  private state: SyncState = 'idle';
  private failures = 0;
  private lastSuccessAt: string | null = null;
  private lastError: { message: string; at: string } | null = null;
  private nextAttemptAt: string | null = null;
  private skewSuspected = false;
  private announced = false;
  private fencedAtEpoch: number | null = null;

  constructor(private readonly o: SyncRunnerOptions) {}

  private now(): Date {
    return (this.o.now ?? (() => new Date()))();
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(1_000);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** "Sync now": forget backoff delays and run a cycle as soon as possible. Returns immediately. */
  nudge(): void {
    clearBackoff(this.o.db);
    this.failures = 0;
    if (this.stopped) return;
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.nextAttemptAt = new Date(this.now().getTime() + delayMs).toISOString();
    this.timer = setTimeout(() => {
      void this.runOnce().finally(() => {
        if (!this.stopped) this.schedule(this.nextDelay());
      });
    }, delayMs);
    this.timer.unref();
  }

  private nextDelay(): number {
    const base = this.o.intervalMs ?? 5_000;
    if (this.state === 'fenced') return Math.max(base, 60_000);
    return this.failures > 0 ? Math.max(base, backoffDelayMs(this.failures, this.o.random)) : base;
  }

  /** One full cycle. Concurrent calls share the running cycle. Never rejects. */
  runOnce(): Promise<void> {
    this.running ??= this.cycle()
      .catch((error: unknown) =>
        this.fail('error', error instanceof Error ? error.message : 'Unexpected sync error'),
      )
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }

  private async cycle(): Promise<void> {
    const { db, adapter } = this.o;
    const epoch = getServerEpoch(db);
    if (this.fencedAtEpoch !== null && epoch <= this.fencedAtEpoch) {
      this.state = 'fenced';
      return; // still fenced: a promotion (higher local epoch) or "re-join as standby" must happen first
    }
    this.fencedAtEpoch = null;
    this.state = 'syncing';

    if (!this.announced && epoch > 1) {
      // Tell the cloud about the new epoch even if nothing is queued, so an old primary is fenced at once.
      try {
        await adapter.push({ idempotencyKey: `epoch-${epoch}`, epoch, events: [] });
        this.announced = true;
      } catch (error) {
        return this.handle(
          {
            sent: 0,
            acked: 0,
            rejected: 0,
            offline: true,
            fenced: false,
            skewFlagged: 0,
            errorKind: 'network',
            error: error instanceof Error ? error.message : 'offline',
          },
          epoch,
        );
      }
    }

    for (let i = 0; i < (this.o.maxBatchesPerCycle ?? 20); i++) {
      const summary = await pushOutbox(db, adapter, {
        batchSize: this.o.batchSize,
        now: this.o.now,
        random: this.o.random,
        epoch,
      });
      if (summary.offline || summary.fenced) return this.handle(summary, epoch);
      if (summary.skewFlagged > 0) this.skewSuspected = true;
      if (summary.acked + summary.rejected === 0) break; // nothing left, or no progress: stop for this cycle
      // Let the POS requests run between batches: SQLite calls are synchronous.
      await new Promise((r) => setImmediate(r));
    }
    this.succeed();

    if (this.o.pull && adapter.pull) {
      try {
        const res = await pullChanges(db, adapter, { ...this.o.pull, now: this.o.now });
        if (res.skewSeen) this.skewSuspected = true;
      } catch (error) {
        this.recordError(error instanceof Error ? error.message : 'Pull failed');
        this.failures += 1;
        this.state = 'offline';
      }
    }
  }

  private handle(summary: PushSummary, epoch: number): void {
    if (summary.fenced) {
      this.state = 'fenced';
      this.fencedAtEpoch = epoch;
      let note = summary.error ?? 'Stale server epoch';
      if (this.o.exportDir) {
        const exported = exportUnsentTail(this.o.db, this.o.exportDir, {
          cloudEpoch: summary.cloudEpoch,
          ctx: this.o.auditContext?.() ?? undefined,
          now: this.o.now,
        });
        if (exported) note += `. ${exported.count} unsent events were exported to ${exported.file}`;
      }
      this.recordError(note);
      return;
    }
    this.fail(
      summary.errorKind === 'auth' ? 'error' : 'offline',
      summary.error ?? 'Cloud not reachable',
    );
  }

  private fail(state: SyncState, message: string): void {
    this.failures += 1;
    this.state = state;
    this.recordError(message);
  }

  private succeed(): void {
    this.failures = 0;
    this.state = 'idle';
    this.lastSuccessAt = this.now().toISOString();
    this.lastError = null;
  }

  private recordError(message: string): void {
    this.lastError = { message, at: this.now().toISOString() };
  }

  status(): SyncStatusReport {
    return buildSyncStatus(this.o.db, {
      enabled: true,
      state: this.state,
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
      consecutiveFailures: this.failures,
      nextAttemptAt: this.stopped ? null : this.nextAttemptAt,
      clockSkewSuspected: this.skewSuspected,
      cloudHost: this.o.cloudHost ?? null,
      now: this.now(),
    });
  }
}

/** The status shape when sync is not configured: the app behaves exactly as before. */
export function disabledSyncStatus(db: Db, now: Date = new Date()): SyncStatusReport {
  return buildSyncStatus(db, {
    enabled: false,
    state: 'disabled',
    lastSuccessAt: null,
    lastError: null,
    consecutiveFailures: 0,
    nextAttemptAt: null,
    clockSkewSuspected: false,
    cloudHost: null,
    now,
  });
}

function buildSyncStatus(
  db: Db,
  s: Omit<
    SyncStatusReport,
    'pending' | 'rejected' | 'oldestPendingAt' | 'oldestPendingAgeSeconds' | 'serverEpoch'
  > & { now: Date },
): SyncStatusReport {
  const counts = getSyncStatus(db);
  const { now, ...rest } = s;
  return {
    ...rest,
    ...counts,
    oldestPendingAgeSeconds: counts.oldestPendingAt
      ? Math.max(0, Math.floor((now.getTime() - Date.parse(counts.oldestPendingAt)) / 1000))
      : null,
    serverEpoch: getServerEpoch(db),
  };
}
