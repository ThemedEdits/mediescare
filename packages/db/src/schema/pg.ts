/**
 * PostgreSQL (cloud) schema for Phase 1. Supabase is used as plain Postgres (no Supabase Auth).
 * Mirrors sqlite.ts table for table and column for column (parity.test.ts enforces it).
 * Timestamps stay ISO-8601 text in both dialects so events replay byte-for-byte.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const syncCols = () => ({
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  hlc: text('hlc').notNull(),
  version: integer('version').notNull().default(1),
});

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  licenceRef: text('licence_ref'),
  ...syncCols(),
});

export const branches = pgTable(
  'branches',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isHeadOffice: boolean('is_head_office').notNull().default(false),
    address: text('address'),
    licenceNo: text('licence_no'),
    ntn: text('ntn'),
    timezone: text('timezone').notNull().default('Asia/Karachi'),
    status: text('status').notNull().default('active'),
    ...syncCols(),
  },
  (t) => [uniqueIndex('branches_tenant_code_uq').on(t.tenantId, t.code)],
);

export const stores = pgTable('stores', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  ...syncCols(),
});

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  name: text('name').notNull(),
  role: text('role').notNull(),
  tokenHash: text('token_hash'),
  certFingerprint: text('cert_fingerprint'),
  lastSeenAt: text('last_seen_at'),
  revokedAt: text('revoked_at'),
  ...syncCols(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    username: text('username').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email'),
    phone: text('phone'),
    passwordHash: text('password_hash').notNull(),
    pinHash: text('pin_hash'),
    totpSecretEnc: text('totp_secret_enc'),
    language: text('language').notNull().default('en'),
    status: text('status').notNull().default('active'),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: text('locked_until'),
    lastLoginAt: text('last_login_at'),
    priorityModules: text('priority_modules'),
    deletedAt: text('deleted_at'),
    ...syncCols(),
  },
  (t) => [uniqueIndex('users_tenant_username_uq').on(t.tenantId, t.username)],
);

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    discountLimitBp: integer('discount_limit_bp').notNull().default(0),
    refundLimitMinor: bigint('refund_limit_minor', { mode: 'number' }),
    priceOverrideLimitBp: integer('price_override_limit_bp').notNull().default(0),
    ...syncCols(),
  },
  (t) => [uniqueIndex('roles_tenant_code_uq').on(t.tenantId, t.code)],
);

export const permissions = pgTable('permissions', {
  key: text('key').primaryKey(),
  module: text('module').notNull(),
  description: text('description'),
});

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key),
    fieldRules: text('field_rules'),
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const userBranches = pgTable('user_branches', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  branchId: uuid('branch_id').references(() => branches.id),
  allBranches: boolean('all_branches').notNull().default(false),
  ...syncCols(),
});

export const overrideEvents = pgTable('override_events', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  requestedBy: uuid('requested_by')
    .notNull()
    .references(() => users.id),
  approvedBy: uuid('approved_by')
    .notNull()
    .references(() => users.id),
  kind: text('kind').notNull(),
  reference: text('reference'),
  amountMinor: bigint('amount_minor', { mode: 'number' }),
  reason: text('reason'),
  at: text('at').notNull(),
  expiresAt: text('expires_at'),
  consumedAt: text('consumed_at'),
  consumedReference: text('consumed_reference'),
  hlc: text('hlc').notNull(),
});

export const settings = pgTable(
  'settings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    scope: text('scope').notNull(),
    scopeId: text('scope_id').notNull(),
    key: text('key').notNull(),
    valueJson: text('value_json').notNull(),
    ...syncCols(),
  },
  (t) => [uniqueIndex('settings_scope_key_uq').on(t.tenantId, t.scope, t.scopeId, t.key)],
);

export const featureFlags = pgTable(
  'feature_flags',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    module: text('module').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    ...syncCols(),
  },
  (t) => [uniqueIndex('feature_flags_branch_module_uq').on(t.branchId, t.module)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    userId: text('user_id'),
    deviceId: text('device_id'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    oldJson: text('old_json'),
    newJson: text('new_json'),
    at: text('at').notNull(),
    prevHash: text('prev_hash').notNull(),
    hash: text('hash').notNull(),
    hlc: text('hlc').notNull(),
  },
  (t) => [
    uniqueIndex('audit_log_branch_seq_uq').on(t.branchId, t.seq),
    index('audit_log_at_idx').on(t.at),
  ],
);

export const syncInboxSeen = pgTable('sync_inbox_seen', {
  eventId: uuid('event_id').primaryKey(),
  appliedAt: text('applied_at').notNull(),
});

export const docCounters = pgTable(
  'doc_counters',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    docType: text('doc_type').notNull(),
    nextNo: bigint('next_no', { mode: 'number' }).notNull().default(1),
    blockEnd: bigint('block_end', { mode: 'number' }).notNull().default(0),
    epoch: integer('epoch').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('doc_counters_branch_type_uq').on(t.branchId, t.docType)],
);
