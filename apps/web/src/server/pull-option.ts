import {
  createChangeApplier,
  registeredEntityTypes,
  type Db,
  type WriteContext,
} from '@mediescare/db';

/**
 * The pull side of the sync runner: applies Head Office master data (branches, units, categories,
 * manufacturers, payment modes, suppliers, items) to this branch's database, parents first. The
 * appliers never queue anything for upload. `undefined` until this server is set up (no identity,
 * nothing to apply to). Kept free of other server modules so `sync-runtime.ts` can import it.
 */
export function pullOptionFor(db: Db, auditContext: () => WriteContext | null) {
  const ctx = auditContext();
  if (!ctx) return undefined;
  return {
    entityTypes: registeredEntityTypes(),
    apply: createChangeApplier(db, { clock: ctx.clock }),
    clock: ctx.clock,
  };
}
