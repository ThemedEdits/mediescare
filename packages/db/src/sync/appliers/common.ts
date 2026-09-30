import { and, eq, ne } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { parseHlc, type PulledChange } from '@mediescare/sync';
import type { DbOrTx } from '../../client';
import { branches } from '../../schema/sqlite';
import {
  DependencyMissing,
  type ApplyDetail,
  type ApplyEnv,
  type EntityApplier,
  type FieldConflictNote,
} from './registry';

/** Column kinds an incoming payload is checked against. Anything that does not match is dropped. */
export type FieldKind = 's' | 'sn' | 'i' | 'b';
export type FieldSpec = Readonly<Record<string, FieldKind>>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function valid(kind: FieldKind, v: unknown): boolean {
  switch (kind) {
    case 's':
      return typeof v === 'string';
    case 'sn':
      return typeof v === 'string' || v === null;
    case 'i':
      return typeof v === 'number' && Number.isSafeInteger(v);
    case 'b':
      return typeof v === 'boolean';
  }
}

/** The payload as a plain object whose `id` matches the event, or null for a malformed event. */
export function payloadOf(change: PulledChange): Record<string, unknown> | null {
  const p = change.event.payload;
  if (!isRecord(p)) return null;
  if (p.id !== undefined && p.id !== change.event.entityId) return null;
  return p;
}

/** Only the listed fields that are present and of the right type. Unknown keys are ignored. */
export function readFields(p: Record<string, unknown>, spec: FieldSpec): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(spec))
    if (field in p && valid(kind, p[field])) out[field] = p[field];
  return out;
}

const same = (a: unknown, b: unknown): boolean => a === b;

