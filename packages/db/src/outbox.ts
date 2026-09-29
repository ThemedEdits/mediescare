import { max } from 'drizzle-orm';
import { newId, SYNC_SCHEMA_VERSION, type SyncOp } from '@mediescare/sync';
import type { DbOrTx } from './client';
import { isoNow, type WriteContext } from './context';
import { syncOutbox } from './schema/sqlite';

export interface ChangeInput {
  entityType: string;
  entityId: string;
  op: SyncOp;
  payload: unknown;
}

/**
 * Queue a change for the cloud. MUST be called inside the same transaction as the write
 * (CLAUDE.md §4.3 rule 3), so a change never exists without its outbox row or the reverse.
 * The single-writer server makes max(seq)+1 safe without AUTOINCREMENT.
 */
export function recordChange(tx: DbOrTx, ctx: WriteContext, change: ChangeInput): string {
  const current = tx.select({ value: max(syncOutbox.seq) }).from(syncOutbox).get();
  const id = newId();
  tx.insert(syncOutbox)
    .values({
      id,
      seq: (current?.value ?? 0) + 1,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      deviceId: ctx.deviceId,
      entityType: change.entityType,
      entityId: change.entityId,
      op: change.op,
      payloadJson: JSON.stringify(change.payload),
      hlc: ctx.clock.tick(),
      schemaVersion: SYNC_SCHEMA_VERSION,
      createdAt: isoNow(ctx),
    })
    .run();
  return id;
}
