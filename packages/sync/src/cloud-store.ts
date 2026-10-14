import { mergeMasterEvent, type ConflictNote, type MasterRecord } from './conflict';
import { MAX_SKEW_MS, parseHlc } from './hlc';
import {
  StaleEpochError,
  SYNC_SCHEMA_VERSION,
  type EventResult,
  type PulledChange,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncEvent,
} from './outbox';

/** Who is calling the cloud: resolved from the device token, never from the request body. */
export interface DeviceAuth {
  tenantId: string;
  branchId: string;
  deviceId: string;
  /** True for the Head Office branch (wins on price-policy fields). */
  headOffice: boolean;
}

/**
 * Server-side storage behind `/api/sync/push` and `/api/sync/pull`. Each method must be atomic
 * per call for its own data. The epoch check and the writes of `applyBatch` share one transaction
 * in a real database (`SELECT ... FOR UPDATE` on the branch epoch row), so a fenced device can
 * never sneak in a write between check and insert.
 *
 * Implementations: `InMemoryCloudStore` (tests, local development) and `PostgresCloudStore`
 * (packages/db/src/sync/cloud). Both run the same contract suite (`runCloudStoreContract`).
 */
export interface CloudStore {
  authenticate(token: string): Promise<DeviceAuth | null>;
  applyBatch(auth: DeviceAuth, request: PushRequest): Promise<PushResponse>;
  pull(auth: DeviceAuth, request: PullRequest): Promise<PullResponse>;
}

/** Entities edited by many users and branches (LWW with conflict notes). Everything else is append-only. */
export const DEFAULT_MASTER_ENTITIES: readonly string[] = [
  'branches',
  'items',
  'suppliers',
  'customers',
  'categories',
  'manufacturers',
  'racks',
  'units',
  'payment_modes',
  // Accounts reach every branch; branches apply them only from Head Office (ADR-0016).
  'roles',
  'users',
  'user_roles',
  'user_branches',
];

/** Price-policy fields Head Office owns (sync-design.md §6). */
export const DEFAULT_PRICE_FIELDS: Readonly<Record<string, readonly string[]>> = {
  items: ['retailRateUnitMicro', 'taxBp', 'taxInclusive', 'maxDiscountBp'],
};

export const MAX_BATCH_EVENTS = 500;

/** One event's payload (JSON text) may not exceed this. Keeps a batch under Vercel's 4.5 MB body limit. */
export const MAX_EVENT_PAYLOAD_CHARS = 512_000;

const hasNul = (v: string) => v.includes(String.fromCharCode(0));

/** Structural checks the cloud repeats on every event (a compromised branch cannot post for another). */
export function validateEvent(
  auth: DeviceAuth,
  event: SyncEvent,
  nowMs: number,
): { flags: string[] } | { reason: string } {
  if (event.tenantId !== auth.tenantId) return { reason: 'scope_mismatch_tenant' };
  if (event.branchId !== null && event.branchId !== auth.branchId)
    return { reason: 'scope_mismatch_branch' };
  if (event.deviceId !== auth.deviceId) return { reason: 'scope_mismatch_device' };
  if (event.schemaVersion > SYNC_SCHEMA_VERSION) return { reason: 'schema_too_new' };
  if (event.schemaVersion < SYNC_SCHEMA_VERSION - 1) return { reason: 'schema_too_old' };
  let wallMs: number;
  try {
    wallMs = parseHlc(event.hlc).wallMs;
  } catch {
    return { reason: 'invalid_hlc' };
  }
  // PostgreSQL text and jsonb cannot hold NUL, and one such event would fail its whole batch forever.
  if (hasNul(event.id) || hasNul(event.entityType) || hasNul(event.entityId))
    return { reason: 'invalid_identifier' };
  let payloadText: string;
  try {
    payloadText = JSON.stringify(event.payload ?? null);
  } catch {
    return { reason: 'invalid_payload' };
  }
  if (payloadText.length > MAX_EVENT_PAYLOAD_CHARS) return { reason: 'payload_too_large' };
  // JSON.stringify writes a NUL inside a string as the six characters backslash-u-0-0-0-0.
  if (payloadText.includes('\\u0000')) return { reason: 'invalid_payload' };
  return { flags: wallMs - nowMs > MAX_SKEW_MS ? ['clock_skew'] : [] };
}

interface FeedEntry {
  cursor: number;
  event: SyncEvent;
  version: number | null;
}

export interface StoredConflict extends ConflictNote {
  tenantId: string;
  at: string;
}

export interface InMemoryStoreOptions {
  now?: () => number;
  masterEntities?: readonly string[];
  priceFields?: Readonly<Record<string, readonly string[]>>;
}

const scopeKey = (a: Pick<DeviceAuth, 'tenantId' | 'branchId'>) => `${a.tenantId}|${a.branchId}`;

/**
 * Reference implementation of the cloud rules with no database: dedupe by event id, epoch fencing,
 * master-data merge, append-only documents, per-entity change feed. Used by the tests and for local
 * development. Not durable: it forgets everything on restart.
 */
export class InMemoryCloudStore implements CloudStore {
  private readonly now: () => number;
  private readonly masterEntities: ReadonlySet<string>;
  private readonly priceFields: Record<string, ReadonlySet<string>>;
  private readonly devices = new Map<string, DeviceAuth & { revoked: boolean }>();
  private readonly epochs = new Map<string, number>();
  private readonly seen = new Map<string, EventResult>();
  private readonly masters = new Map<string, MasterRecord>();
  private readonly documents = new Map<string, SyncEvent>();
  private readonly feeds = new Map<string, FeedEntry[]>();
  readonly conflicts: StoredConflict[] = [];
  /** Event ids accepted with a warning flag (clock skew). */
  readonly flagged = new Map<string, string[]>();
  /** Every event id that was applied exactly once, in arrival order. */
  readonly appliedIds: string[] = [];