/** Wall-clock time of an HLC as ISO text: deterministic `updatedAt` for a pulled change. */
export function isoOfHlc(hlc: string): string {
  try {
    return new Date(parseHlc(hlc).wallMs).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

/**
 * Did this event come from Head Office? Decided from the local `branches` table. An origin branch
 * this server does not know is treated as a normal branch (its price changes are ignored), never as
 * a reason to stall the pull.
 */
export function fromHeadOffice(tx: DbOrTx, env: ApplyEnv, change: PulledChange): boolean {
  const branchId = change.event.branchId;
  if (!branchId) return false;
  const key = `ho:${branchId}`;
  const cached = env.cache?.get(key);
  if (typeof cached === 'boolean') return cached;
  const row = tx
    .select({ isHeadOffice: branches.isHeadOffice })
    .from(branches)
    .where(eq(branches.id, branchId))
    .get();
  const answer = row?.isHeadOffice ?? false;
  env.cache?.set(key, answer);
  return answer;
}

/** Throws `DependencyMissing` unless the row exists. Positive answers are memoised for the batch. */
export function requireRow(
  tx: DbOrTx,
  env: ApplyEnv,
  table: SQLiteTable & { id: SQLiteColumn },
  type: string,
  id: string,
): void {
  const key = `have:${type}:${id}`;
  if (env.cache?.get(key) === true) return;
  const row = tx.select({ id: table.id }).from(table).where(eq(table.id, id)).get();
  if (!row) throw new DependencyMissing(type, id);
  env.cache?.set(key, true);
}

export interface MergeRules {
  /** Head Office owns these: applied only from a Head Office event, whatever the clocks say. */
  price?: readonly string[];
  /** Set when the row is created, never overwritten afterwards (the branch decides its own value). */
  branchLocal?: readonly string[];
}

export interface MergeResult {
  set: Record<string, unknown>;
  old: Record<string, unknown>;
  conflicts: FieldConflictNote[];
}

/**
 * Per-field merge of a pulled update into the local row (conflict.ts rules, applied at the branch).
 * The local row only has one HLC for the whole row, so "last writer wins" compares the event with it.
 */
export function mergeFields(
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
  eventHlc: string,
  rowHlc: string,
  originIsHeadOffice: boolean,
  rules: MergeRules,
): MergeResult {
  const out: MergeResult = { set: {}, old: {}, conflicts: [] };
  const price = new Set(rules.price ?? []);
  const local = new Set(rules.branchLocal ?? []);
  const sameWriter = deviceOfHlc(eventHlc) === deviceOfHlc(rowHlc);
  for (const [field, value] of Object.entries(incoming)) {
    const now = current[field];
    if (same(now, value) || local.has(field)) continue;
    // An older event from the device that wrote the row last is a stale or re-ordered copy: drop it quietly.
    const stale = sameWriter && eventHlc <= rowHlc;
    if (price.has(field)) {
      if (originIsHeadOffice) {
        // Head Office wins whatever the clocks say, but never goes back to its own older price.
        if (stale) continue;
        out.set[field] = value;
        out.old[field] = now;
      } else {
        out.conflicts.push({ field, reason: 'head_office_wins', kept: now, discarded: value });
      }
    } else if (eventHlc > rowHlc) {
      out.set[field] = value;
      out.old[field] = now;
    } else if (!stale) {
      out.conflicts.push({ field, reason: 'last_writer_wins', kept: now, discarded: value });
    }
  }
  return out;
}

/** Result shape shared by the appliers: what happened, with audit material. */
export function resultOf(
  merge: MergeResult | null,
  created: boolean,
  extraConflicts: FieldConflictNote[] = [],
): ApplyDetail {
  const conflicts = [...(merge?.conflicts ?? []), ...extraConflicts];
  const changed = created || Object.keys(merge?.set ?? {}).length > 0;
  return {
    outcome: conflicts.length > 0 ? 'conflict' : changed ? 'applied' : 'skipped',
    created,
    ...(merge && !created && changed ? { oldValue: merge.old, newValue: merge.set } : {}),
    ...(conflicts.length ? { conflicts } : {}),
  };
}

/** Tables the generic applier can write: they all have `id` and `tenant_id`. */
export type RowTable = SQLiteTable & { id: SQLiteColumn; tenantId: SQLiteColumn };

export interface SimpleMasterConfig {
  table: RowTable;
  /** Business fields of the row (not id, tenant or the sync columns). */
  spec: FieldSpec;
  /** Fields without which the row cannot be created (others fall back to the column default). */
  required: readonly string[];
  rules?: MergeRules;
  /** A column that must stay unique per tenant, for example `code`. */
  naturalKey?: { field: string; column: SQLiteColumn };
  /** Last chance to adjust a new row (for example a value that must not travel between branches). */
  onInsert?: (tx: DbOrTx, row: Record<string, unknown>, env: ApplyEnv) => void;
  /** Soft-delete: what a `void` event sets (none = voids are ignored). */
  voidSet?: Record<string, unknown>;
  /** Fields that may only change by an insert (never by an update event). */
  immutable?: readonly string[];
}

/**
 * Applier for a plain master table (units, categories, manufacturers, payment modes, suppliers,
 * branches): upsert by id with the per-field merge above. Never writes the outbox.
 */
export function simpleMasterApplier(cfg: SimpleMasterConfig): EntityApplier {
  const { table } = cfg;
  return (tx, change, env) => {
    const { event } = change;
    const payload = payloadOf(change);
    if (!payload) return 'skipped';
    const id = event.entityId;
    const current = tx.select().from(table).where(eq(table.id, id)).get() as
      Record<string, unknown> | undefined;
    const originHo = fromHeadOffice(tx, env, change);
    const wall = isoOfHlc(event.hlc);

    if (event.op === 'void') {
      if (!current || !cfg.voidSet) return 'skipped';
      const merge = mergeFields(current, cfg.voidSet, event.hlc, String(current.hlc), originHo, {});
      if (Object.keys(merge.set).length === 0) return resultOf(merge, false);
      tx.update(table)
        .set({
          ...merge.set,
          hlc: maxHlc(event.hlc, String(current.hlc)),
          updatedAt: wall,
        } as never)
        .where(eq(table.id, id))
        .run();
      return resultOf(merge, false);
    }

    const incoming = readFields(payload, cfg.spec);
    const keyConflict = (() => {
      const nk = cfg.naturalKey;
      if (!nk || !(nk.field in incoming)) return null;
      const taken = tx
        .select({ id: table.id })
        .from(table)
        .where(
          and(
            eq(table.tenantId, env.tenantId),
            eq(nk.column, incoming[nk.field] as string),
            ne(table.id, id),
          ),
        )
        .get();
      return taken ? nk.field : null;
    })();

    if (!current) {
      if (keyConflict)
        return {
          outcome: 'conflict',
          conflicts: [
            {
              field: keyConflict,
              reason: 'unique_key_taken',
              kept: null,
              discarded: incoming[keyConflict],
            },
          ],
        };
      if (cfg.required.some((f) => !(f in incoming))) return 'skipped'; // malformed: never block the pull on it
      const row: Record<string, unknown> = {
        ...incoming,
        id,
        tenantId: env.tenantId,
        createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : wall,
        updatedAt: wall,
        hlc: event.hlc,
        version: 1,
      };
      cfg.onInsert?.(tx, row, env);
      tx.insert(table)
        .values(row as never)
        .run();
      return resultOf(null, true);
    }

    const extra: FieldConflictNote[] = [];
    if (keyConflict) {
      extra.push({
        field: keyConflict,
        reason: 'unique_key_taken',
        kept: current[keyConflict],
        discarded: incoming[keyConflict],
      });
      delete incoming[keyConflict];
    }
    const merge = mergeFields(current, incoming, event.hlc, String(current.hlc), originHo, {
      ...cfg.rules,
      // Fields that only an insert may set behave like branch-local ones afterwards.
      branchLocal: [...(cfg.rules?.branchLocal ?? []), ...(cfg.immutable ?? [])],
    });
    if (Object.keys(merge.set).length > 0) {
      tx.update(table)
        .set({
          ...merge.set,
          hlc: maxHlc(event.hlc, String(current.hlc)),
          updatedAt: wall,
          version: Number(current.version) + 1,
        } as never)
        .where(eq(table.id, id))
        .run();
    }
    return resultOf(merge, false, extra);
  };
}

/** Device part of an HLC (who wrote it). Empty when the text is not a valid HLC. */
export function deviceOfHlc(hlc: string): string {
  try {
    return parseHlc(hlc).device;
  } catch {
    return '';
  }
}

export function maxHlc(a: string, b: string): string {
  return a > b ? a : b;
}
