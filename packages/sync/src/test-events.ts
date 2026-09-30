/** Helpers to build events in tests. Not exported from the package index. All ids are invented. */
import { HybridLogicalClock } from './hlc';
import { newId } from './ids';
import { SYNC_SCHEMA_VERSION, type SyncEvent, type SyncOp } from './outbox';

export const TENANT = '11111111-1111-7111-8111-111111111111';
export const BRANCH_HO = '22222222-2222-7222-8222-222222222222';
export const BRANCH_A = '33333333-3333-7333-8333-333333333333';
export const BRANCH_B = '44444444-4444-7444-8444-444444444444';
export const DEVICE_HO = '55555555-5555-7555-8555-555555550001';
export const DEVICE_A = '55555555-5555-7555-8555-555555550002';
export const DEVICE_B = '55555555-5555-7555-8555-555555550003';

export interface Site {
  branchId: string;
  deviceId: string;
  headOffice: boolean;
  clock: HybridLogicalClock;
  /** Mutable wall clock of this site, in ms. */
  time: { ms: number };
}

export function site(
  branchId: string,
  deviceId: string,
  headOffice = false,
  startMs = Date.parse('2026-10-01T08:00:00Z'),
): Site {
  const time = { ms: startMs };
  return {
    branchId,
    deviceId,
    headOffice,
    time,
    clock: new HybridLogicalClock(deviceId.slice(-8).replace(/[^0-9a-f]/g, '0'), () => time.ms),
  };
}

let seq = 0;

export function event(
  s: Site,
  entityType: string,
  entityId: string,
  op: SyncOp,
  payload: unknown,
  over: Partial<SyncEvent> = {},
): SyncEvent {
  seq += 1;
  return {
    id: newId(),
    seq,
    entityType,
    entityId,
    op,
    payload,
    hlc: s.clock.tick(),
    deviceId: s.deviceId,
    branchId: s.branchId,
    tenantId: TENANT,
    schemaVersion: SYNC_SCHEMA_VERSION,
    ...over,
  };
}
