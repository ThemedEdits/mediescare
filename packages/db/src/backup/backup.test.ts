import { randomBytes } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HybridLogicalClock } from '@mediescare/sync';
import { verifyAuditChain } from '../audit';
import { openDatabase, type OpenDatabase } from '../client';
import { runFirstRunSetup, type FirstRunResult } from '../firstRun';
import { runMigrations } from '../migrate';
import { users } from '../schema/sqlite';
import type { WriteContext } from '../context';
import {
  BackupError,
  createBackup,
  exportBackup,
  listBackups,
  readManifest,
  verifyBackup,
} from './backup';
import { issueRecoveryKey, readKeyring } from './keyring';
import {
  RecoveryKeyError,
  generateRecoveryKey,
  normalizeRecoveryKey,
  unwrapDbKey,
  wrapDbKey,
} from './recovery';
import { restoreBackup } from './restore';

let dir: string;
let dataDir: string;
let handle: OpenDatabase;
let keyHex: string;
let setup: FirstRunResult;

const ctx = (): WriteContext => ({
  tenantId: setup.tenantId,
  branchId: setup.branchId,
  deviceId: setup.deviceId,
  userId: setup.adminUserId,
  clock: new HybridLogicalClock('cafef00d'),
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mediescare-backup-'));
  dataDir = join(dir, 'data');
  keyHex = randomBytes(32).toString('hex');
  handle = openDatabase({ file: join(dataDir, 'mediescare.db'), keyHex });
  runMigrations(handle.db);
  setup = runFirstRunSetup(handle.db, {
    tenantName: 'Backup Test Group',
    branchCode: 'BKP01',
    branchName: 'Backup Branch',
    isHeadOffice: true,
    deviceName: 'Test Server',
    admin: { username: 'admin', fullName: 'Test Admin', passwordHash: '$argon2id$placeholder' },
  });
});

