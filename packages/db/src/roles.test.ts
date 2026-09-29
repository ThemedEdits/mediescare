import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@mediescare/core';
import { AuthError } from './auth/login';
import { DomainError } from './errors';
import { consumeOverride, grantOverride, limitProblem, OVERRIDE_TTL_MS } from './overrides';
import {
  createRole,
  deleteRole,
  getRole,
  listRoles,
  permissionCatalogue,
  updateRole,
} from './roles';
import { createTestEnv, type TestEnv } from './test-helpers';
import { verifyAuditChain } from './audit';
import { auditLog, overrideEvents } from './schema/sqlite';

let env: TestEnv;
let admin: string;

beforeEach(async () => {
  env = await createTestEnv();
  admin = env.setup.adminUserId;
});
afterEach(() => env.cleanup());

const expectDomain = (fn: () => unknown, code: string) => {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
};

const roleInput = (over: Partial<Parameters<typeof createRole>[2]> = {}) => ({
  name: 'Night Pharmacist',
  permissions: ['pharmacy.sale.view', 'pharmacy.sale.create'],
  discountLimitBp: 300,
  refundLimitMinor: 100_000,
  priceOverrideLimitBp: 0,
  ...over,
});

describe('roles', () => {
  it('lists the 12 built-in roles with counts', () => {
    const list = listRoles(env.db, env.setup.tenantId);
    expect(list).toHaveLength(12);
    const sa = list.find((r) => r.code === 'super_admin');
    expect(sa).toMatchObject({
      isSystem: true,
      permissionCount: ALL_PERMISSIONS.length,
      userCount: 1,
    });
  });

  it('creates, reads, updates (with version check) and deletes a custom role', () => {
    const id = createRole(env.db, env.ctx(admin), roleInput());
    const role = getRole(env.db, env.setup.tenantId, id);
    expect(role).toMatchObject({
      code: 'custom_night_pharmacist',
      isSystem: false,
      permissionCount: 2,
      version: 1,
    });
    updateRole(env.db, env.ctx(admin), id, {
      ...roleInput({ permissions: ['pharmacy.sale.view'], discountLimitBp: 500 }),
      expectedVersion: 1,
    });
    expect(getRole(env.db, env.setup.tenantId, id)).toMatchObject({
      permissions: ['pharmacy.sale.view'],
      discountLimitBp: 500,
      version: 2,
    });
    expectDomain(
      () => updateRole(env.db, env.ctx(admin), id, { ...roleInput(), expectedVersion: 1 }),
      'VERSION_CONFLICT',
    );
    deleteRole(env.db, env.ctx(admin), id);
    expectDomain(() => getRole(env.db, env.setup.tenantId, id), 'NOT_FOUND');
    expect(verifyAuditChain(env.db, env.setup.branchId).ok).toBe(true);
  });

  it('validates permission keys and limits, and rejects duplicate names', () => {
    expectDomain(
      () => createRole(env.db, env.ctx(admin), roleInput({ permissions: ['made.up.key'] })),
      'INVALID',
    );
    expectDomain(
      () => createRole(env.db, env.ctx(admin), roleInput({ discountLimitBp: 10_001 })),
      'INVALID',
    );
    expectDomain(
      () => createRole(env.db, env.ctx(admin), roleInput({ refundLimitMinor: -1 })),
      'INVALID',
    );
    expectDomain(() => createRole(env.db, env.ctx(admin), roleInput({ name: '!!!' })), 'INVALID');
    createRole(env.db, env.ctx(admin), roleInput());
    expectDomain(() => createRole(env.db, env.ctx(admin), roleInput()), 'CONFLICT');
  });

  it('protects Super Admin and built-in roles', () => {
    const sa = listRoles(env.db, env.setup.tenantId).find((r) => r.code === 'super_admin');
    expectDomain(
      () =>
        updateRole(env.db, env.ctx(admin), sa?.id ?? '', { ...roleInput(), expectedVersion: 1 }),
      'IMMUTABLE_ROLE',
    );
    expectDomain(() => deleteRole(env.db, env.ctx(admin), env.roleId('cashier')), 'IMMUTABLE_ROLE');
  });

  it('keeps a built-in role name when its permissions are edited', () => {
    const id = env.roleId('store_keeper');
    const before = getRole(env.db, env.setup.tenantId, id);
    updateRole(env.db, env.ctx(admin), id, {
      ...roleInput({ name: 'Renamed', permissions: before.permissions }),
      expectedVersion: before.version,
    });
    expect(getRole(env.db, env.setup.tenantId, id).name).toBe('Store Keeper');
  });

  it('cannot delete a role that is assigned to users', async () => {
    const id = createRole(env.db, env.ctx(admin), roleInput());
    const { createUser } = await import('./users');
    await createUser(env.db, env.ctx(admin), {
      username: 'nightowl',
      fullName: 'Night Owl',
      roleIds: [id],
      branchIds: [env.setup.branchId],
    });
    expectDomain(() => deleteRole(env.db, env.ctx(admin), id), 'CONFLICT');
  });

  it('stops a role editor from granting permissions they do not hold', async () => {
    const mgr = await env.addUser(admin, 'mgr', 'branch_manager');
    expectDomain(
      () => createRole(env.db, env.ctx(mgr), roleInput({ permissions: ['admin.role.delete'] })),
      'PRIVILEGE_ESCALATION',
    );
    expect(
      createRole(env.db, env.ctx(mgr), roleInput({ permissions: ['pharmacy.sale.view'] })),
    ).toBeTruthy();
    const id = env.roleId('cashier');
    const cur = getRole(env.db, env.setup.tenantId, id);
    expectDomain(
      () =>
        updateRole(env.db, env.ctx(mgr), id, {
          ...roleInput({ permissions: [...cur.permissions, 'admin.role.delete'] }),
          expectedVersion: cur.version,
        }),
      'PRIVILEGE_ESCALATION',
    );
  });

  it('exposes every permission exactly once in the editor catalogue', () => {
    const keys = permissionCatalogue().flatMap((g) => g.keys);
    expect(keys.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});

describe('manager PIN override', () => {
  const PIN = '482913';
  let cashier: string;
  let manager: string;

  beforeEach(async () => {
    cashier = await env.addUser(admin, 'cashier1', 'cashier', { pin: '135791' });
    manager = await env.addUser(admin, 'manager1', 'branch_manager', { pin: PIN });
  });

  const ask = (over: Record<string, unknown> = {}) =>
    grantOverride(env.db, env.ctx(cashier), {
      requesterId: cashier,
      approverUsername: 'manager1',
      approverPin: PIN,
      kind: 'discount',
      percentBp: 2000,
      reference: 'HOLD-1',
      ...over,
    } as Parameters<typeof grantOverride>[2]);

  it('lets a manager approve a discount above the cashier limit, once', async () => {
    const { overrideId, expiresAt } = await ask();
    expect(Date.parse(expiresAt) - env.clock.ms).toBe(OVERRIDE_TTL_MS);
    env.db.transaction((tx) =>
      consumeOverride(tx, env.ctx(cashier), {
        overrideId,
        kind: 'discount',
        requesterId: cashier,
        reference: 'INV-1',
      }),
    );
    expect(() =>
      env.db.transaction((tx) =>
        consumeOverride(tx, env.ctx(cashier), {
          overrideId,
          kind: 'discount',
          requesterId: cashier,
          reference: 'INV-2',
        }),
      ),
    ).toThrow(/already used/);
    const actions = env.db
      .select()
      .from(auditLog)
      .all()
      .map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['override.granted', 'override.used']));
    expect(JSON.stringify(env.db.select().from(auditLog).all())).not.toContain(PIN);
  });

  it('refuses when the amount is above the approver’s own limit', async () => {
    const err = await ask({ percentBp: 3000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as DomainError).code).toBe('OVERRIDE_INVALID');
    expect(
      limitProblem(
        'discount',
        { discountBp: 2500, refundMinor: null, priceBp: 0 },
        { percentBp: 2500 },
      ),
    ).toBeNull();
  });

  it('refuses wrong PIN, self approval, an approver without the right, and unknown approvers, all with one message', async () => {
    const wrongPin = await ask({ approverPin: '999111' }).catch((e: unknown) => e);
    const selfApproval = await grantOverride(env.db, env.ctx(manager), {
      requesterId: manager,
      approverUsername: 'manager1',
      approverPin: PIN,
      kind: 'discount',
      percentBp: 2000,
    }).catch((e: unknown) => e);
    const noRight = await ask({
      approverUsername: 'cashier1',
      approverPin: '135791',
      kind: 'void',
      reason: 'x',
    }).catch((e: unknown) => e);
    const ghost = await ask({ approverUsername: 'ghost' }).catch((e: unknown) => e);
    for (const e of [wrongPin, selfApproval, noRight, ghost]) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).message).toBe('Approval was not accepted');
    }
    expect(env.db.select().from(overrideEvents).all()).toHaveLength(0);
  });

  it('locks the approver PIN after 5 wrong attempts', async () => {
    for (let i = 0; i < 5; i++) await ask({ approverPin: '999111' }).catch(() => undefined);
    const err = await ask().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthError); // right PIN, but locked
    env.clock.ms += 16 * 60_000;
    expect((await ask()).overrideId).toBeTruthy();
  });

  it('requires a reason for refunds, voids and 100% discounts', async () => {
    const noReason = await ask({ kind: 'refund', amountMinor: 50_000 }).catch((e: unknown) => e);
    expect((noReason as DomainError).code).toBe('INVALID');
    const full = await ask({ percentBp: 10_000 }).catch((e: unknown) => e);
    expect((full as DomainError).code).toBe('INVALID');
    expect(
      (await ask({ kind: 'refund', amountMinor: 50_000, reason: 'Wrong strength dispensed' }))
        .overrideId,
    ).toBeTruthy();
  });

  it('expires after two minutes and is bound to the action, the user and the amount', async () => {
    const refund = await ask({ kind: 'refund', amountMinor: 50_000, reason: 'Damaged pack' });
    const use = (o: Partial<Parameters<typeof consumeOverride>[2]> = {}) =>
      env.db.transaction((tx) =>
        consumeOverride(tx, env.ctx(cashier), {
          overrideId: refund.overrideId,
          kind: 'refund',
          requesterId: cashier,
          reference: 'RET-1',
          amountMinor: 50_000,
          ...o,
        }),
      );
    expect(() => use({ kind: 'discount' })).toThrow(/different action/);
    expect(() => use({ requesterId: manager })).toThrow(/different user/);
    expect(() => use({ amountMinor: 50_001 })).toThrow(/higher than/);
    env.clock.ms += OVERRIDE_TTL_MS + 1000;
    expect(() => use()).toThrow(/expired/);
  });
});
