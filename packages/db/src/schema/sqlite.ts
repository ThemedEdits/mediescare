/**
 * SQLite (branch server) schema for Phase 1. Must stay in parity with pg.ts (parity.test.ts).
 * Conventions (docs/phase0/data-model.md §1): UUIDv7 text ids, snake_case columns, UTC ISO-8601
 * text timestamps, integer minor units for money, `hlc` + `version` on synced rows.
 */
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const syncCols = () => ({
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  hlc: text('hlc').notNull(),
  version: integer('version').notNull().default(1),
});

export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  licenceRef: text('licence_ref'),
  ...syncCols(),
});

export const branches = sqliteTable(
  'branches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isHeadOffice: integer('is_head_office', { mode: 'boolean' }).notNull().default(false),
    address: text('address'),
    licenceNo: text('licence_no'),
    ntn: text('ntn'),
    timezone: text('timezone').notNull().default('Asia/Karachi'),
    status: text('status').notNull().default('active'),
    ...syncCols(),
  },
  (t) => [uniqueIndex('branches_tenant_code_uq').on(t.tenantId, t.code)],
);

export const stores = sqliteTable('stores', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: text('branch_id')
    .notNull()
    .references(() => branches.id),
  kind: text('kind').notNull(), // main | counter | cold_room | quarantine | damaged | expired | in_transit
  name: text('name').notNull(),
  ...syncCols(),
});

export const devices = sqliteTable('devices', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: text('branch_id')
    .notNull()
    .references(() => branches.id),
  name: text('name').notNull(),
  role: text('role').notNull(), // server | terminal | standby
  tokenHash: text('token_hash'),
  certFingerprint: text('cert_fingerprint'),
  lastSeenAt: text('last_seen_at'),
  revokedAt: text('revoked_at'),
  ...syncCols(),
});

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
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
    status: text('status').notNull().default('active'), // active | disabled
    mustChangePassword: integer('must_change_password', { mode: 'boolean' })
      .notNull()
      .default(false),
    failedLogins: integer('failed_logins').notNull().default(0),
    lockedUntil: text('locked_until'),
    lastLoginAt: text('last_login_at'),
    priorityModules: text('priority_modules'), // JSON array of four module ids
    deletedAt: text('deleted_at'),
    ...syncCols(),
  },
  (t) => [uniqueIndex('users_tenant_username_uq').on(t.tenantId, t.username)],
);

export const roles = sqliteTable(
  'roles',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isSystem: integer('is_system', { mode: 'boolean' }).notNull().default(false),
    discountLimitBp: integer('discount_limit_bp').notNull().default(0),
    refundLimitMinor: integer('refund_limit_minor'), // null = no cap
    priceOverrideLimitBp: integer('price_override_limit_bp').notNull().default(0),
    ...syncCols(),
  },
  (t) => [uniqueIndex('roles_tenant_code_uq').on(t.tenantId, t.code)],
);

export const permissions = sqliteTable('permissions', {
  key: text('key').primaryKey(), // module.resource.action
  module: text('module').notNull(),
  description: text('description'),
});

export const rolePermissions = sqliteTable(
  'role_permissions',
  {
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
    permissionKey: text('permission_key')
      .notNull()
      .references(() => permissions.key),
    fieldRules: text('field_rules'), // JSON
  },
  (t) => [primaryKey({ columns: [t.roleId, t.permissionKey] })],
);

export const userRoles = sqliteTable(
  'user_roles',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    roleId: text('role_id')
      .notNull()
      .references(() => roles.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleId] })],
);

export const userBranches = sqliteTable('user_branches', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id),
  branchId: text('branch_id').references(() => branches.id), // null when all_branches
  allBranches: integer('all_branches', { mode: 'boolean' }).notNull().default(false),
  ...syncCols(),
});

