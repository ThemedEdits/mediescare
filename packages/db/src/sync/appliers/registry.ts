import type { PulledChange } from '@mediescare/sync';
import type { DbOrTx } from '../../client';

/** Who is applying the change: the branch that pulled it. */
export interface ApplyEnv {
  tenantId: string;
  branchId: string;
  /** True on the Head Office branch. Head Office wins price-policy fields on conflicts. */
  isHeadOffice: boolean;
  /**
   * Scratch space that lives for ONE pulled batch (one transaction). Appliers may memoise positive
   * lookups here (for example "this unit exists"). Never put anything in it that a later event of the
   * same batch could invalidate.
   */
  cache?: Map<string, unknown>;
}

/** `applied`: written. `skipped`: nothing to do (already newer, or not for this branch). `conflict`: merged with a note. */
export type ApplyOutcome = 'applied' | 'skipped' | 'conflict';

/** One field where the local value and the pulled value disagreed, and which side was kept. */
export interface FieldConflictNote {
  field: string;
  reason: 'last_writer_wins' | 'head_office_wins' | 'branch_local_field' | 'unique_key_taken';
  kept: unknown;
  discarded: unknown;
}

/**
 * Richer result of an applier. A plain `ApplyOutcome` string is still accepted (older appliers).
 * The change applier turns this into audit entries (`sync.apply`): inserts are summarised per batch,
 * updates and conflicts are audited one by one with old and new values.
 */
export interface ApplyDetail {
  outcome: ApplyOutcome;
  /** The row did not exist locally and was created. */
  created?: boolean;
  /** Changed fields before and after (updates). */
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  conflicts?: FieldConflictNote[];
}

/**
 * Applies ONE pulled event to the local domain tables, inside the caller's transaction.
 * Must be idempotent (the same event can arrive twice) and must never write to sync_outbox: a pulled
 * change is not a local change and must not be pushed back.
 *
 * An applier that cannot apply an event yet because a row it points to has not arrived throws
 * `DependencyMissing` BEFORE writing anything. (Nothing wraps an event in a savepoint, for speed; an
 * event that is retried later simply runs again, which idempotency makes safe.)
 */
export type EntityApplier = (
  tx: DbOrTx,
  change: PulledChange,
  env: ApplyEnv,
) => ApplyOutcome | ApplyDetail;

/**
 * Thrown by an applier when a parent row is missing locally. The change applier stops that entity
 * type at this event (the cursor does not pass it) and the runner retries on its next cycle, by
 * which time the parent has usually been pulled. Other entity types in the same page carry on.
 */
export class DependencyMissing extends Error {
  constructor(
    readonly dependsOnType: string,
    readonly dependsOnId: string,
  ) {
    super(`Waiting for ${dependsOnType} ${dependsOnId}`);
    this.name = 'DependencyMissing';
  }
}

export interface RegisterOptions {
  /**
   * Priority: lower numbers are pulled and applied first, so parents arrive before children.
   * Default 100. See `APPLY_ORDER` for the agreed scale.
   */
  order?: number;
}

/** Agreed priority scale. Appliers of new entity types pick the value that fits their parents. */
export const APPLY_ORDER = {
  branches: 10,
  lookups: 20, // units, categories, manufacturers, payment modes
  parties: 30, // suppliers
  items: 40,
  documents: 90, // transfers and other documents that point at items and branches
  default: 100,
} as const;

const appliers = new Map<string, EntityApplier>();
const orders = new Map<string, number>();

/** Register the applier for an entity type (the `entityType` written by recordChange). One per type. */
export function registerApplier(
  entityType: string,
  applier: EntityApplier,
  options: RegisterOptions = {},
): void {
  if (appliers.has(entityType))
    throw new Error(`An applier for "${entityType}" is already registered`);
  appliers.set(entityType, applier);
  orders.set(entityType, options.order ?? APPLY_ORDER.default);
}

export function getApplier(entityType: string): EntityApplier | undefined {
  return appliers.get(entityType);
}

/** Priority of an entity type (lower = earlier). Unknown types sort last. */
export function applyOrderOf(entityType: string): number {
  return orders.get(entityType) ?? APPLY_ORDER.default;
}

/** Entity types this branch knows how to apply, parents first. The pull asks the cloud for exactly these. */
export function registeredEntityTypes(): string[] {
  return [...appliers.keys()].sort(
    (a, b) => applyOrderOf(a) - applyOrderOf(b) || (a < b ? -1 : a > b ? 1 : 0),
  );
}
