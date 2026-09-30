import { count, eq } from 'drizzle-orm';
import { ALL_PERMISSIONS, ROLE_CODES, ROLE_DEFAULTS, formatDocNo } from '@mediescare/core';
import { HybridLogicalClock, newId } from '@mediescare/sync';
import { hlcDeviceId } from './identity';
import { seedPharmacyDefaults } from './pharmacy/defaults';
import type { Db } from './client';
import { appendAudit } from './audit';
import type { WriteContext } from './context';
import { recordChange } from './outbox';
import {
  branches,
  devices,
  permissions,
  rolePermissions,
  roles,
  stores,
  tenants,
  userBranches,
  userRoles,
  users,
} from './schema/sqlite';

export interface FirstRunInput {
  tenantName: string;
  branchCode: string;
  branchName: string;
  isHeadOffice: boolean;
  deviceName: string;
  admin: { username: string; fullName: string; passwordHash: string };
  now?: () => Date;
}

export interface FirstRunResult {
  tenantId: string;
  branchId: string;
  deviceId: string;
  adminUserId: string;
  /** Example of the first document number this branch will issue. */
  sampleDocNo: string;
}

export function isInitialized(db: Db): boolean {
  try {
    return (db.select({ n: count() }).from(tenants).get()?.n ?? 0) > 0;
  } catch (error) {
    // A brand-new database has no tables yet (migrations have not run): not initialised.
    if (error instanceof Error && /no such table/i.test(error.message)) return false;
    throw error;
  }
}

export class AlreadyInitializedError extends Error {
  constructor() {
    super('This database is already set up');
    this.name = 'AlreadyInitializedError';
  }
}

/**
 * Creates the tenant, first branch (with a main store), this server's device record, the
 * permission catalogue, the default roles, and the Super Admin, in one transaction. Every synced
 * row gets an outbox entry and the whole setup is written to the audit chain.
 */
export function runFirstRunSetup(db: Db, input: FirstRunInput): FirstRunResult {
  if (isInitialized(db)) throw new AlreadyInitializedError();

  const tenantId = newId();
  const branchId = newId();
  const deviceId = newId();
  const clock = new HybridLogicalClock(hlcDeviceId(deviceId));
  const storeId = newId();
  const adminId = newId();
  const ctx: WriteContext = {
    tenantId,
    branchId,
    deviceId,
    userId: adminId,
    clock,
    now: input.now,
  };
  const nowIso = (input.now ? input.now() : new Date()).toISOString();
  const sync = () => ({ createdAt: nowIso, updatedAt: nowIso, hlc: clock.tick(), version: 1 });

  db.transaction((tx) => {
    const emit = (entityType: string, entityId: string, payload: unknown) =>
      recordChange(tx, ctx, { entityType, entityId, op: 'insert', payload });

    const tenantRow = { id: tenantId, name: input.tenantName, licenceRef: null, ...sync() };
    tx.insert(tenants).values(tenantRow).run();
    emit('tenants', tenantId, tenantRow);

    const branchRow = {
      id: branchId,
      tenantId,
      code: input.branchCode,
      name: input.branchName,
      isHeadOffice: input.isHeadOffice,
      address: null,
      licenceNo: null,
      ntn: null,
      timezone: 'Asia/Karachi',
      status: 'active',
      ...sync(),
    };
    tx.insert(branches).values(branchRow).run();
    emit('branches', branchId, branchRow);

    const storeRow = {
      id: storeId,
      tenantId,
      branchId,
      kind: 'main',
      name: 'Main Store',
      ...sync(),
    };
    tx.insert(stores).values(storeRow).run();
    emit('stores', storeId, storeRow);

    const deviceRow = {
      id: deviceId,
      tenantId,
      branchId,
      name: input.deviceName,
      role: 'server',
      tokenHash: null,
      certFingerprint: null,
      lastSeenAt: null,
      revokedAt: null,
      ...sync(),
    };
    tx.insert(devices).values(deviceRow).run();
    emit('devices', deviceId, deviceRow);

    // Permission catalogue (code-defined, identical on every install).
    tx.insert(permissions)
      .values(
        ALL_PERMISSIONS.map((key) => ({
          key,
          module: key.split('.')[0] as string,
          description: null,
        })),
      )
      .run();

    // Default roles and their grants.
    const roleIds = new Map<string, string>();
    for (const code of ROLE_CODES) {
      const def = ROLE_DEFAULTS[code];
      const roleId = newId();
      roleIds.set(code, roleId);
      const roleRow = {
        id: roleId,
        tenantId,
        code,
        name: def.name,
        isSystem: true,
        discountLimitBp: def.limits.discountLimitBp,
        refundLimitMinor: def.limits.refundLimitMinor,
        priceOverrideLimitBp: def.limits.priceOverrideLimitBp,
        ...sync(),
      };
      tx.insert(roles).values(roleRow).run();
      tx.insert(rolePermissions)
        .values(
          def.permissions.map((permissionKey) => ({ roleId, permissionKey, fieldRules: null })),
        )
        .run();
      emit('roles', roleId, { ...roleRow, permissions: def.permissions });
    }

    const adminRow = {
      id: adminId,
      tenantId,
      username: input.admin.username,
      fullName: input.admin.fullName,
      email: null,
      phone: null,
      passwordHash: input.admin.passwordHash,
      pinHash: null,
      totpSecretEnc: null,
      language: 'en',
      status: 'active',
      mustChangePassword: false,
      failedLogins: 0,
      lockedUntil: null,
      lastLoginAt: null,
      priorityModules: null,
      deletedAt: null,
      ...sync(),
    };
    tx.insert(users).values(adminRow).run();
    emit('users', adminId, adminRow);

    const superRoleId = roleIds.get('super_admin') as string;
    tx.insert(userRoles).values({ userId: adminId, roleId: superRoleId }).run();
    emit('user_roles', `${adminId}:${superRoleId}`, { userId: adminId, roleId: superRoleId });

    const scopeId = newId();
    const scopeRow = { id: scopeId, userId: adminId, branchId: null, allBranches: true, ...sync() };
    tx.insert(userBranches).values(scopeRow).run();
    emit('user_branches', scopeId, scopeRow);

    seedPharmacyDefaults(tx, ctx);

    appendAudit(tx, ctx, {
      action: 'system.first_run',
      entityType: 'tenant',
      entityId: tenantId,
      newValue: {
        branchCode: input.branchCode,
        isHeadOffice: input.isHeadOffice,
        admin: input.admin.username,
      },
    });
  });

  // Confirm what was stored, and report the numbering format the branch will use.
  const stored = db
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, branchId))
    .get();
  return {
    tenantId,
    branchId,
    deviceId,
    adminUserId: adminId,
    sampleDocNo: formatDocNo(stored?.code ?? input.branchCode, 'INV', 1),
  };
}
