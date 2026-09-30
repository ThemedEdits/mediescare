import { eq } from 'drizzle-orm';
import type { HybridLogicalClock, PulledChange } from '@mediescare/sync';
import { appendAudit } from '../../audit';
import type { Db } from '../../client';
import type { WriteContext } from '../../context';
import { getServerIdentity } from '../../identity';
import { branches } from '../../schema/sqlite';
import type { ApplyReport, ChangeApplier } from '../pull';
import {
  applyOrderOf,
  DependencyMissing,
  getApplier,
  type ApplyDetail,
  type ApplyEnv,
  type ApplyOutcome,
} from './registry';

export interface ChangeApplierEnv {
  /** The clock this server writes with: audit rows of pulled changes are stamped with it. */
  clock: HybridLogicalClock;
  now?: () => Date;
}

/** Normalises the two shapes an applier may return. */
function detailOf(result: ApplyOutcome | ApplyDetail): ApplyDetail {
  return typeof result === 'string' ? { outcome: result } : result;
}

/**
 * The `ChangeApplier` that `pullChanges` expects. One call applies one pulled page in ONE
 * transaction with the registered per-entity appliers:
 *
 * - Events are applied parents first (entity type priority), then in HLC (causal) order.
 * - An applier that throws `DependencyMissing` only loses its own event: that entity type stops there
 *   for this page (reported as `blocked`, so its cursor does not advance past it) while the other types
 *   carry on. Appliers check their parents before writing, and are idempotent anyway, so the retry
 *   of such an event is always safe (no savepoint per event: it costs about a third of the speed).
 * - Any other error rolls the whole page back, nothing is recorded, the runner reports it and retries.
 * - An event id is applied at most once per page, and the appliers are idempotent, so a page that is
 *   delivered again after a crash between apply and cursor save changes nothing.
 * - Nothing here writes `sync_outbox`: a pulled change is never pushed back.
 * - Audit: inserts are summarised per entity type (`sync.apply`), updates and conflicts are audited
 *   one by one with old and new values. The audit chain stays valid (same chain, same transaction).
 */
export function createChangeApplier(db: Db, env: ChangeApplierEnv): ChangeApplier {
  return (changes: PulledChange[]): ApplyReport => {
    const identity = getServerIdentity(db);
    if (!identity) throw new Error('This server is not set up yet, so it cannot apply changes');
    const branch = db
      .select({ isHeadOffice: branches.isHeadOffice })
      .from(branches)
      .where(eq(branches.id, identity.branchId))
      .get();
    const applyEnv: ApplyEnv = {
      tenantId: identity.tenantId,
      branchId: identity.branchId,
      isHeadOffice: branch?.isHeadOffice ?? false,
      cache: new Map(),
    };
    const ctx: WriteContext = { ...identity, userId: null, clock: env.clock, now: env.now };

    const ordered = [...changes].sort(
      (a, b) =>
        applyOrderOf(a.event.entityType) - applyOrderOf(b.event.entityType) ||
        // HLC order is causal order: a batch the network delivered reversed is put right again.
        (a.event.hlc < b.event.hlc ? -1 : a.event.hlc > b.event.hlc ? 1 : 0) ||
        Number(a.cursor) - Number(b.cursor),
    );

    const report = {
      applied: 0,
      skipped: 0,
      conflicts: 0,
      handled: new Set<string>(),
      blocked: {} as Record<string, string>,
    };
    const createdByType = new Map<string, number>();

    db.transaction((tx) => {
      for (const change of ordered) {
        const { event } = change;
        if (report.blocked[event.entityType] !== undefined) continue; // stop this type at the blocked event
        if (report.handled.has(event.id)) continue; // duplicate inside one page

        if (event.tenantId !== identity.tenantId || event.deviceId === identity.deviceId) {
          report.handled.add(event.id); // another organisation, or our own echo: nothing to apply
          report.skipped += 1;
          continue;
        }
        const applier = getApplier(event.entityType);
        if (!applier) {
          report.handled.add(event.id);
          report.skipped += 1;
          continue;
        }

        let detail: ApplyDetail;
        try {
          detail = detailOf(applier(tx, change, applyEnv));
        } catch (error) {
          if (error instanceof DependencyMissing) {
            report.blocked[event.entityType] = error.message;
            continue;
          }
          throw error;
        }

        report.handled.add(event.id);
        const hasConflicts = (detail.conflicts?.length ?? 0) > 0;
        const wrote =
          detail.created === true ||
          detail.outcome === 'applied' ||
          Object.keys(detail.newValue ?? {}).length > 0;
        if (wrote) report.applied += 1;
        else if (!hasConflicts) report.skipped += 1;
        if (hasConflicts) report.conflicts += 1;

        // New rows are summarised per entity type; a change to an existing row and every conflict is audited alone.
        if (detail.created || (wrote && !detail.oldValue && !hasConflicts)) {
          createdByType.set(event.entityType, (createdByType.get(event.entityType) ?? 0) + 1);
        }
        if (hasConflicts || (wrote && detail.oldValue && !detail.created)) {
          appendAudit(tx, ctx, {
            action: 'sync.apply',
            entityType: event.entityType,
            entityId: event.entityId,
            oldValue: detail.oldValue,
            newValue: {
              ...detail.newValue,
              ...(hasConflicts ? { conflicts: detail.conflicts } : {}),
              fromBranchId: event.branchId,
              eventId: event.id,
            },
          });
        }
      }
      for (const [entityType, n] of createdByType) {
        appendAudit(tx, ctx, {
          action: 'sync.apply',
          entityType,
          newValue: { created: n, source: 'pull' },
        });
      }
    });
    return report;
  };
}
