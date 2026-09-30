/** Outbox event shape shared by the branch worker and the cloud endpoint (sync-design.md §4). */

export const SYNC_OPS = ['insert', 'update', 'void'] as const;
export type SyncOp = (typeof SYNC_OPS)[number];

/** Bumped when the payload contract changes. The cloud accepts N and N-1. */
export const SYNC_SCHEMA_VERSION = 1;

export interface SyncEvent {
  /** UUIDv7 of the outbox row. The cloud dedupes on this. */
  id: string;
  /** Local monotonically increasing number, used only for ordering pushes. */
  seq: number;
  entityType: string;
  entityId: string;
  op: SyncOp;
  payload: unknown;
  hlc: string;
  deviceId: string;
  branchId: string | null;
  tenantId: string;
  schemaVersion: number;
}

export type EventResult =
  | {
      id: string;
      status: 'applied';
      /** Accepted but worth a warning, for example `clock_skew` (sync-design.md §3). */
      flags?: string[];
    }
  | { id: string; status: 'duplicate' }
  | { id: string; status: 'rejected'; reason: string };

export interface PushRequest {
  /**
   * One id per batch attempt (the first event id). A retry of the same batch reuses it, and the
   * cloud additionally dedupes every event on its own id, so a lost response is always safe.
   */
  idempotencyKey: string;
  /**
   * Server epoch of the sending branch server (ADR-0004). The cloud refuses a push whose epoch is
   * lower than the highest epoch it has seen for the branch (fencing after a failover promotion).
   */
  epoch: number;
  events: SyncEvent[];
}

export interface PushResponse {
  results: EventResult[];
  /** Highest epoch the cloud knows for this branch. */
  epoch?: number;
}

/** Position of a device in the cloud change feed, one cursor per entity type. */
export type PullCursors = Record<string, string>;

export interface PullRequest {
  /** Entity types to fetch, each with the last cursor already applied ('0' for a fresh branch). */
  cursors: PullCursors;
  limit: number;
}

export interface PulledChange {
  /** Cloud change sequence (decimal string) of this event inside its entity type. */
  cursor: string;
  /** Version the cloud holds for the entity after applying this event (master data). */
  version: number | null;
  event: SyncEvent;
}

export interface PullResponse {
  changes: PulledChange[];
  /** New cursor per requested entity type (unchanged when nothing new). */
  cursors: PullCursors;
  /** True if more changes are waiting: call again straight away. */
  hasMore: boolean;
  epoch?: number;
}

/** The cloud refused the push because a newer server epoch exists for this branch. */
export class StaleEpochError extends Error {
  constructor(
    readonly sentEpoch: number,
    readonly currentEpoch: number,
  ) {
    super(`Stale server epoch ${sentEpoch}; the cloud is at epoch ${currentEpoch}`);
    this.name = 'StaleEpochError';
  }
}

/** The device token is unknown or revoked (device stolen, sync-design.md §8 #15). */
export class CloudAuthError extends Error {
  constructor(message = 'The cloud rejected this device token') {
    super(message);
    this.name = 'CloudAuthError';
  }
}

/**
 * Cloud adapter boundary (ADR-0012). Supabase is used as plain Postgres behind this interface,
 * so the provider can be swapped without touching the worker. Implementations: `HttpCloudAdapter`
 * (talks to a cloud-mode instance of this app) and `FakeCloud` (tests).
 *
 * Network or server failures are thrown; `StaleEpochError` and `CloudAuthError` are the two typed
 * failures the worker treats specially. `pull` is optional so push-only adapters stay valid.
 */
export interface CloudAdapter {
  push(request: PushRequest, signal?: AbortSignal): Promise<PushResponse>;
  pull?(request: PullRequest, signal?: AbortSignal): Promise<PullResponse>;
}

/** Push outcome handling: which events to mark done, and which to keep for retry. */
export function partitionResults(results: readonly EventResult[]): {
  acked: string[];
  rejected: { id: string; reason: string }[];
} {
  const acked: string[] = [];
  const rejected: { id: string; reason: string }[] = [];
  for (const r of results) {
    if (r.status === 'rejected') rejected.push({ id: r.id, reason: r.reason });
    else acked.push(r.id);
  }
  return { acked, rejected };
}

/** Status shown in Settings. Produced by the sync runner; safe to send to the browser. */
export const SYNC_STATES = ['disabled', 'idle', 'syncing', 'offline', 'fenced', 'error'] as const;
export type SyncState = (typeof SYNC_STATES)[number];

export interface SyncStatusReport {
  /** False when MEDIESCARE_CLOUD_URL is not configured: the app behaves as before. */
  enabled: boolean;
  state: SyncState;
  pending: number;
  rejected: number;
  oldestPendingAt: string | null;
  oldestPendingAgeSeconds: number | null;
  lastSuccessAt: string | null;
  lastError: { message: string; at: string } | null;
  /** The cloud flagged our clock as far ahead of its own: the operator should fix the PC clock. */
  clockSkewSuspected: boolean;
  consecutiveFailures: number;
  nextAttemptAt: string | null;
  serverEpoch: number;
  /** Host of the cloud endpoint only, never a token. */
  cloudHost: string | null;
}
