import { describe, expect, it } from 'vitest';
import {
  ALL_PERMISSIONS,
  ForbiddenError,
  ROLE_CODES,
  ROLE_DEFAULTS,
  assertCan,
  can,
  checkDiscount,
  checkPriceOverride,
  checkRefund,
  contextFromRoles,
  hiddenFields,
  isPermissionKey,
  stripFields,
} from './permissions';

const ctxFor = (role: (typeof ROLE_CODES)[number], branches = ['b1'], all = false) =>
  contextFromRoles('u1', [role], branches, all);

describe('catalogue', () => {
  it('has unique, well-formed keys', () => {
    expect(new Set(ALL_PERMISSIONS).size).toBe(ALL_PERMISSIONS.length);
    for (const key of ALL_PERMISSIONS) expect(key.split('.')).toHaveLength(3);
  });

  it('every role default only contains catalogue keys', () => {
    for (const code of ROLE_CODES) {
      for (const key of ROLE_DEFAULTS[code].permissions) expect(isPermissionKey(key)).toBe(true);
    }
  });
});

describe('default role matrix', () => {
  it('super admin and HO admin hold every permission', () => {
    expect(ROLE_DEFAULTS.super_admin.permissions).toHaveLength(ALL_PERMISSIONS.length);
    expect(ROLE_DEFAULTS.ho_admin.permissions).toHaveLength(ALL_PERMISSIONS.length);
  });

  it('cashier can sell but cannot see cost or profit', () => {
    const c = ctxFor('cashier');
    expect(can(c, 'pharmacy.sale.create')).toBe(true);
    expect(can(c, 'pharmacy.sale.view_cost')).toBe(false);
    expect(can(c, 'pharmacy.sale.view_profit')).toBe(false);
    expect(can(c, 'pharmacy.item.view_cost')).toBe(false);
    expect(can(c, 'admin.user.view')).toBe(false);
    expect(can(c, 'pharmacy.sale.void')).toBe(false);
    expect(can(c, 'pharmacy.sale.backdate')).toBe(false);
  });

  it('junior pharmacist cannot see cost or profit, senior can see cost but not profit', () => {
    expect(can(ctxFor('pharmacist_jr'), 'pharmacy.sale.view_cost')).toBe(false);
    expect(can(ctxFor('pharmacist_sr'), 'pharmacy.sale.view_cost')).toBe(true);
    expect(can(ctxFor('pharmacist_sr'), 'pharmacy.sale.view_profit')).toBe(false);
  });

  it('branch manager can see cost and profit and manage branch users', () => {
    const c = ctxFor('branch_manager');
    expect(can(c, 'pharmacy.sale.view_profit')).toBe(true);
    expect(can(c, 'admin.user.create')).toBe(true);
    expect(can(c, 'admin.role.edit')).toBe(false);
  });

  it('auditor is read-only apart from exports', () => {
    for (const key of ROLE_DEFAULTS.auditor.permissions) {
      const action = key.split('.')[2] ?? '';
      expect(['create', 'edit', 'delete', 'approve', 'void', 'refund', 'backdate']).not.toContain(action);
    }
  });

  it('only accountant and super roles may backdate', () => {
    const holders = ROLE_CODES.filter((r) => ROLE_DEFAULTS[r].permissions.includes('pharmacy.sale.backdate'));
    expect(holders.sort()).toEqual(['accountant', 'branch_manager', 'ho_admin', 'super_admin'].sort());
  });

  it('discount limits match the proposed matrix', () => {
    expect(ROLE_DEFAULTS.cashier.limits.discountLimitBp).toBe(500);
    expect(ROLE_DEFAULTS.pharmacist_jr.limits.discountLimitBp).toBe(1_000);
    expect(ROLE_DEFAULTS.pharmacist_sr.limits.discountLimitBp).toBe(1_500);
    expect(ROLE_DEFAULTS.branch_manager.limits.discountLimitBp).toBe(2_500);
  });
});

describe('branch scope', () => {
  it('denies other branches and allows all-branch users', () => {
    const c = ctxFor('cashier', ['b1']);
    expect(can(c, 'pharmacy.sale.create', 'b1')).toBe(true);
    expect(can(c, 'pharmacy.sale.create', 'b2')).toBe(false);
    expect(can(ctxFor('super_admin', [], true), 'pharmacy.sale.view', 'b9')).toBe(true);
  });

  it('assertCan throws ForbiddenError with the permission', () => {
    expect(() => assertCan(ctxFor('cashier'), 'admin.user.view')).toThrow(ForbiddenError);
  });
});

describe('field-level rules', () => {
  const payload = {
    lines: [{ name: 'Item', rate: 100, avgCost: 60, costUnitMicro: 6_000_000, profit: 40 }],
    grandTotal: 100,
    profitLoss: 40,
  };

  it('removes cost and profit keys for a cashier, at any depth', () => {
    const c = ctxFor('cashier');
    const out = stripFields(payload, hiddenFields(c));
    expect(JSON.stringify(out)).not.toMatch(/avgCost|costUnitMicro|profit/i);
    expect(out.lines[0]?.rate).toBe(100);
    expect(out.grandTotal).toBe(100);
  });

  it('keeps everything for a branch manager', () => {
    const c = ctxFor('branch_manager');
    expect(stripFields(payload, hiddenFields(c))).toEqual(payload);
  });

  it('senior pharmacist sees cost but not profit', () => {
    const out = stripFields(payload, hiddenFields(ctxFor('pharmacist_sr')));
    expect(out.lines[0]).toHaveProperty('avgCost');
    expect(out.lines[0]).not.toHaveProperty('profit');
  });
});

describe('limits', () => {
  it('requires override above the role limit', () => {
    const { limits } = ROLE_DEFAULTS.cashier;
    expect(checkDiscount(limits, 500)).toEqual({ ok: true });
    expect(checkDiscount(limits, 501).ok).toBe(false);
    expect(checkRefund(limits, 200_000)).toEqual({ ok: true });
    expect(checkRefund(limits, 200_001).ok).toBe(false);
    expect(checkPriceOverride(limits, 1).ok).toBe(false);
  });

  it('has no refund cap for super admin', () => {
    expect(checkRefund(ROLE_DEFAULTS.super_admin.limits, 999_999_999)).toEqual({ ok: true });
  });
});
