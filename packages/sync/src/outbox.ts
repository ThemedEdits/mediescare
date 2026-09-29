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
  | { id: string; status: 'applied' }
  | { id: string; status: 'duplicate' }
  | { id: string; status: 'rejected'; reason: string };

export interface PushRequest {
  idempotencyKey: string;
  events: SyncEvent[];
}

export interface PushResponse {
  results: EventResult[];
}

/**
 * Cloud adapter boundary (ADR-0012 proposal). Supabase is used as plain Postgres behind this
 * interface, so the provider can be swapped without touching the worker.
 */
export interface CloudAdapter {
  push(request: PushRequest, signal?: AbortSignal): Promise<PushResponse>;
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
