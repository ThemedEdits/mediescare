import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { count, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, ROLE_CODES, can } from '@mediescare/core';
import { HybridLogicalClock, type CloudAdapter, type PushRequest } from '@mediescare/sync';
import { appendAudit, verifyAuditChain } from './audit';
import { AuthError, login, MAX_FAILED_LOGINS } from './auth/login';
import { hashPassword, checkPasswordPolicy } from './auth/password';
import { createSession, revokeSession, signSessionToken, touchSession, verifySessionToken } from './auth/session';
import { loadAccessContext } from './auth/access';
import { DatabaseKeyError, openDatabase, type Db, type OpenDatabase } from './client';
import { AlreadyInitializedError, isInitialized, runFirstRunSetup, type FirstRunResult } from './firstRun';
import { runMigrations } from './migrate';
import { recordChange } from './outbox';
import { auditLog, permissions, roles, sessions, syncOutbox, users } from './schema/sqlite';
import { getSyncStatus, pushOutbox } from './syncWorker';
import type { WriteContext } from './context';

const PASSWORD = 'correct-Horse-battery-9';
const SECRET = 'test-secret-test-secret-test-secret';

let dir: string;
let file: string;
let keyHex: string;
let handle: OpenDatabase;
let db: Db;
let setup: FirstRunResult;
let clockMs: number;

const fixedNow = () => new Date(clockMs);
const ctx = (over: Partial<WriteContext> = {}): WriteContext => ({
  tenantId: setup.tenantId,
  branchId: setup.branchId,
  deviceId: setup.deviceId,
  userId: setup.adminUserId,
  clock: new HybridLogicalClock('feedbeef', () => clockMs),
  now: fixedNow,
  ...over,
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'mediescare-test-'));
  file = join(dir, 'test.db');
  keyHex = randomBytes(32).toString('hex');
  clockMs = Date.parse('2026-09-30T10:00:00.000Z');
  handle = openDatabase({ file, keyHex });
  db = handle.db;
  runMigrations(db);
  setup = runFirstRunSetup(db, {
    tenantName: 'Test Pharmacy Group',
    branchCode: 'KHI01',
    branchName: 'Test Branch One',
    isHeadOffice: true,
    deviceName: 'Test Server',
    admin: { username: 'admin', fullName: 'Test Admin', passwordHash: await hashPassword(PASSWORD) },
    now: fixedNow,
  });
});

