import {
  DEFAULT_MASTER_ENTITIES,
  DEFAULT_PRICE_FIELDS,
  MAX_BATCH_EVENTS,
  mergeMasterEvent,
  StaleEpochError,
  validateEvent,
  type CloudStore,
  type ConflictNote,
  type DeviceAuth,
  type EventResult,
  type MasterRecord,
  type PulledChange,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
  type SyncEvent,
  type SyncOp,
} from '@mediescare/sync';
import type { SqlClient, SqlQueryable, SqlRow } from './sql-client';

export interface PostgresCloudStoreOptions {
  sql: SqlClient;
  now?: () => number;
  masterEntities?: readonly string[];
  priceFields?: Readonly<Record<string, readonly string[]>>;
  /** Resolves a bearer token to a device (see CloudAuthService.verifyAccessToken). */
  verifyToken?: (token: string) => Promise<DeviceAuth | null>;
}

interface NewRow {
  n: number;
  event_id: string;
  branch_id: string | null;
  device_id: string;
  entity_type: string;
  entity_id: string;
  op: SyncOp;
  payload: unknown;
  hlc: string;
  schema_version: number;
  client_seq: number;
  version: number | null;
  flags: string | null;
  to_branch_id: string | null;
  from_branch_id: string | null;
}

const headKey = (entityType: string, entityId: string) => `${entityType}\u0000${entityId}`;

/**
 * The cloud rules on PostgreSQL. Behaviour is identical to `InMemoryCloudStore` (both run the same
 * contract suite); the differences are storage and concurrency:
 *
 * - One transaction per push batch. It first takes a per-tenant advisory lock, so `seq` values are
 *   handed out and committed in the same order and a puller can never skip a row (a plain
 *   bigserial would let a slower transaction commit a lower `seq` after a higher one was read).
 *   It then locks the branch's `epochs` row FOR UPDATE, so a fenced device cannot slip a write in.
 * - A batch costs about eight round trips however many events it holds (bulk statements over
 *   `jsonb_to_recordset`), which keeps 500 events well inside a 10 second serverless limit even
 *   when the database is 100 ms away.
 * - Pull reads one entity type at a time in a REPEATABLE READ transaction. The cursor is the last
 *   `seq` handed out; when nothing is left it jumps to the highest `seq` of the type, so a branch
 *   does not rescan its own (skipped) events on every pull.
 */
export class PostgresCloudStore implements CloudStore {
  private readonly sql: SqlClient;
  private readonly now: () => number;
  private readonly masterEntities: ReadonlySet<string>;
  private readonly priceFields: Record<string, ReadonlySet<string>>;

  constructor(private readonly o: PostgresCloudStoreOptions) {
    this.sql = o.sql;
    this.now = o.now ?? Date.now;
    this.masterEntities = new Set(o.masterEntities ?? DEFAULT_MASTER_ENTITIES);
    this.priceFields = Object.fromEntries(
      Object.entries(o.priceFields ?? DEFAULT_PRICE_FIELDS).map(([k, v]) => [k, new Set(v)]),
    );
  }

  authenticate(token: string): Promise<DeviceAuth | null> {
    return this.o.verifyToken ? this.o.verifyToken(token) : Promise.resolve(null);
  }

  async epochOf(auth: Pick<DeviceAuth, 'tenantId' | 'branchId'>): Promise<number> {
    const rows = await this.sql.query<{ epoch: number }>(
      'SELECT epoch FROM epochs WHERE tenant_id = $1 AND branch_id = $2',
      [auth.tenantId, auth.branchId],
    );
    return rows[0]?.epoch ?? 1;
  }

  async applyBatch(auth: DeviceAuth, request: PushRequest): Promise<PushResponse> {
    if (request.events.length > MAX_BATCH_EVENTS) {
      return {
        epoch: await this.epochOf(auth),
        results: request.events.map((e) => ({
          id: e.id,
          status: 'rejected' as const,
          reason: 'batch_too_large',
        })),
      };
    }
    return this.sql.transaction((tx) => this.applyInTransaction(tx, auth, request));
  }

