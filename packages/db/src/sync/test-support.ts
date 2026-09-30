/** Shared helpers for the sync tests. Not a test file. All data is invented. */
import { count, isNull, and } from 'drizzle-orm';
import {
  HybridLogicalClock,
  newId,
  SYNC_SCHEMA_VERSION,
  type DeviceAuth,
  type SyncEvent,
  type SyncOp,
} from '@mediescare/sync';
import { recordChange } from '../outbox';
import { syncOutbox } from '../schema/sqlite';
import type { TestEnv } from '../test-helpers';

/** Auth of the branch under test, as the cloud would resolve it from the device token. */
export function authOf(env: TestEnv, headOffice = true): DeviceAuth {
  return {
    tenantId: env.setup.tenantId,
    branchId: env.setup.branchId,
    deviceId: env.setup.deviceId,
    headOffice,
  };
}

/** Queue `n` sale events through the real outbox path (same call the POS uses). */
export function queueSales(env: TestEnv, n: number, prefix = 'sale'): string[] {
  const ids: string[] = [];
  env.db.transaction((tx) => {
    for (let i = 0; i < n; i++) {
      const id = `${prefix}-${i}`;
      ids.push(id);
      recordChange(tx, env.ctx(env.setup.adminUserId), {
        entityType: 'sales',
        entityId: id,
        op: 'insert',
        payload: { id, totalMinor: 10_000 + i },
      });
    }
  });
  return ids;
}

export function queueItemEdit(
  env: TestEnv,
  itemId: string,
  op: SyncOp,
  payload: Record<string, unknown>,
): void {
  env.db.transaction((tx) => {
    recordChange(tx, env.ctx(env.setup.adminUserId), {
      entityType: 'items',
      entityId: itemId,
      op,
      payload: { id: itemId, ...payload },
    });
  });
}

export function unsentCount(env: TestEnv): number {
  return (
    env.db
      .select({ n: count() })
      .from(syncOutbox)
      .where(and(isNull(syncOutbox.ackAt), isNull(syncOutbox.error)))
      .get()?.n ?? 0
  );
}

/** A second site (another branch) that writes straight to the fake cloud, with its own clock. */
export function remoteSite(
  env: TestEnv,
  branchId: string,
  deviceId: string,
  headOffice: boolean,
  startMs: number,
) {
  const time = { ms: startMs };
  const clock = new HybridLogicalClock(deviceId.replace(/-/g, '').slice(-8), () => time.ms);
  const auth: DeviceAuth = { tenantId: env.setup.tenantId, branchId, deviceId, headOffice };
  return {
    auth,
    time,
    event(entityType: string, entityId: string, op: SyncOp, payload: unknown): SyncEvent {
      return {
        id: newId(),
        seq: 0,
        entityType,
        entityId,
        op,
        payload,
        hlc: clock.tick(),
        deviceId,
        branchId,
        tenantId: env.setup.tenantId,
        schemaVersion: SYNC_SCHEMA_VERSION,
      };
    },
  };
}
