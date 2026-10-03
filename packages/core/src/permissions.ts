/**
 * RBAC catalogue and role defaults (docs/phase0/permissions-matrix.md).
 * Keys are `module.resource.action`. Enforcement happens server-side using these pure functions.
 */

const CRUD = ['view', 'create', 'edit', 'delete'] as const;
const DOC = ['view', 'create', 'edit', 'approve', 'print', 'export'] as const;

/** module -> resource -> allowed actions. This is the full catalogue for Phases 1-3. */
export const CATALOGUE = {
  admin: {
    user: [...CRUD, 'approve'],
    role: [...CRUD, 'approve'],
    branch: [...CRUD],
    device: [...CRUD],
    settings: ['view', 'edit'],
    feature_flag: ['view', 'edit'],
    audit_log: ['view', 'export'],
    backup: ['view', 'create', 'edit'],
    sync: ['view', 'create', 'edit'],
  },
  pharmacy: {
    item: [...CRUD, 'export', 'import', 'view_cost'],
    price: ['view', 'edit', 'approve', 'override_price'],
    sale: [
      'view',
      'create',
      'print',
      'export',
      'discount',
      'void',
      'refund',
      'backdate',
      'view_cost',
      'view_profit',
    ],
    sale_return: ['view', 'create', 'approve'],
    hold_invoice: [...CRUD],
    customer: [...CRUD, 'approve'],
    doctor: [...CRUD],
    missed_sale: ['view', 'create'],
    narcotic_register: ['view', 'create', 'print', 'export'],
  },
  inventory: {
    stock: ['view', 'create', 'edit', 'view_cost'],
    batch: ['view', 'create', 'edit'],
    adjustment: ['view', 'create', 'approve'],
    count: ['view', 'create', 'approve'],
    transfer: [...DOC],
    requisition: [...DOC],
  },
  purchasing: {
    supplier: [...CRUD, 'approve'],
    purchase_order: [...DOC],
    grn: [...DOC],
    purchase_return: [...DOC],
    supplier_payment: ['view', 'create', 'approve'],
  },
  shifts: {
    shift: ['view', 'create', 'approve'],
    cash_count: ['view', 'create'],
    report: ['view', 'print', 'export'],
  },
  finance: {
    /** delete = void: an expense is never removed, it is voided with a reason. */
    expense: [...CRUD, 'approve', 'export'],
    expense_category: [...CRUD],
    petty_cash: ['view', 'create', 'approve'],
    ledger: ['view', 'create', 'export'],
  },
  reports: {
    sales: ['view', 'export'],
    purchases: ['view', 'export'],
    stock: ['view', 'export'],
    profit: ['view', 'export'],
    expiry: ['view', 'export'],
    narcotic: ['view', 'export'],
    financial: ['view', 'export'],
    audit: ['view', 'export'],
  },
} as const satisfies Record<string, Record<string, readonly string[]>>;

export type PermissionKey = string;

function buildKeys(): PermissionKey[] {
  const keys: PermissionKey[] = [];
  for (const [module, resources] of Object.entries(CATALOGUE)) {
    for (const [resource, actions] of Object.entries(resources)) {
      for (const action of actions) keys.push(`${module}.${resource}.${action}`);
    }
  }
  return keys;
}

export const ALL_PERMISSIONS: readonly PermissionKey[] = Object.freeze(buildKeys());
const PERMISSION_SET: ReadonlySet<PermissionKey> = new Set(ALL_PERMISSIONS);

export function isPermissionKey(value: string): boolean {
  return PERMISSION_SET.has(value);
}

/** Expand `module.resource.*` and `module.*` wildcards against the catalogue. */
function expand(pattern: string): PermissionKey[] {
  if (pattern === '*') return [...ALL_PERMISSIONS];
  if (!pattern.includes('*')) {
    if (!PERMISSION_SET.has(pattern)) throw new Error(`Unknown permission: ${pattern}`);
    return [pattern];
  }
  const prefix = pattern.replace(/\*$/, '');
  const matches = ALL_PERMISSIONS.filter((k) => k.startsWith(prefix));
  if (matches.length === 0) throw new Error(`Permission pattern matches nothing: ${pattern}`);
  return matches;
}

export const ROLE_CODES = [
  'super_admin',
  'ho_admin',
  'branch_manager',
  'pharmacist_sr',
  'pharmacist_jr',
  'cashier',
  'store_keeper',
  'purchase_officer',
  'accountant',
  'hr_manager',
  'auditor',
  'qc_manager',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];