  private async applyInTransaction(
    tx: SqlQueryable,
    auth: DeviceAuth,
    request: PushRequest,
  ): Promise<PushResponse> {
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `mediescare-sync:${auth.tenantId}`,
    ]);
    await tx.query(
      'INSERT INTO epochs (tenant_id, branch_id, epoch) VALUES ($1, $2, 1) ON CONFLICT DO NOTHING',
      [auth.tenantId, auth.branchId],
    );
    const epochRows = await tx.query<{ epoch: number }>(
      'SELECT epoch FROM epochs WHERE tenant_id = $1 AND branch_id = $2 FOR UPDATE',
      [auth.tenantId, auth.branchId],
    );
    const current = epochRows[0]?.epoch ?? 1;
    if (request.epoch < current) throw new StaleEpochError(request.epoch, current);
    if (request.epoch > current) {
      await tx.query(
        'UPDATE epochs SET epoch = $3, updated_at = now() WHERE tenant_id = $1 AND branch_id = $2',
        [auth.tenantId, auth.branchId, request.epoch],
      );
    }
    const epoch = Math.max(current, request.epoch);
    const events = request.events;
    if (events.length === 0) return { results: [], epoch };

    // Events this tenant already holds.
    const existing = new Set(
      (
        await tx.query<{ event_id: string }>(
          `SELECT event_id FROM sync_events
            WHERE tenant_id = $1
              AND event_id IN (SELECT jsonb_array_elements_text($2::text::jsonb))`,
          [auth.tenantId, JSON.stringify(events.map((e) => e.id))],
        )
      ).map((r) => r.event_id),
    );

    // Current merged state of every master entity the batch touches.
    const heads = new Map<string, MasterRecord>();
    const wanted = events
      .filter((e) => this.masterEntities.has(e.entityType) && !existing.has(e.id))
      .map((e) => ({ t: e.entityType, i: e.entityId }));
    if (wanted.length > 0) {
      const rows = await tx.query<{ entity_type: string; entity_id: string; record: MasterRecord }>(
        `SELECT h.entity_type, h.entity_id, h.record
           FROM entity_heads h
           JOIN (SELECT DISTINCT x.t, x.i FROM jsonb_to_recordset($2::text::jsonb) AS x(t text, i text)) w
             ON w.t = h.entity_type AND w.i = h.entity_id
          WHERE h.tenant_id = $1`,
        [auth.tenantId, JSON.stringify(wanted)],
      );
      for (const r of rows) heads.set(headKey(r.entity_type, r.entity_id), r.record);
    }

    const nowMs = this.now();
    const results: EventResult[] = [];
    const inserts: NewRow[] = [];
    const conflicts: ConflictNote[] = [];
    const dirty = new Set<string>();
    const seenInBatch = new Set<string>();

    for (const event of events) {
      if (existing.has(event.id) || seenInBatch.has(event.id)) {
        results.push({ id: event.id, status: 'duplicate' });
        continue;
      }
      const checked = validateEvent(auth, event, nowMs);
      if ('reason' in checked) {
        results.push({ id: event.id, status: 'rejected', reason: checked.reason });
        continue;
      }
      let version: number | null = null;
      if (this.masterEntities.has(event.entityType)) {
        const key = headKey(event.entityType, event.entityId);
        const outcome = mergeMasterEvent(heads.get(key) ?? null, event, {
          headOffice: auth.headOffice,
          priceFields: this.priceFields[event.entityType] ?? new Set(),
        });
        heads.set(key, outcome.record);
        dirty.add(key);
        version = outcome.record.version;
        for (const c of outcome.conflicts) conflicts.push(c);
      }
      seenInBatch.add(event.id);
      inserts.push(toRow(inserts.length, event, version, checked.flags));
      results.push({
        id: event.id,
        status: 'applied',
        ...(checked.flags.length ? { flags: checked.flags } : {}),
      });
    }

    if (inserts.length > 0) {
      const inserted = await tx.query<{ event_id: string }>(
        `INSERT INTO sync_events
           (event_id, tenant_id, branch_id, device_id, entity_type, entity_id, op, payload, hlc,
            schema_version, client_seq, epoch, version, flags, to_branch_id, from_branch_id)
         SELECT x.event_id, $1, x.branch_id, x.device_id, x.entity_type, x.entity_id, x.op,
                COALESCE(x.payload, 'null'::jsonb), x.hlc, x.schema_version, x.client_seq, $3,
                x.version, x.flags, x.to_branch_id, x.from_branch_id
           FROM jsonb_to_recordset($2::text::jsonb) AS x(
                  n integer, event_id text, branch_id text, device_id text, entity_type text,
                  entity_id text, op text, payload jsonb, hlc text, schema_version integer,
                  client_seq bigint, version integer, flags text, to_branch_id text,
                  from_branch_id text)
          ORDER BY x.n
         ON CONFLICT (tenant_id, event_id) DO NOTHING
         RETURNING event_id`,
        [auth.tenantId, JSON.stringify(inserts), epoch],
      );
      if (inserted.length !== inserts.length) {
        // Cannot happen while the tenant lock is held; fail the whole batch rather than lie.
        throw new Error('Concurrent write detected while applying a sync batch');
      }
    }

    if (dirty.size > 0) {
      const rows = [...dirty].map((key) => {
        const record = heads.get(key) as MasterRecord;
        return { t: record.entityType, i: record.entityId, v: record.version, r: record };
      });
      await tx.query(
        `INSERT INTO entity_heads (tenant_id, entity_type, entity_id, version, record, updated_at)
         SELECT $1, x.t, x.i, x.v, x.r, now()
           FROM jsonb_to_recordset($2::text::jsonb) AS x(t text, i text, v integer, r jsonb)
         ON CONFLICT (tenant_id, entity_type, entity_id)
         DO UPDATE SET version = EXCLUDED.version, record = EXCLUDED.record, updated_at = now()`,
        [auth.tenantId, JSON.stringify(rows)],
      );
    }

    if (conflicts.length > 0) {
      await tx.query(
        `INSERT INTO sync_conflicts (tenant_id, entity_type, entity_id, field, reason, winner, loser)
         SELECT $1, x.entity_type, x.entity_id, x.field, x.reason, x.winner, x.loser
           FROM jsonb_to_recordset($2::text::jsonb)
                AS x(entity_type text, entity_id text, field text, reason text, winner jsonb, loser jsonb)`,
        [
          auth.tenantId,
          JSON.stringify(
            conflicts.map((c) => ({
              entity_type: c.entityType,
              entity_id: c.entityId,
              field: c.field,
              reason: c.reason,
              winner: c.winner,
              loser: c.loser,
            })),
          ),
        ],
      );
    }

    await tx.query(
      `INSERT INTO push_batches (tenant_id, branch_id, idempotency_key, event_count)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, branch_id, idempotency_key)
       DO UPDATE SET attempts = push_batches.attempts + 1, last_seen_at = now()`,
      [auth.tenantId, auth.branchId, request.idempotencyKey, events.length],
    );
    return { results, epoch };
  }

  async pull(auth: DeviceAuth, request: PullRequest): Promise<PullResponse> {
    const limit = Math.max(1, Math.floor(Number(request.limit)) || 1);
    return this.sql.transaction(async (tx) => {
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const changes: PulledChange[] = [];
      const cursors: Record<string, string> = {};
      let hasMore = false;
      for (const [entityType, after] of Object.entries(request.cursors)) {
        let cursor = Number.parseInt(after, 10);
        if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;
        const master = this.masterEntities.has(entityType);
        const rows = await tx.query<SqlRow>(
          `SELECT seq::text AS seq, event_id, tenant_id, branch_id, device_id, entity_type, entity_id,
                  op, payload, hlc, schema_version, client_seq::text AS client_seq, version
             FROM sync_events
            WHERE tenant_id = $1 AND entity_type = $2 AND seq > $3 AND device_id <> $4
              ${master ? '' : 'AND (branch_id = $5 OR to_branch_id = $5 OR from_branch_id = $5)'}
            ORDER BY seq
            LIMIT ${limit + 1}`,
          master
            ? [auth.tenantId, entityType, cursor, auth.deviceId]
            : [auth.tenantId, entityType, cursor, auth.deviceId, auth.branchId],
        );
        const page = rows.slice(0, limit);
        if (rows.length > limit) {
          hasMore = true;
          cursor = Number(page[page.length - 1]?.seq);
        } else {
          const hi = await tx.query<{ hi: string }>(
            `SELECT COALESCE(MAX(seq), 0)::text AS hi FROM sync_events
              WHERE tenant_id = $1 AND entity_type = $2`,
            [auth.tenantId, entityType],
          );
          cursor = Math.max(cursor, Number(hi[0]?.hi ?? 0));
        }
        for (const r of page) changes.push(toChange(r));
        cursors[entityType] = String(cursor);
      }
      const epochRows = await tx.query<{ epoch: number }>(
        'SELECT epoch FROM epochs WHERE tenant_id = $1 AND branch_id = $2',
        [auth.tenantId, auth.branchId],
      );
      return { changes, cursors, hasMore, epoch: epochRows[0]?.epoch ?? 1 };
    });
  }
}

