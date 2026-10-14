import { and, eq, inArray, ne } from 'drizzle-orm';
import type { DbOrTx } from '../../client';
import {
  branches,
  permissions,
  rolePermissions,
  roles,
  userBranches,
  userRoles,
  users,
} from '../../schema/sqlite';
import {
  deviceOfHlc,
  fromHeadOffice,
  isoOfHlc,
  maxHlc,
  mergeFields,
  payloadOf,
  readFields,
  requireRow,
  resultOf,
  simpleMasterApplier,
} from './common';
import {
  APPLY_ORDER,
  type ApplyDetail,
  type FieldConflictNote,
  registerApplier,
  type ApplyEnv,
  type ApplyOutcome,
  type EntityApplier,
} from './registry';

/**
 * User accounts and roles (ADR-0016). Head Office owns them: a branch applies these events only when
 * they come from the Head Office branch, and Head Office wins every field whatever the clocks say.
 * Accounts and role edits made at a branch stay on that branch. This keeps one compromised branch PC
 * from creating a Super Admin for the whole organisation.
 *
 * Every PC creates the standard roles at first run with its own ids, so roles are matched by `code`:
 * the first Head Office event for a role re-keys the local role of the same code to Head Office's id.
 */

const onlyFromHeadOffice =
  (applier: EntityApplier): EntityApplier =>
  (tx, change, env) =>
    fromHeadOffice(tx, env, change) ? applier(tx, change, env) : 'skipped';

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

// ------------------------------------------------------------------------------------------ roles

const ROLE_FIELDS = [
  'name',
  'discountLimitBp',
  'refundLimitMinor',
  'priceOverrideLimitBp',
] as const;

function roleFields(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = readFields(p, {
    name: 's',
    discountLimitBp: 'i',
    priceOverrideLimitBp: 'i',
  });
  const refund = p.refundLimitMinor;
  if (refund === null || (typeof refund === 'number' && Number.isSafeInteger(refund)))
    out.refundLimitMinor = refund;
  return out;
}

/** Give the local role `oldId` the id `newId`, keeping its permissions and the users who hold it. */
function rekeyRole(tx: DbOrTx, oldId: string, newId: string): void {
  const old = tx.select().from(roles).where(eq(roles.id, oldId)).get();
  if (!old) return;
  // Free the (tenant, code) unique key, add the row under the new id, move the children, drop the old row.
  tx.update(roles)
    .set({ code: `${old.code}#rekey` })
    .where(eq(roles.id, oldId))
    .run();
  tx.insert(roles)
    .values({ ...old, id: newId })
    .run();
  tx.update(rolePermissions).set({ roleId: newId }).where(eq(rolePermissions.roleId, oldId)).run();
  tx.update(userRoles).set({ roleId: newId }).where(eq(userRoles.roleId, oldId)).run();
  tx.delete(roles).where(eq(roles.id, oldId)).run();
}

/** Replace a role's grants with the keys this install knows (an unknown key would break the FK). */
function setRolePermissions(tx: DbOrTx, roleId: string, keys: string[]): void {
  const known = keys.length
    ? tx
        .select({ key: permissions.key })
        .from(permissions)
        .where(inArray(permissions.key, keys))
        .all()
        .map((r) => r.key)
    : [];
  tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId)).run();
  if (known.length)
    tx.insert(rolePermissions)
      .values(known.map((permissionKey) => ({ roleId, permissionKey, fieldRules: null })))
      .run();
}