/** Fields removed from API responses for roles without the matching right (field-level rules). */
export const SENSITIVE_FIELDS = {
  view_cost: [
    'cost',
    'avgCost',
    'costUnitMicro',
    'costMinor',
    'costValueMinor',
    'netUnitCost',
    'costWithTax',
    'supplierPrice',
  ],
  view_profit: [
    'profit',
    'profitLoss',
    'profitMinor',
    'margin',
    'marginPct',
    'grossProfit',
    'grossProfitMinor',
  ],
} as const;

export interface RoleLimits {
  /** Max discount per bill or line in basis points. */
  discountLimitBp: number;
  /** Max refund per return in paisa. null = no cap. */
  refundLimitMinor: number | null;
  /** Max price reduction below rate in basis points. 0 = not allowed. */
  priceOverrideLimitBp: number;
}

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  permissions: readonly PermissionKey[];
  limits: RoleLimits;
}

function role(
  code: RoleCode,
  name: string,
  patterns: readonly string[],
  limits: RoleLimits,
): RoleDefinition {
  const set = new Set<PermissionKey>();
  for (const p of patterns) for (const key of expand(p)) set.add(key);
  return { code, name, permissions: [...set].sort(), limits };
}

const NO_CAP = null;
const READ_ALL = ALL_PERMISSIONS.filter((k) => k.endsWith('.view'));