function toRow(n: number, e: SyncEvent, version: number | null, flags: string[]): NewRow {
  const p =
    typeof e.payload === 'object' && e.payload !== null
      ? (e.payload as Record<string, unknown>)
      : {};
  const text = (v: unknown) =>
    typeof v === 'string' && v.length <= 200 && !v.includes('\u0000') ? v : null;
  return {
    n,
    event_id: e.id,
    branch_id: e.branchId,
    device_id: e.deviceId,
    entity_type: e.entityType,
    entity_id: e.entityId,
    op: e.op,
    payload: e.payload ?? null,
    hlc: e.hlc,
    schema_version: e.schemaVersion,
    client_seq: e.seq,
    version,
    flags: flags.length ? flags.join(',') : null,
    to_branch_id: text(p.toBranchId),
    from_branch_id: text(p.fromBranchId),
  };
}

function toChange(r: SqlRow): PulledChange {
  return {
    cursor: String(r.seq),
    version: r.version === null || r.version === undefined ? null : Number(r.version),
    event: {
      id: String(r.event_id),
      seq: Number(r.client_seq),
      entityType: String(r.entity_type),
      entityId: String(r.entity_id),
      op: r.op as SyncOp,
      payload: r.payload,
      hlc: String(r.hlc),
      deviceId: String(r.device_id),
      branchId: r.branch_id === null ? null : String(r.branch_id),
      tenantId: String(r.tenant_id),
      schemaVersion: Number(r.schema_version),
    },
  };
}