export const applyRole: EntityApplier = onlyFromHeadOffice((tx, change, env) => {
  const { event } = change;
  const p = payloadOf(change);
  if (!p) return 'skipped';
  const id = event.entityId;
  let current = tx.select().from(roles).where(eq(roles.id, id)).get();

  if (event.op === 'void') {
    if (!current || current.isSystem) return 'skipped';
    const held = tx
      .select({ u: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.roleId, id))
      .get();
    if (held) return 'skipped'; // still assigned here: keep it rather than strip someone's access
    tx.delete(rolePermissions).where(eq(rolePermissions.roleId, id)).run();
    tx.delete(roles).where(eq(roles.id, id)).run();
    return 'applied';
  }

  let created = false;
  if (!current) {
    const code = typeof p.code === 'string' ? p.code : null;
    if (!code) return 'skipped'; // an update for a role this PC never saw: malformed, never block the pull
    const sameCode = tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.tenantId, env.tenantId), eq(roles.code, code)))
      .get();
    if (sameCode) {
      rekeyRole(tx, sameCode.id, id);
    } else {
      const fields = roleFields(p);
      if (typeof fields.name !== 'string') return 'skipped';
      tx.insert(roles)
        .values({
          ...fields,
          name: fields.name,
          id,
          tenantId: env.tenantId,
          code,
          isSystem: p.isSystem === true,
          createdAt: typeof p.createdAt === 'string' ? p.createdAt : isoOfHlc(event.hlc),
          updatedAt: isoOfHlc(event.hlc),
          hlc: event.hlc,
          version: 1,
        })
        .run();
      created = true;
    }
    current = tx.select().from(roles).where(eq(roles.id, id)).get();
    if (!current) return 'skipped';
  }

  // Head Office wins every role field whatever the clocks say. Only an older copy of an event this
  // same Head Office device already applied is dropped (the stale rule of mergeFields).
  const staleCopy =
    !created && deviceOfHlc(event.hlc) === deviceOfHlc(current.hlc) && event.hlc <= current.hlc;
  const merge = mergeFields(current, roleFields(p), event.hlc, current.hlc, true, {
    price: ROLE_FIELDS,
  });
  const changed = Object.keys(merge.set).length > 0;
  const grants = isStringArray(p.permissions) && current.code !== 'super_admin' && !staleCopy;
  if (grants) setRolePermissions(tx, id, p.permissions as string[]);
  if (changed || grants)
    tx.update(roles)
      .set({
        ...merge.set,
        hlc: maxHlc(event.hlc, current.hlc),
        updatedAt: isoOfHlc(event.hlc),
        version: current.version + 1,
      })
      .where(eq(roles.id, id))
      .run();
  return resultOf(merge, created);
});

// ------------------------------------------------------------------------------------------ users

/** Login counters, lock-out and personal menu stay on each PC; everything else follows Head Office. */
const USER_SPEC = {
  username: 's',
  fullName: 's',
  email: 'sn',
  phone: 'sn',
  passwordHash: 's',
  pinHash: 'sn',
  totpSecretEnc: 'sn',
  language: 's',
  status: 's',
  mustChangePassword: 'b',
  deletedAt: 'sn',
} as const;

const mergeUser = simpleMasterApplier({
  table: users,
  spec: USER_SPEC,
  required: ['username', 'fullName', 'passwordHash'],
  rules: { price: Object.keys(USER_SPEC) },
  naturalKey: { field: 'username', column: users.username },
});

/** First free "<name>-local", "<name>-local2", ... for a local account that must give up its username. */
function freeLocalName(tx: DbOrTx, tenantId: string, username: string): string {
  for (let n = 1; ; n++) {
    const candidate = `${username}-local${n === 1 ? '' : n}`;
    const taken = tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.username, candidate)))
      .get();
    if (!taken) return candidate;
  }
}

/**
 * A Head Office account wins its username: a different local account with the same name (typically
 * the owner account typed while joining) is renamed to "<name>-local" and keeps working under that
 * name. Without this the Head Office account could never arrive, and its role and branch links would
 * wait for it forever.
 */
export const applyUser: EntityApplier = onlyFromHeadOffice((tx, change, env) => {
  const p = payloadOf(change);
  const username = typeof p?.username === 'string' ? p.username : null;
  const renamed: FieldConflictNote[] = [];
  if (username) {
    const clash = tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.tenantId, env.tenantId),
          eq(users.username, username),
          ne(users.id, change.event.entityId),
        ),
      )
      .get();
    if (clash) {
      const local = freeLocalName(tx, env.tenantId, username);
      tx.update(users).set({ username: local }).where(eq(users.id, clash.id)).run();
      renamed.push({
        field: 'username',
        reason: 'head_office_wins',
        kept: username,
        discarded: local,
      });
    }
  }
  const result = mergeUser(tx, change, env);
  if (renamed.length === 0) return result;
  const detail: ApplyDetail = typeof result === 'string' ? { outcome: result } : result;
  return { ...detail, outcome: 'conflict', conflicts: [...(detail.conflicts ?? []), ...renamed] };
});

// ------------------------------------------------------------------------ user roles and branches

