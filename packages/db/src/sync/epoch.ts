import { eq, max, sql } from 'drizzle-orm';
import { afterFailover } from '@mediescare/core';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { getServerIdentity } from '../identity';
import { recordChange } from '../outbox';
import { devices, docCounters, syncEpochs } from '../schema/sqlite-all';

/**
 * The durable server epoch of this branch (ADR-0004). Epoch 1 is implicit; every promotion adds a
 * row. Sent with every sync push so the cloud can fence a returning old primary.
 */
export function getServerEpoch(db: DbOrTx): number {
  const identity = getServerIdentity(db as Db);
  if (!identity) return 1;
  const row = db
    .select({ epoch: max(syncEpochs.epoch) })
    .from(syncEpochs)
    .where(eq(syncEpochs.branchId, identity.branchId))
    .get();
  return row?.epoch ?? 1;
}

export interface PromoteInput {
  /** Why the promotion happened, for the audit trail (for example "old server PC failed"). */
  reason: string;
  /**
   * Device that becomes the branch server. Defaults to the current server device (restore of a
   * backup on a new PC, or a re-promotion after repair). A different id turns that device into
   * the server and the previous server into a standby (fenced).
   */
  deviceId?: string;
}

export interface PromoteResult {
  epoch: number;
  previousEpoch: number;
  deviceId: string;
  countersAdvanced: number;
}

/**
 * Manual promotion: bump the epoch, move every document counter past the last known number plus
 * the failover gap (so numbers never repeat, ADR-0004), and record who did it. One transaction.
 * The caller must have verified that the old primary is unreachable (UI confirmation).
 */
export function promote(db: Db, ctx: WriteContext, input: PromoteInput): PromoteResult {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error('A reason is required to promote this server');
  return db.transaction((tx) => {
    const identity = getServerIdentity(tx as unknown as Db);
    if (!identity) throw new Error('This server has not been set up yet');
    const target = input.deviceId ?? identity.deviceId;
    const targetRow = tx.select().from(devices).where(eq(devices.id, target)).get();
    if (!targetRow || targetRow.revokedAt) throw new Error('Unknown or revoked device');
    if (targetRow.branchId !== identity.branchId)
      throw new Error('The device belongs to another branch');

    const previousEpoch = getServerEpoch(tx);
    const epoch = previousEpoch + 1;
    const now = isoNow(ctx);
    const hlc = ctx.clock.tick();

    if (target !== identity.deviceId) {
      for (const [id, role] of [
        [identity.deviceId, 'standby'],
        [target, 'server'],
      ] as const) {
        tx.update(devices)
          .set({ role, updatedAt: now, hlc, version: sql`${devices.version} + 1` })
          .where(eq(devices.id, id))
          .run();
        recordChange(tx, ctx, {
          entityType: 'devices',
          entityId: id,
          op: 'update',
          payload: { id, role },
        });
      }
    }

    let countersAdvanced = 0;
    for (const c of tx
      .select()
      .from(docCounters)
      .where(eq(docCounters.branchId, identity.branchId))
      .all()) {
      const next = afterFailover(c.nextNo - 1);
      tx.update(docCounters)
        .set({ nextNo: next.next, blockEnd: next.blockEnd, epoch, updatedAt: now })
        .where(eq(docCounters.id, c.id))
        .run();
      countersAdvanced += 1;
    }

    const row = {
      id: newId(),
      tenantId: identity.tenantId,
      branchId: identity.branchId,
      deviceId: target,
      epoch,
      promotedBy: ctx.userId,
      reason,
      createdAt: now,
      updatedAt: now,
      hlc,
      version: 1,
    };
    tx.insert(syncEpochs).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'sync_epochs',
      entityId: row.id,
      op: 'insert',
      payload: row,
    });
    appendAudit(tx, ctx, {
      action: 'sync.promote',
      entityType: 'sync_epoch',
      entityId: row.id,
      oldValue: { epoch: previousEpoch, deviceId: identity.deviceId },
      newValue: { epoch, deviceId: target, reason, countersAdvanced },
    });
    return { epoch, previousEpoch, deviceId: target, countersAdvanced };
  });
}