afterEach(() => {
  try {
    handle.close();
  } catch {
    /* already closed by the test */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('encryption at rest (ADR-0001)', () => {
  it('writes no readable data to disk and rejects a wrong key', () => {
    handle.raw.pragma('wal_checkpoint(TRUNCATE)');
    handle.close();
    const bytes = readFileSync(file);
    expect(bytes.includes(Buffer.from('Test Pharmacy Group'))).toBe(false);
    expect(bytes.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');

    expect(() => openDatabase({ file, keyHex: randomBytes(32).toString('hex') })).toThrow(DatabaseKeyError);
    expect(() => openDatabase({ file })).toThrow(DatabaseKeyError);

    handle = openDatabase({ file, keyHex });
    expect(isInitialized(handle.db)).toBe(true);
  });

  it('rejects a malformed key before touching the file', () => {
    expect(() => openDatabase({ file: join(dir, 'x.db'), keyHex: 'abc' })).toThrow(DatabaseKeyError);
  });

  it('uses WAL and full synchronous writes', () => {
    expect(handle.raw.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(handle.raw.pragma('synchronous', { simple: true })).toBe(2);
    expect(handle.raw.pragma('foreign_keys', { simple: true })).toBe(1);
  });
});

describe('first-run setup', () => {
  it('creates the catalogue, all default roles, and a Super Admin with all-branch scope', () => {
    expect(db.select({ n: count() }).from(permissions).get()?.n).toBe(ALL_PERMISSIONS.length);
    expect(db.select({ n: count() }).from(roles).get()?.n).toBe(ROLE_CODES.length);
    const access = loadAccessContext(db, setup.adminUserId);
    expect(access?.allBranches).toBe(true);
    expect(access && can(access, 'admin.user.delete', setup.branchId)).toBe(true);
    expect(access?.permissions.size).toBe(ALL_PERMISSIONS.length);
    expect(setup.sampleDocNo).toBe('KHI01-INV-000001');
  });

  it('never stores the password in clear text', () => {
    const row = db.select().from(users).where(eq(users.id, setup.adminUserId)).get();
    expect(row?.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(JSON.stringify(db.select().from(syncOutbox).all())).not.toContain(PASSWORD);
  });

  it('queues every synced row for the cloud and writes a verifiable audit chain', () => {
    const types = new Set(db.select().from(syncOutbox).all().map((r) => r.entityType));
    for (const t of ['tenants', 'branches', 'stores', 'devices', 'roles', 'users', 'user_roles', 'user_branches']) {
      expect(types.has(t)).toBe(true);
    }
    expect(verifyAuditChain(db, setup.branchId)).toEqual({ ok: true, count: 1 });
  });

  it('refuses to run twice', () => {
    expect(() =>
      runFirstRunSetup(db, {
        tenantName: 'Again', branchCode: 'KHI02', branchName: 'Again', isHeadOffice: false,
        deviceName: 'x', admin: { username: 'x', fullName: 'x', passwordHash: 'x' },
      }),
    ).toThrow(AlreadyInitializedError);
  });
});

describe('audit log', () => {
  it('chains entries and detects tampering done outside the app', () => {
    appendAudit(db, ctx(), { action: 'settings.update', entityType: 'settings', entityId: 's1', oldValue: { a: 1 }, newValue: { a: 2 } });
    appendAudit(db, ctx(), { action: 'settings.update', entityType: 'settings', entityId: 's1', oldValue: { a: 2 }, newValue: { a: 3 } });
    expect(verifyAuditChain(db, setup.branchId)).toEqual({ ok: true, count: 3 });

    // Simulate someone bypassing the triggers with a low-level edit.
    handle.raw.exec('DROP TRIGGER audit_log_no_update');
    handle.raw.exec(`UPDATE audit_log SET new_json = '{"a":999}' WHERE seq = 2`);
    expect(verifyAuditChain(db, setup.branchId)).toMatchObject({ ok: false, brokenAtSeq: 2 });
  });

  it('cannot be updated or deleted (database triggers)', () => {
    expect(() => db.update(auditLog).set({ action: 'x' }).run()).toThrow(/append-only/);
    expect(() => db.delete(auditLog).run()).toThrow(/append-only/);
  });
});

describe('outbox', () => {
  it('commits or rolls back the change, its outbox row and its audit row together', () => {
    const before = db.select({ n: count() }).from(syncOutbox).get()?.n ?? 0;
    const auditBefore = db.select({ n: count() }).from(auditLog).get()?.n ?? 0;
    expect(() =>
      db.transaction((tx) => {
        recordChange(tx, ctx(), { entityType: 'settings', entityId: 's1', op: 'update', payload: { a: 1 } });
        appendAudit(tx, ctx(), { action: 'settings.update', entityType: 'settings', entityId: 's1' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.select({ n: count() }).from(syncOutbox).get()?.n).toBe(before);
    expect(db.select({ n: count() }).from(auditLog).get()?.n).toBe(auditBefore);
  });

  it('numbers events consecutively', () => {
    db.transaction((tx) => {
      recordChange(tx, ctx(), { entityType: 'settings', entityId: 'a', op: 'insert', payload: {} });
      recordChange(tx, ctx(), { entityType: 'settings', entityId: 'b', op: 'insert', payload: {} });
    });
    const seqs = db.select({ seq: syncOutbox.seq }).from(syncOutbox).orderBy(syncOutbox.seq).all().map((r) => r.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });
});

describe('login and sessions', () => {
  it('logs in, issues a verifiable token, audits it, and records last login', async () => {
    const result = await login(db, ctx({ userId: null }), { username: 'admin', password: PASSWORD }, SECRET);
    expect(result.user.username).toBe('admin');
    expect(await verifySessionToken(result.token, SECRET)).toEqual({ sid: result.sessionId, uid: setup.adminUserId });
    expect(await verifySessionToken(result.token, 'wrong-secret-wrong-secret-wrong-secret')).toBeNull();
    expect(await verifySessionToken(`${result.token}x`, SECRET)).toBeNull();
    expect(db.select().from(auditLog).all().some((a) => a.action === 'auth.login.success')).toBe(true);
    expect(db.select().from(users).where(eq(users.id, setup.adminUserId)).get()?.lastLoginAt).toBe(fixedNow().toISOString());
    expect(verifyAuditChain(db, setup.branchId).ok).toBe(true);
  });

  it('gives the same error for an unknown user and a wrong password', async () => {
    const wrong = await login(db, ctx(), { username: 'admin', password: 'nope-nope-nope' }, SECRET).catch((e: unknown) => e);
    const unknown = await login(db, ctx(), { username: 'ghost', password: 'nope-nope-nope' }, SECRET).catch((e: unknown) => e);
    expect(wrong).toBeInstanceOf(AuthError);
    expect(unknown).toBeInstanceOf(AuthError);
    expect((wrong as AuthError).message).toBe((unknown as AuthError).message);
    expect((wrong as AuthError).code).toBe('INVALID_CREDENTIALS');
  });

  it('records failures in the audit log (the audit rows survive the failed login)', async () => {
    await login(db, ctx(), { username: 'admin', password: 'bad-bad-bad-bad' }, SECRET).catch(() => undefined);
    const failed = db.select().from(auditLog).all().filter((a) => a.action === 'auth.login.failed');
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed)).not.toContain('bad-bad-bad-bad');
  });

  it('locks the account after repeated failures, even for the right password, then unlocks', async () => {
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) {
      await login(db, ctx(), { username: 'admin', password: 'bad-bad-bad-bad' }, SECRET).catch(() => undefined);
    }
    const locked = await login(db, ctx(), { username: 'admin', password: PASSWORD }, SECRET).catch((e: unknown) => e);
    expect((locked as AuthError).code).toBe('LOCKED');

    clockMs += 16 * 60 * 1000;
    const ok = await login(db, ctx(), { username: 'admin', password: PASSWORD }, SECRET);
    expect(ok.user.username).toBe('admin');
  });

  it('refuses a disabled user', async () => {
    db.update(users).set({ status: 'disabled' }).where(eq(users.id, setup.adminUserId)).run();
    const err = await login(db, ctx(), { username: 'admin', password: PASSWORD }, SECRET).catch((e: unknown) => e);
    expect((err as AuthError).code).toBe('DISABLED');
    expect(loadAccessContext(db, setup.adminUserId)).toBeNull();
  });

  it('expires idle sessions and honours revocation', () => {
    const sid = createSession(db, { userId: setup.adminUserId, branchId: setup.branchId, deviceId: null, now: fixedNow() });
    expect(touchSession(db, sid, fixedNow())).not.toBeNull();
    expect(touchSession(db, sid, new Date(clockMs + 29 * 60 * 1000))).not.toBeNull(); // slides the timer
    expect(touchSession(db, sid, new Date(clockMs + 29 * 60 * 1000 + 31 * 60 * 1000))).toBeNull(); // idle > 30 min
    const sid2 = createSession(db, { userId: setup.adminUserId, branchId: setup.branchId, deviceId: null, now: fixedNow() });
    revokeSession(db, sid2, fixedNow());
    expect(touchSession(db, sid2, fixedNow())).toBeNull();
    expect(db.select({ n: count() }).from(sessions).where(isNull(sessions.revokedAt)).get()?.n).toBeGreaterThan(0);
  });

  it('rejects an expired token', async () => {
    const token = await signSessionToken({ sid: 's', uid: 'u' }, SECRET, -10);
    expect(await verifySessionToken(token, SECRET)).toBeNull();
  });
});

describe('password policy', () => {
  it('enforces length, common passwords and username reuse', () => {
    expect(checkPasswordPolicy('short').ok).toBe(false);
    expect(checkPasswordPolicy('password123').ok).toBe(false);
    expect(checkPasswordPolicy('xx-admin-xx-yy', 'admin').ok).toBe(false);
    expect(checkPasswordPolicy('aaaaaaaaaaaa').ok).toBe(false);
    expect(checkPasswordPolicy(PASSWORD, 'admin').ok).toBe(true);
  });
});

describe('outbox push worker', () => {
  const okAdapter = (calls: PushRequest[]): CloudAdapter => ({
    push: async (req) => {
      calls.push(req);
      return { results: req.events.map((e) => ({ id: e.id, status: 'applied' as const })) };
    },
  });

  it('pushes everything, marks it acknowledged, and is a no-op the second time', async () => {
    const before = getSyncStatus(db);
    expect(before.pending).toBeGreaterThan(0);
    const calls: PushRequest[] = [];
    const first = await pushOutbox(db, okAdapter(calls), { now: fixedNow });
    expect(first).toMatchObject({ acked: before.pending, rejected: 0, offline: false });
    expect(calls[0]?.idempotencyKey).toBe(calls[0]?.events[0]?.id);
    expect(getSyncStatus(db).pending).toBe(0);
    expect(await pushOutbox(db, okAdapter(calls), { now: fixedNow })).toMatchObject({ sent: 0 });
  });

  it('keeps events and backs off when the network fails, then succeeds on retry', async () => {
    const down: CloudAdapter = { push: async () => { throw new Error('ECONNREFUSED'); } };
    const pending = getSyncStatus(db).pending;
    const r1 = await pushOutbox(db, down, { now: fixedNow, random: () => 0.5 });
    expect(r1).toMatchObject({ offline: true, acked: 0 });
    expect(getSyncStatus(db).pending).toBe(pending); // nothing lost

    // Not due yet: the worker leaves them alone.
    const calls: PushRequest[] = [];
    expect(await pushOutbox(db, okAdapter(calls), { now: fixedNow })).toMatchObject({ sent: 0 });

    clockMs += 60_000;
    const r2 = await pushOutbox(db, okAdapter(calls), { now: fixedNow });
    expect(r2).toMatchObject({ acked: pending, offline: false });
  });

  it('parks rejected events in the error queue without blocking the rest', async () => {
    const rejecting: CloudAdapter = {
      push: async (req) => ({
        results: req.events.map((e, i) =>
          i === 0 ? { id: e.id, status: 'rejected' as const, reason: 'unknown entity' } : { id: e.id, status: 'duplicate' as const },
        ),
      }),
    };
    await pushOutbox(db, rejecting, { now: fixedNow });
    const status = getSyncStatus(db);
    expect(status.rejected).toBe(1);
    expect(status.pending).toBe(0);
  });

  it('never sends the same event twice in one batch and respects the batch size', async () => {
    const calls: PushRequest[] = [];
    await pushOutbox(db, okAdapter(calls), { now: fixedNow, batchSize: 3 });
    expect(calls[0]?.events).toHaveLength(3);
    const ids = new Set(calls[0]?.events.map((e) => e.id));
    expect(ids.size).toBe(3);
    const seqs = calls[0]?.events.map((e) => e.seq) ?? [];
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });
});