function userIdOf(p: Record<string, unknown>): string | null {
  return typeof p.userId === 'string' ? p.userId : null;
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

/**
 * `insert`: one pair {userId, roleId} (a new user). `update`: the user's whole set {userId, roleIds}.
 * The ids are Head Office's; roles arrive first (APPLY_ORDER) and are re-keyed to them. Delivering
 * the same event again changes nothing and reports `skipped`.
 */
export const applyUserRoles: EntityApplier = onlyFromHeadOffice((tx, change, env): ApplyOutcome => {
  const p = change.event.payload as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return 'skipped';
  const userId = userIdOf(p);
  if (!userId) return 'skipped';
  requireRow(tx, env, users, 'users', userId);
  const held = () =>
    tx
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId))
      .all()
      .map((r) => r.roleId);
  if (change.event.op === 'update') {
    if (!isStringArray(p.roleIds)) return 'skipped';
    for (const roleId of p.roleIds) requireRow(tx, env, roles, 'roles', roleId);
    if (sameSet(held(), p.roleIds)) return 'skipped';
    tx.delete(userRoles).where(eq(userRoles.userId, userId)).run();
    for (const roleId of new Set(p.roleIds)) tx.insert(userRoles).values({ userId, roleId }).run();
    return 'applied';
  }
  if (typeof p.roleId !== 'string') return 'skipped';
  requireRow(tx, env, roles, 'roles', p.roleId);
  if (held().includes(p.roleId)) return 'skipped';
  tx.insert(userRoles).values({ userId, roleId: p.roleId }).run();
  return 'applied';
});

function requireBranch(tx: DbOrTx, env: ApplyEnv, branchId: string): void {
  requireRow(tx, env, branches, 'branches', branchId);
}

/** A user's branch scope as comparable keys ("*" = all branches). */
function scopeKeys(tx: DbOrTx, userId: string): string[] {
  return tx
    .select({ branchId: userBranches.branchId, all: userBranches.allBranches })
    .from(userBranches)
    .where(eq(userBranches.userId, userId))
    .all()
    .map((r) => (r.all ? '*' : String(r.branchId)));
}

/**
 * `insert`: one scope row {id, userId, branchId, allBranches}. `update`: the user's whole set
 * {userId, branchIds, allBranches}; local scope rows get local ids (they are not synced from here).
 * Delivering the same event again changes nothing and reports `skipped`.
 */
export const applyUserBranches: EntityApplier = onlyFromHeadOffice(
  (tx, change, env): ApplyOutcome => {
    const p = change.event.payload as Record<string, unknown> | null;
    if (!p || typeof p !== 'object') return 'skipped';
    const userId = userIdOf(p);
    if (!userId) return 'skipped';
    requireRow(tx, env, users, 'users', userId);
    const wall = isoOfHlc(change.event.hlc);
    const scope = (branchId: string | null, allBranches: boolean, id: string) => ({
      id,
      userId,
      branchId,
      allBranches,
      createdAt: wall,
      updatedAt: wall,
      hlc: change.event.hlc,
      version: 1,
    });

    if (change.event.op === 'update') {
      const all = p.allBranches === true;
      const ids = isStringArray(p.branchIds) ? p.branchIds : [];
      if (!all && ids.length === 0) return 'skipped';
      if (!all) for (const b of ids) requireBranch(tx, env, b);
      if (sameSet(scopeKeys(tx, userId), all ? ['*'] : ids)) return 'skipped';
      tx.delete(userBranches).where(eq(userBranches.userId, userId)).run();
      const rows = all
        ? [scope(null, true, `${change.event.id}:all`)]
        : ids.map((b, i) => scope(b, false, `${change.event.id}:${i}`));
      tx.insert(userBranches).values(rows).run();
      return 'applied';
    }

    const id = change.event.entityId;
    const branchId = typeof p.branchId === 'string' ? p.branchId : null;
    const all = p.allBranches === true;
    if (!all && !branchId) return 'skipped';
    if (branchId) requireBranch(tx, env, branchId);
    const exists = tx
      .select({ id: userBranches.id })
      .from(userBranches)
      .where(eq(userBranches.id, id))
      .get();
    if (exists) return 'skipped';
    tx.insert(userBranches)
      .values(scope(branchId, all, id))
      .run();
    return 'applied';
  },
);

registerApplier('roles', applyRole, { order: APPLY_ORDER.accounts });
registerApplier('users', applyUser, { order: APPLY_ORDER.accounts + 1 });
registerApplier('user_roles', applyUserRoles, { order: APPLY_ORDER.accounts + 2 });
registerApplier('user_branches', applyUserBranches, { order: APPLY_ORDER.accounts + 2 });