  constructor(options: InMemoryStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.masterEntities = new Set(options.masterEntities ?? DEFAULT_MASTER_ENTITIES);
    this.priceFields = Object.fromEntries(
      Object.entries(options.priceFields ?? DEFAULT_PRICE_FIELDS).map(([k, v]) => [k, new Set(v)]),
    );
  }

  /** Test and development helper. A real cloud registers devices through an admin flow. */
  registerDevice(token: string, auth: DeviceAuth): void {
    this.devices.set(token, { ...auth, revoked: false });
  }

  revokeDevice(token: string): void {
    const d = this.devices.get(token);
    if (d) d.revoked = true;
  }

  async authenticate(token: string): Promise<DeviceAuth | null> {
    const d = this.devices.get(token);
    if (!d || d.revoked) return null;
    const { revoked: _revoked, ...auth } = d;
    return auth;
  }

  epochOf(auth: Pick<DeviceAuth, 'tenantId' | 'branchId'>): number {
    return this.epochs.get(scopeKey(auth)) ?? 1;
  }

  master(entityType: string, entityId: string): MasterRecord | undefined {
    return this.masters.get(`${entityType}:${entityId}`);
  }

  document(entityType: string, entityId: string): SyncEvent | undefined {
    return this.documents.get(`${entityType}:${entityId}`);
  }

  /** Number of distinct events held for an entity type (the change feed length). */
  feedLength(tenantId: string, entityType: string): number {
    return this.feeds.get(`${tenantId}|${entityType}`)?.length ?? 0;
  }

  async applyBatch(auth: DeviceAuth, request: PushRequest): Promise<PushResponse> {
    if (request.events.length > MAX_BATCH_EVENTS) {
      return {
        epoch: this.epochOf(auth),
        results: request.events.map((e) => ({
          id: e.id,
          status: 'rejected' as const,
          reason: 'batch_too_large',
        })),
      };
    }
    const key = scopeKey(auth);
    const current = this.epochs.get(key) ?? 1;
    if (request.epoch < current) throw new StaleEpochError(request.epoch, current);
    if (request.epoch > current) this.epochs.set(key, request.epoch);

    const results: EventResult[] = [];
    for (const event of request.events) results.push(this.applyEvent(auth, event));
    return { results, epoch: this.epochOf(auth) };
  }

  private applyEvent(auth: DeviceAuth, event: SyncEvent): EventResult {
    if (this.seen.has(event.id)) return { id: event.id, status: 'duplicate' };
    const checked = validateEvent(auth, event, this.now());
    if ('reason' in checked) return { id: event.id, status: 'rejected', reason: checked.reason };

    let version: number | null = null;
    if (this.masterEntities.has(event.entityType)) {
      const k = `${event.entityType}:${event.entityId}`;
      const outcome = mergeMasterEvent(this.masters.get(k) ?? null, event, {
        headOffice: auth.headOffice,
        priceFields: this.priceFields[event.entityType] ?? new Set(),
      });
      this.masters.set(k, outcome.record);
      version = outcome.record.version;
      const at = new Date(this.now()).toISOString();
      for (const c of outcome.conflicts) this.conflicts.push({ ...c, tenantId: auth.tenantId, at });
    } else {
      // Posted documents and ledger rows are immutable: keep every event, the latest HLC is the current state.
      const k = `${event.entityType}:${event.entityId}`;
      const prev = this.documents.get(k);
      if (!prev || event.hlc > prev.hlc) this.documents.set(k, event);
    }

    const feedKey = `${auth.tenantId}|${event.entityType}`;
    const feed = this.feeds.get(feedKey) ?? [];
    feed.push({ cursor: feed.length + 1, event, version });
    this.feeds.set(feedKey, feed);

    const result: EventResult = {
      id: event.id,
      status: 'applied',
      ...(checked.flags.length ? { flags: checked.flags } : {}),
    };
    this.seen.set(event.id, result);
    this.appliedIds.push(event.id);
    if (checked.flags.length) this.flagged.set(event.id, checked.flags);
    return result;
  }

  async pull(auth: DeviceAuth, request: PullRequest): Promise<PullResponse> {
    const changes: PulledChange[] = [];
    const cursors: Record<string, string> = {};
    let hasMore = false;
    for (const [entityType, after] of Object.entries(request.cursors)) {
      const feed = this.feeds.get(`${auth.tenantId}|${entityType}`) ?? [];
      let cursor = Number.parseInt(after, 10);
      if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
      const master = this.masterEntities.has(entityType);
      let taken = 0;
      for (let i = cursor; i < feed.length; i++) {
        const entry = feed[i] as FeedEntry;
        if (taken >= request.limit) {
          hasMore = true;
          break;
        }
        cursor = entry.cursor;
        if (entry.event.deviceId === auth.deviceId) continue; // never echo a device's own events back
        if (!master && !addressedTo(entry.event, auth.branchId)) continue;
        changes.push({ cursor: String(entry.cursor), version: entry.version, event: entry.event });
        taken += 1;
      }
      cursors[entityType] = String(cursor);
    }
    return { changes, cursors, hasMore, epoch: this.epochOf(auth) };
  }
}

/** Documents are pulled only by the branch that owns them or that they are addressed to (sync-design.md §5). */
function addressedTo(event: SyncEvent, branchId: string): boolean {
  if (event.branchId === branchId) return true;
  const p = event.payload;
  if (typeof p !== 'object' || p === null) return false;
  const { toBranchId, fromBranchId } = p as { toBranchId?: unknown; fromBranchId?: unknown };
  return toBranchId === branchId || fromBranchId === branchId;
}