afterEach(() => {
  try {
    handle.close();
  } catch {
    /* closed by the test */
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('recovery key', () => {
  it('generates 32 characters in groups of four, all from the safe alphabet', () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(generateRecoveryKey()).not.toBe(key);
  });

  it('accepts what a person types (case, spaces, look-alike characters)', () => {
    const key = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789';
    expect(normalizeRecoveryKey('abcd efgh jkmn pqrs tvwx yz01 2345 6789')).toBe(
      key.replace(/-/g, ''),
    );
    expect(normalizeRecoveryKey('ABCD-EFGH-JKMN-PQRS-TVWX-YZOI-2345-6789')).toBe(
      normalizeRecoveryKey('ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789'),
    );
    expect(() => normalizeRecoveryKey('short')).toThrow(RecoveryKeyError);
    expect(() => normalizeRecoveryKey('U'.repeat(32))).toThrow(RecoveryKeyError);
  });

  it('wraps and unwraps the database key; a wrong key fails', () => {
    const recovery = generateRecoveryKey();
    const wrapped = wrapDbKey(keyHex, recovery);
    expect(JSON.stringify(wrapped)).not.toContain(keyHex);
    expect(unwrapDbKey(wrapped, recovery)).toBe(keyHex);
    expect(unwrapDbKey(wrapped, recovery.toLowerCase().replace(/-/g, ' '))).toBe(keyHex);
    expect(() => unwrapDbKey(wrapped, generateRecoveryKey())).toThrow(/does not match/);
  });

  it('detects a modified wrapped key', () => {
    const recovery = generateRecoveryKey();
    const wrapped = wrapDbKey(keyHex, recovery);
    const flipped = {
      ...wrapped,
      ct: Buffer.from(
        Buffer.from(wrapped.ct, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b)),
      ).toString('base64'),
    };
    expect(() => unwrapDbKey(flipped, recovery)).toThrow(RecoveryKeyError);
  });

  it('stores only the wrapped key in the keyring, never the recovery key', () => {
    const recovery = issueRecoveryKey(dataDir, keyHex);
    const raw = readFileSync(join(dataDir, 'keyring.json'), 'utf8');
    expect(raw).not.toContain(recovery.replace(/-/g, ''));
    expect(raw).not.toContain(keyHex);
    const wrapped = readKeyring(dataDir);
    expect(wrapped && unwrapDbKey(wrapped, recovery)).toBe(keyHex);
  });
});

describe('backup', () => {
  it('creates an encrypted, verified backup with a manifest and an audit entry', () => {
    const recovery = issueRecoveryKey(dataDir, keyHex);
    const backup = createBackup(handle, {
      dir: join(dir, 'backups'),
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: readKeyring(dataDir),
      ctx: ctx(),
    });
    const bytes = readFileSync(backup.path);
    expect(bytes.includes(Buffer.from('Backup Test Group'))).toBe(false);
    expect(bytes.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    expect(backup.integrity).toBe('ok');
    expect(readManifest(backup.path).sha256).toBe(backup.sha256);
    expect(listBackups(handle)).toHaveLength(1);
    expect(verifyBackup(backup.path, keyHex).file).toBe(backup.file);
    expect(verifyAuditChain(handle.db, setup.branchId).ok).toBe(true);
    expect(recovery).toBeTruthy();
  });

  it('detects a damaged backup file', () => {
    const backup = createBackup(handle, {
      dir: join(dir, 'backups'),
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: null,
    });
    appendFileSync(backup.path, 'tampered');
    expect(() => verifyBackup(backup.path, keyHex)).toThrow(/checksum/);
  });

  it('rejects the wrong key when verifying', () => {
    const backup = createBackup(handle, {
      dir: join(dir, 'backups'),
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: null,
    });
    expect(() => verifyBackup(backup.path, randomBytes(32).toString('hex'))).toThrow(BackupError);
  });

  it('keeps only the newest scheduled backups (rolling retention) and never prunes manual ones', () => {
    const backups = join(dir, 'backups');
    const base = Date.parse('2026-10-01T00:00:00Z');
    createBackup(handle, {
      dir: backups,
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: null,
      now: new Date(base),
    });
    for (let i = 1; i <= 5; i++) {
      createBackup(handle, {
        dir: backups,
        kind: 'scheduled',
        dbKeyHex: keyHex,
        wrappedKey: null,
        now: new Date(base + i * 86_400_000),
        keepScheduled: 3,
      });
    }
    const files = readdirSync(backups).filter((f) => f.endsWith('.mcbak'));
    expect(files.filter((f) => f.includes('-scheduled'))).toHaveLength(3);
    expect(files.filter((f) => f.includes('-manual'))).toHaveLength(1);
    expect(files.some((f) => f.includes('20261002'))).toBe(false); // oldest scheduled removed
    expect(readdirSync(backups).filter((f) => f.endsWith('.json'))).toHaveLength(4);
  });

  it('exports to another folder and verifies the copy', () => {
    const backup = createBackup(handle, {
      dir: join(dir, 'backups'),
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: null,
    });
    const copy = exportBackup(backup.path, join(dir, 'usb-drive'));
    expect(existsSync(copy)).toBe(true);
    expect(verifyBackup(copy, keyHex).sha256).toBe(backup.sha256);
  });

  it('does not leave partial files behind when a backup cannot be verified', () => {
    const backups = join(dir, 'backups');
    expect(() =>
      createBackup(handle, {
        dir: backups,
        kind: 'manual',
        dbKeyHex: randomBytes(32).toString('hex'),
        wrappedKey: null,
      }),
    ).toThrow(BackupError);
    expect(readdirSync(backups)).toEqual([]);
  });
});

describe('restore', () => {
  it('restores on a different PC using only the recovery key, and the data and audit chain survive', () => {
    const recovery = issueRecoveryKey(dataDir, keyHex);
    const backup = createBackup(handle, {
      dir: join(dir, 'backups'),
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: readKeyring(dataDir),
      ctx: ctx(),
    });
    handle.close();

    const newPc = join(dir, 'new-pc', 'mediescare.db');
    const result = restoreBackup({
      backupPath: backup.path,
      targetDbFile: newPc,
      safetyDir: join(dir, 'new-pc', 'safety'),
      recoveryKey: recovery,
    });
    expect(result.dbKeyHex).toBe(keyHex);
    expect(result.safetyCopy).toBeNull();

    const restored = openDatabase({ file: newPc, keyHex: result.dbKeyHex });
    expect(
      restored.db
        .select()
        .from(users)
        .all()
        .map((u) => u.username),
    ).toEqual(['admin']);
    expect(verifyAuditChain(restored.db, setup.branchId)).toMatchObject({ ok: true });
    restored.close();
    handle = openDatabase({ file: join(dataDir, 'mediescare.db'), keyHex });
  });

  it('refuses a wrong recovery key and leaves the current database untouched', () => {
    issueRecoveryKey(dataDir, keyHex);
    const backup = createBackup(handle, {
      dir: join(dir, 'backups'),
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: readKeyring(dataDir),
    });
    const live = join(dataDir, 'mediescare.db');
    handle.close();
    const before = readFileSync(live);
    expect(() =>
      restoreBackup({
        backupPath: backup.path,
        targetDbFile: live,
        safetyDir: join(dir, 'safety'),
        recoveryKey: generateRecoveryKey(),
      }),
    ).toThrow(/does not match/);
    expect(readFileSync(live).equals(before)).toBe(true);
    handle = openDatabase({ file: live, keyHex });
  });

  it('refuses a damaged backup before touching the live database', () => {
    const backup = createBackup(handle, {
      dir: join(dir, 'backups'),
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: null,
    });
    appendFileSync(backup.path, 'x');
    const live = join(dataDir, 'mediescare.db');
    handle.close();
    const before = readFileSync(live);
    expect(() =>
      restoreBackup({
        backupPath: backup.path,
        targetDbFile: live,
        safetyDir: join(dir, 'safety'),
        dbKeyHex: keyHex,
      }),
    ).toThrow(/checksum/);
    expect(readFileSync(live).equals(before)).toBe(true);
    handle = openDatabase({ file: live, keyHex });
  });

  it('keeps a safety copy of the replaced database and removes stale WAL files', () => {
    const backup = createBackup(handle, {
      dir: join(dir, 'backups'),
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: null,
    });
    const live = join(dataDir, 'mediescare.db');
    handle.close();
    writeFileSync(`${live}-wal`, 'stale');
    const result = restoreBackup({
      backupPath: backup.path,
      targetDbFile: live,
      safetyDir: join(dir, 'safety'),
      dbKeyHex: keyHex,
    });
    expect(result.safetyCopy && existsSync(result.safetyCopy)).toBe(true);
    expect(existsSync(`${live}-wal`)).toBe(false);
    handle = openDatabase({ file: live, keyHex });
    expect(handle.db.select().from(users).all()).toHaveLength(1);
  });

  it('asks for the recovery key when none is provided', () => {
    const backup = createBackup(handle, {
      dir: join(dir, 'backups'),
      kind: 'manual',
      dbKeyHex: keyHex,
      wrappedKey: null,
    });
    expect(() =>
      restoreBackup({ backupPath: backup.path, targetDbFile: join(dir, 'x.db'), safetyDir: dir }),
    ).toThrow(RecoveryKeyError);
  });
});
