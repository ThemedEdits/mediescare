import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { devices } from './schema/sqlite';

export interface ServerIdentity {
  tenantId: string;
  branchId: string;
  deviceId: string;
}

/** Who this branch server is (tenant, branch and device ids), or null before first-run setup. */
export function getServerIdentity(db: Db): ServerIdentity | null {
  const device = db.select().from(devices).where(eq(devices.role, 'server')).limit(1).get();
  return device
    ? { tenantId: device.tenantId, branchId: device.branchId, deviceId: device.id }
    : null;
}

/** 8 hex characters identifying a device inside HLC timestamps, derived from its id. */
export function hlcDeviceId(deviceId: string): string {
  return deviceId.replace(/-/g, '').slice(-8).toLowerCase();
}