/** Local only: server-side sessions so "force logout" works. Not synced. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    deviceId: text('device_id'),
    branchId: text('branch_id'),
    authMethod: text('auth_method').notNull().default('password'), // password | pin (PIN sessions are limited to POS)
    createdAt: text('created_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

export const overrideEvents = sqliteTable('override_events', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: text('branch_id')
    .notNull()
    .references(() => branches.id),
  requestedBy: text('requested_by')
    .notNull()
    .references(() => users.id),
  approvedBy: text('approved_by')
    .notNull()
    .references(() => users.id),
  kind: text('kind').notNull(), // discount | refund | override_price | void | backdate
  reference: text('reference'),
  amountMinor: integer('amount_minor'),
  reason: text('reason'),
  at: text('at').notNull(),
  // A manager override is valid for one action within a short window (permissions-matrix.md §6).
  expiresAt: text('expires_at'),
  consumedAt: text('consumed_at'),
  consumedReference: text('consumed_reference'),
  hlc: text('hlc').notNull(),
});

export const settings = sqliteTable(
  'settings',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    scope: text('scope').notNull(), // tenant | branch
    scopeId: text('scope_id').notNull(),
    key: text('key').notNull(),
    valueJson: text('value_json').notNull(),
    ...syncCols(),
  },
  (t) => [uniqueIndex('settings_scope_key_uq').on(t.tenantId, t.scope, t.scopeId, t.key)],
);

export const featureFlags = sqliteTable(
  'feature_flags',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    module: text('module').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    ...syncCols(),
  },
  (t) => [uniqueIndex('feature_flags_branch_module_uq').on(t.branchId, t.module)],
);

/** Append-only and hash-chained. Update and delete are blocked by triggers (see migrations). */
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    seq: integer('seq').notNull(),
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

/** Local only: durable change queue. Rows are inserted in the same transaction as the change. */
export const syncOutbox = sqliteTable(
  'sync_outbox',
  {
    id: text('id').primaryKey(),
    seq: integer('seq').notNull(),
    tenantId: text('tenant_id').notNull(),
    branchId: text('branch_id'),
    deviceId: text('device_id').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    op: text('op').notNull(), // insert | update | void
    payloadJson: text('payload_json').notNull(),
    hlc: text('hlc').notNull(),
    schemaVersion: integer('schema_version').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    sentAt: text('sent_at'),
    ackAt: text('ack_at'),
    error: text('error'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    uniqueIndex('sync_outbox_seq_uq').on(t.seq),
    index('sync_outbox_pending_idx').on(t.ackAt, t.nextAttemptAt),
  ],
);

/** Local only: per entity type pull position. */
export const syncCursors = sqliteTable('sync_cursors', {
  entityType: text('entity_type').primaryKey(),
  remoteCursor: text('remote_cursor').notNull(),
  lastPulledAt: text('last_pulled_at'),
});

/** Idempotency ledger of applied events (used by the cloud endpoint and by pull). */
export const syncInboxSeen = sqliteTable('sync_inbox_seen', {
  eventId: text('event_id').primaryKey(),
  appliedAt: text('applied_at').notNull(),
});

export const docCounters = sqliteTable(
  'doc_counters',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    docType: text('doc_type').notNull(),
    nextNo: integer('next_no').notNull().default(1),
    blockEnd: integer('block_end').notNull().default(0),
    epoch: integer('epoch').notNull().default(1),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('doc_counters_branch_type_uq').on(t.branchId, t.docType)],
);

/** Local only: backup history. */
export const backups = sqliteTable('backups', {
  id: text('id').primaryKey(),
  path: text('path').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  kind: text('kind').notNull(), // scheduled | manual | pre_migration | pre_restore | pre_reset
  createdAt: text('created_at').notNull(),
  verifiedAt: text('verified_at'),
});

/** Tables that exist only on the branch server and are intentionally absent from Postgres. */
export const LOCAL_ONLY_TABLES = ['sessions', 'sync_outbox', 'sync_cursors', 'backups'] as const;