// Proposed defaults from permissions-matrix.md §5. Open question Q8 may change the numbers.
export const ROLE_DEFAULTS: Readonly<Record<RoleCode, RoleDefinition>> = {
  super_admin: role('super_admin', 'Super Admin', ['*'], {
    discountLimitBp: 10_000,
    refundLimitMinor: NO_CAP,
    priceOverrideLimitBp: 10_000,
  }),
  ho_admin: role('ho_admin', 'Head Office Admin', ['*'], {
    discountLimitBp: 10_000,
    refundLimitMinor: NO_CAP,
    priceOverrideLimitBp: 10_000,
  }),
  branch_manager: role(
    'branch_manager',
    'Branch Manager',
    [
      'admin.user.view',
      'admin.user.create',
      'admin.user.edit',
      'admin.settings.*',
      'admin.audit_log.view',
      'admin.backup.*',
      'admin.sync.*',
      'admin.branch.view',
      'admin.device.view',
      'admin.role.view',
      'pharmacy.*',
      'inventory.*',
      'shifts.*',
      'reports.*',
      'finance.expense.view',
      'finance.expense.create',
      'finance.expense.delete', // voids an expense (nothing is ever deleted)
      'finance.expense.export',
      'finance.ledger.create', // cash book entries: opening balance and corrections
      'purchasing.supplier.view',
      'purchasing.grn.view',
      'purchasing.grn.create',
      'purchasing.purchase_order.view',
    ],
    { discountLimitBp: 2_500, refundLimitMinor: 10_000_000, priceOverrideLimitBp: 1_000 },
  ),
  pharmacist_sr: role(
    'pharmacist_sr',
    'Senior Pharmacist',
    [
      'pharmacy.item.view',
      'pharmacy.item.create',
      'pharmacy.item.edit',
      'pharmacy.item.view_cost',
      'pharmacy.sale.view',
      'pharmacy.sale.create',
      'pharmacy.sale.print',
      'pharmacy.sale.discount',
      'pharmacy.sale.refund',
      'pharmacy.sale.view_cost',
      'pharmacy.sale_return.*',
      'pharmacy.hold_invoice.*',
      'pharmacy.customer.view',
      'pharmacy.customer.create',
      'pharmacy.customer.edit',
      'pharmacy.doctor.view',
      'pharmacy.missed_sale.*',
      'pharmacy.narcotic_register.*',
      'pharmacy.price.view',
      'pharmacy.price.override_price',
      'inventory.stock.view',
      'inventory.stock.view_cost',
      'inventory.batch.view',
      'inventory.adjustment.view',
      'inventory.adjustment.create',
      'inventory.count.view',
      'inventory.count.create',
      'shifts.shift.view',
      'reports.sales.view',
      'reports.stock.view',
      'reports.expiry.view',
      'reports.narcotic.view',
    ],
    { discountLimitBp: 1_500, refundLimitMinor: 2_000_000, priceOverrideLimitBp: 500 },
  ),
  pharmacist_jr: role(
    'pharmacist_jr',
    'Junior Pharmacist',
    [
      'pharmacy.item.view',
      'pharmacy.sale.view',
      'pharmacy.sale.create',
      'pharmacy.sale.print',
      'pharmacy.sale.discount',
      'pharmacy.sale.refund',
      'pharmacy.sale_return.view',
      'pharmacy.sale_return.create',
      'pharmacy.hold_invoice.*',
      'pharmacy.customer.view',
      'pharmacy.customer.create',
      'pharmacy.customer.edit',
      'pharmacy.doctor.view',
      'pharmacy.missed_sale.*',
      'pharmacy.narcotic_register.view',
      'pharmacy.narcotic_register.create',
      'pharmacy.narcotic_register.print',
      'inventory.stock.view',
      'inventory.batch.view',
      'inventory.count.view',
      'inventory.count.create',
      'shifts.shift.view',
      'reports.sales.view',
      'reports.expiry.view',
    ],
    { discountLimitBp: 1_000, refundLimitMinor: 500_000, priceOverrideLimitBp: 0 },
  ),
  cashier: role(
    'cashier',
    'Cashier',
    [
      'pharmacy.item.view',
      'pharmacy.sale.view',
      'pharmacy.sale.create',
      'pharmacy.sale.print',
      'pharmacy.sale.discount',
      'pharmacy.sale.refund',
      'pharmacy.sale_return.view',
      'pharmacy.sale_return.create',
      'pharmacy.hold_invoice.*',
      'pharmacy.customer.view',
      'pharmacy.customer.create',
      'pharmacy.missed_sale.*',
      'pharmacy.narcotic_register.create',
      'pharmacy.price.view',
      'inventory.stock.view',
      'inventory.batch.view',
      'shifts.shift.view',
      'shifts.shift.create',
      'shifts.cash_count.*',
      'shifts.report.view',
      'finance.expense.view',
      'finance.expense.create',
    ],
    { discountLimitBp: 500, refundLimitMinor: 200_000, priceOverrideLimitBp: 0 },
  ),
  store_keeper: role(
    'store_keeper',
    'Store Keeper',
    [
      'pharmacy.item.view',
      'pharmacy.missed_sale.view',
      'inventory.stock.*',
      'inventory.batch.*',
      'inventory.adjustment.view',
      'inventory.adjustment.create',
      'inventory.count.view',
      'inventory.count.create',
      'inventory.transfer.view',
      'inventory.transfer.create',
      'inventory.transfer.print',
      'inventory.requisition.view',
      'inventory.requisition.create',
      'purchasing.supplier.view',
      'purchasing.grn.view',
      'purchasing.grn.create',
      'reports.stock.view',
    ],
    { discountLimitBp: 0, refundLimitMinor: 0, priceOverrideLimitBp: 0 },
  ),
  purchase_officer: role(
    'purchase_officer',
    'Purchase Officer',
    [
      'pharmacy.item.view',
      'pharmacy.item.create',
      'pharmacy.item.edit',
      'pharmacy.item.view_cost',
      'pharmacy.price.view',
      'pharmacy.price.edit',
      'pharmacy.missed_sale.view',
      'inventory.stock.view',
      'inventory.stock.view_cost',
      'purchasing.supplier.*',
      'purchasing.purchase_order.*',
      'purchasing.grn.*',
      'purchasing.purchase_return.*',
      'reports.purchases.*',
      'reports.stock.view',
    ],
    { discountLimitBp: 0, refundLimitMinor: 0, priceOverrideLimitBp: 0 },
  ),
  accountant: role(
    'accountant',
    'Accountant',
    [
      ...READ_ALL,
      'finance.*',
      'purchasing.supplier_payment.*',
      'pharmacy.sale.export',
      'pharmacy.sale.view_cost',
      'pharmacy.sale.view_profit',
      'pharmacy.sale.backdate',
      'pharmacy.item.view_cost',
      'inventory.stock.view_cost',
      'reports.*',
    ],
    { discountLimitBp: 0, refundLimitMinor: 0, priceOverrideLimitBp: 0 },
  ),
  hr_manager: role(
    'hr_manager',
    'HR Manager',
    ['admin.user.view', 'admin.user.create', 'admin.user.edit', 'shifts.shift.view'],
    { discountLimitBp: 0, refundLimitMinor: 0, priceOverrideLimitBp: 0 },
  ),
  auditor: role(
    'auditor',
    'Auditor (read-only)',
    [
      ...READ_ALL,
      'admin.audit_log.export',
      'pharmacy.sale.export',
      'pharmacy.sale.view_cost',
      'pharmacy.sale.view_profit',
      'pharmacy.item.view_cost',
      'inventory.stock.view_cost',
      'reports.*',
    ],
    { discountLimitBp: 0, refundLimitMinor: 0, priceOverrideLimitBp: 0 },
  ),
  qc_manager: role(
    'qc_manager',
    'Quality Control Manager',
    [
      'pharmacy.item.view',
      'pharmacy.sale.view',
      'pharmacy.narcotic_register.view',
      'pharmacy.narcotic_register.export',
      'inventory.stock.view',
      'inventory.batch.view',
      'inventory.batch.edit',
      'inventory.adjustment.view',
      'inventory.adjustment.create',
      'inventory.adjustment.approve',
      'inventory.count.view',
      'admin.audit_log.view',
      'reports.expiry.*',
      'reports.narcotic.*',
      'reports.stock.view',
    ],
    { discountLimitBp: 0, refundLimitMinor: 0, priceOverrideLimitBp: 0 },
  ),
};

