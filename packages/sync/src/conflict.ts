import type { SyncEvent } from './outbox';

/**
 * Master-data merge (sync-design.md §6). Pure and order-independent for concurrent edits, so any
 * cloud store (in memory, Postgres) applies the same rules.
 *
 * - A field is a unit of conflict: two branches editing different fields of one item both win.
 * - An update whose `baseVersion` equals the stored version is a clean fast-forward: the editor saw
 *   the latest state, so it wins without a conflict record.
 * - Otherwise each field is last-writer-wins by HLC, and the losing value is kept in a conflict note.
 * - Price-policy fields: Head Office wins over a branch whatever the clocks say.
 */

export interface FieldMeta {
  hlc: string;
  /** True if the value was written by Head Office. */
  headOffice: boolean;
  /** Event that wrote the value, kept so a conflict note can name both sides. */
  eventId: string;
}

export interface MasterRecord {
  entityType: string;
  entityId: string;
  fields: Record<string, unknown>;
  meta: Record<string, FieldMeta>;
  /** Cloud version: +1 for every accepted change. Branches send it back as `baseVersion`. */
  version: number;
  voided: boolean;
  /** Highest HLC applied so far. */
  hlc: string;
}

export type ConflictReason = 'last_writer_wins' | 'head_office_wins';

export interface ConflictNote {
  entityType: string;
  entityId: string;
  field: string;
  reason: ConflictReason;
  winner: { eventHlc: string; value: unknown; headOffice: boolean };
  loser: { eventHlc: string; value: unknown; headOffice: boolean; eventId: string | null };
}

export interface MergeContext {
  /** True if the sending device belongs to the Head Office branch. */
  headOffice: boolean;
  /** Fields of this entity type that Head Office owns (retail price, tax class, discount caps). */
  priceFields: ReadonlySet<string>;
}

export interface MergeOutcome {
  record: MasterRecord;
  conflicts: ConflictNote[];
  /** False if the event changed nothing (every field lost or was already equal). */
  changed: boolean;
}

/** Keys of a payload that describe the row, not a business field. */
const ROW_KEYS = new Set([
  'id',
  'tenantId',
  'createdAt',
  'updatedAt',
  'hlc',
  'version',
  'baseVersion',
]);

export function payloadFields(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {};
  return Object.fromEntries(Object.entries(payload).filter(([k]) => !ROW_KEYS.has(k)));
}

function baseVersionOf(payload: unknown): number | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const v = (payload as { baseVersion?: unknown }).baseVersion;
  return typeof v === 'number' && Number.isInteger(v) ? v : null;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function mergeMasterEvent(
  current: MasterRecord | null,
  event: SyncEvent,
  ctx: MergeContext,
): MergeOutcome {
  const base: MasterRecord = current
    ? { ...current, fields: { ...current.fields }, meta: { ...current.meta } }
    : {
        entityType: event.entityType,
        entityId: event.entityId,
        fields: {},
        meta: {},
        version: 0,
        voided: false,
        hlc: event.hlc,
      };
  const conflicts: ConflictNote[] = [];
  let changed = false;

  if (event.op === 'void') {
    if (!base.voided) {
      base.voided = true;
      changed = true;
    }
  } else {
    const fastForward =
      current !== null && event.op === 'update' && baseVersionOf(event.payload) === current.version;
    for (const [field, value] of Object.entries(payloadFields(event.payload))) {
      const meta = base.meta[field];
      const isPrice = ctx.priceFields.has(field);
      let wins: boolean;
      let reason: ConflictReason = 'last_writer_wins';
      if (!meta) {
        wins = true;
      } else if (isPrice) {
        wins = ctx.headOffice
          ? !meta.headOffice || event.hlc > meta.hlc
          : !meta.headOffice && event.hlc > meta.hlc;
        if (!wins && meta.headOffice && !ctx.headOffice) reason = 'head_office_wins';
      } else {
        wins = fastForward || event.hlc > meta.hlc;
      }
      if (wins) {
        if (meta && !same(base.fields[field], value) && !fastForward) {
          conflicts.push({
            entityType: event.entityType,
            entityId: event.entityId,
            field,
            reason,
            winner: { eventHlc: event.hlc, value, headOffice: ctx.headOffice },
            loser: {
              eventHlc: meta.hlc,
              value: base.fields[field],
              headOffice: meta.headOffice,
              eventId: meta.eventId,
            },
          });
        }
        if (!same(base.fields[field], value) || !meta) changed = true;
        base.fields[field] = value;
        base.meta[field] = { hlc: event.hlc, headOffice: ctx.headOffice, eventId: event.id };
      } else if (meta && !same(base.fields[field], value)) {
        conflicts.push({
          entityType: event.entityType,
          entityId: event.entityId,
          field,
          reason,
          winner: { eventHlc: meta.hlc, value: base.fields[field], headOffice: meta.headOffice },
          loser: { eventHlc: event.hlc, value, headOffice: ctx.headOffice, eventId: event.id },
        });
      }
    }
    if (current === null) changed = true;
  }

  if (changed) {
    base.version = (current?.version ?? 0) + 1;
    if (event.hlc > base.hlc) base.hlc = event.hlc;
  }
  return { record: base, conflicts, changed };
}
