import type { PulledChange } from '@mediescare/sync';
import type { DbOrTx } from '../../client';

/** Who is applying the change: the branch that pulled it. */
export interface ApplyEnv {
  tenantId: string;
  branchId: string;
  /** True on the Head Office branch. Head Office wins price-policy fields on conflicts. */
  isHeadOffice: boolean;
}

/** `applied`: written. `skipped`: nothing to do (already newer, or not for this branch). `conflict`: merged with a note. */
export type ApplyOutcome = 'applied' | 'skipped' | 'conflict';

/**
 * Applies ONE pulled event to the local domain tables, inside the caller's transaction.
 * Must be idempotent (the same event can arrive twice) and must never write to sync_outbox: a pulled
 * change is not a local change and must not be pushed back.
 */
export type EntityApplier = (tx: DbOrTx, change: PulledChange, env: ApplyEnv) => ApplyOutcome;

const appliers = new Map<string, EntityApplier>();

/** Register the applier for an entity type (the `entityType` written by recordChange). One per type. */
export function registerApplier(entityType: string, applier: EntityApplier): void {
  if (appliers.has(entityType))
    throw new Error(`An applier for "${entityType}" is already registered`);
  appliers.set(entityType, applier);
}

export function getApplier(entityType: string): EntityApplier | undefined {
  return appliers.get(entityType);
}

/** Entity types this branch knows how to apply. The pull asks the cloud for exactly these. */
export function registeredEntityTypes(): string[] {
  return [...appliers.keys()].sort();
}