/** The subject of an authorization check, built by the server from the session. */
export interface AccessContext {
  userId: string;
  permissions: ReadonlySet<PermissionKey>;
  /** Super Admin style access to every branch. */
  allBranches: boolean;
  branchIds: readonly string[];
}

export function contextFromRoles(
  userId: string,
  roles: readonly RoleCode[],
  branchIds: readonly string[],
  allBranches = false,
): AccessContext {
  const permissions = new Set<PermissionKey>();
  for (const code of roles) for (const key of ROLE_DEFAULTS[code].permissions) permissions.add(key);
  return { userId, permissions, allBranches, branchIds };
}

export function hasBranchAccess(ctx: AccessContext, branchId: string): boolean {
  return ctx.allBranches || ctx.branchIds.includes(branchId);
}

/** True if the user holds the permission, and (when a branch is given) may act in that branch. */
export function can(ctx: AccessContext, key: PermissionKey, branchId?: string): boolean {
  if (!ctx.permissions.has(key)) return false;
  return branchId === undefined ? true : hasBranchAccess(ctx, branchId);
}

/** Thrown by server guards. Route handlers map it to HTTP 403. */
export class ForbiddenError extends Error {
  constructor(public readonly permission: PermissionKey) {
    super(`Missing permission: ${permission}`);
    this.name = 'ForbiddenError';
  }
}

export function assertCan(ctx: AccessContext, key: PermissionKey, branchId?: string): void {
  if (!can(ctx, key, branchId)) throw new ForbiddenError(key);
}

/** Field names to remove from a response for this user (cost and profit fields). */
export function hiddenFields(ctx: AccessContext): string[] {
  const hidden: string[] = [];
  const canCost = [
    'pharmacy.sale.view_cost',
    'pharmacy.item.view_cost',
    'inventory.stock.view_cost',
  ].some((k) => ctx.permissions.has(k));
  if (!canCost) hidden.push(...SENSITIVE_FIELDS.view_cost);
  if (!ctx.permissions.has('pharmacy.sale.view_profit'))
    hidden.push(...SENSITIVE_FIELDS.view_profit);
  return hidden;
}

/** Recursively remove hidden keys from any JSON-like value. */
export function stripFields<T>(value: T, hidden: readonly string[]): T {
  if (hidden.length === 0) return value;
  const drop = new Set(hidden);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (!drop.has(k)) out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

export type LimitDecision =
  { ok: true } | { ok: false; reason: 'OVERRIDE_REQUIRED'; requiredBp?: number };

export function checkDiscount(limits: RoleLimits, discountBp: number): LimitDecision {
  return discountBp <= limits.discountLimitBp
    ? { ok: true }
    : { ok: false, reason: 'OVERRIDE_REQUIRED', requiredBp: discountBp };
}

export function checkRefund(limits: RoleLimits, refundMinor: number): LimitDecision {
  return limits.refundLimitMinor === null || refundMinor <= limits.refundLimitMinor
    ? { ok: true }
    : { ok: false, reason: 'OVERRIDE_REQUIRED' };
}

export function checkPriceOverride(limits: RoleLimits, reductionBp: number): LimitDecision {
  return reductionBp <= limits.priceOverrideLimitBp
    ? { ok: true }
    : { ok: false, reason: 'OVERRIDE_REQUIRED', requiredBp: reductionBp };
}
