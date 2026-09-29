import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { desc, eq } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { OpenDatabase } from '../client';
import type { WriteContext } from '../context';
import { backups } from '../schema/sqlite';
import type { WrappedKey } from './recovery';

export type BackupKind = 'scheduled' | 'manual' | 'pre_migration' | 'pre_restore';

/** Small JSON file stored next to each backup. Holds what is needed to verify and to restore. */
export interface BackupManifest {
  v: 1;
  app: string;
  file: string;
  sha256: string;
  sizeBytes: number;
  kind: BackupKind;
  createdAt: string;
  /** The database key wrapped with the recovery key, so the backup opens on another PC. */
  wrappedKey: WrappedKey | null;
  integrity: 'ok';
}

export const BACKUP_EXTENSION = '.mcbak';
export const DEFAULT_KEEP_SCHEDULED = 14;

export class BackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

const stamp = (d: Date) =>
  d.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');

export function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Open a database file with a key and confirm it is a healthy Mediescare database. */
export function checkDatabaseFile(file: string, keyHex: string): void {
  const raw = new Database(file, { readonly: true });
  try {
    raw.pragma(`cipher='sqlcipher'`);
    raw.pragma(`key="x'${keyHex}'"`);
    const integrity = raw.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok')
      throw new BackupError(`Database integrity check failed: ${String(integrity)}`);
    raw.prepare('SELECT count(*) FROM tenants').get();
  } catch (error) {
    if (error instanceof BackupError) throw error;
    throw new BackupError(
      'The file cannot be opened with this key, or it is not a Mediescare database',
    );
  } finally {
    raw.close();
  }
}

export interface CreateBackupOptions {
  dir: string;
  kind: BackupKind;
  dbKeyHex: string;
  wrappedKey: WrappedKey | null;
  ctx?: WriteContext;
  now?: Date;
  /** Keep this many newest scheduled backups. Manual and safety backups are never pruned. */
  keepScheduled?: number;
}

/**
 * Snapshot the live database with VACUUM INTO. The copy stays encrypted with the same key
 * (checked in tests), is verified by reopening it, and gets a manifest with a SHA-256.
 */
export function createBackup(
  handle: OpenDatabase,
  options: CreateBackupOptions,
): BackupManifest & { path: string } {
  mkdirSync(options.dir, { recursive: true });
  const now = options.now ?? new Date();
  const name = `mediescare-${stamp(now)}-${options.kind}${BACKUP_EXTENSION}`;
  const finalPath = join(options.dir, name);
  const tempPath = `${finalPath}.partial`;
  rmSync(tempPath, { force: true });
  if (existsSync(finalPath)) throw new BackupError(`Backup already exists: ${name}`);

  try {
    handle.raw.exec(`VACUUM INTO '${tempPath.replace(/'/g, "''")}'`);
    checkDatabaseFile(tempPath, options.dbKeyHex);
    renameSync(tempPath, finalPath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }

  const manifest: BackupManifest = {
    v: 1,
    app: 'Mediescare',
    file: name,
    sha256: sha256File(finalPath),
    sizeBytes: statSync(finalPath).size,
    kind: options.kind,
    createdAt: now.toISOString(),
    wrappedKey: options.wrappedKey,
    integrity: 'ok',
  };
  writeFileSync(`${finalPath}.json`, JSON.stringify(manifest, null, 2), 'utf8');

  handle.db.transaction((tx) => {
    tx.insert(backups)
      .values({
        id: newId(),
        path: finalPath,
        sizeBytes: manifest.sizeBytes,
        sha256: manifest.sha256,
        kind: options.kind,
        createdAt: manifest.createdAt,
        verifiedAt: manifest.createdAt,
      })
      .run();
    if (options.ctx) {
      appendAudit(tx, options.ctx, {
        action: 'backup.create',
        entityType: 'backup',
        entityId: name,
        newValue: { kind: options.kind, sizeBytes: manifest.sizeBytes, sha256: manifest.sha256 },
      });
    }
  });

  if (options.kind === 'scheduled')
    pruneScheduled(handle, options.dir, options.keepScheduled ?? DEFAULT_KEEP_SCHEDULED);
  return { ...manifest, path: finalPath };
}

/** Delete scheduled backups beyond the newest `keep` (rolling retention). Returns deleted file names. */
export function pruneScheduled(handle: OpenDatabase, dir: string, keep: number): string[] {
  const scheduled = readdirSync(dir)
    .filter((f) => f.endsWith(`-scheduled${BACKUP_EXTENSION}`))
    .sort()
    .reverse();
  const doomed = scheduled.slice(keep);
  for (const file of doomed) {
    rmSync(join(dir, file), { force: true });
    rmSync(join(dir, `${file}.json`), { force: true });
    handle.db
      .delete(backups)
      .where(eq(backups.path, join(dir, file)))
      .run();
  }
  return doomed;
}

export function listBackups(handle: OpenDatabase, limit = 50) {
  return handle.db.select().from(backups).orderBy(desc(backups.createdAt)).limit(limit).all();
}

/** Re-verify a stored backup: file present, checksum matches, opens with the key, integrity ok. */
export function verifyBackup(backupPath: string, keyHex: string): BackupManifest {
  const manifest = readManifest(backupPath);
  if (!existsSync(backupPath)) throw new BackupError('Backup file is missing');
  if (sha256File(backupPath) !== manifest.sha256)
    throw new BackupError('Backup checksum does not match: the file was changed or damaged');
  checkDatabaseFile(backupPath, keyHex);
  return manifest;
}

export function readManifest(backupPath: string): BackupManifest {
  const file = `${backupPath}.json`;
  if (!existsSync(file))
    throw new BackupError('Backup manifest (.json) is missing next to the backup file');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as BackupManifest;
  if (manifest.v !== 1) throw new BackupError('Unsupported backup format');
  return manifest;
}

/** Copy a backup and its manifest to another folder, for example an external drive. */
export function exportBackup(backupPath: string, destDir: string): string {
  mkdirSync(destDir, { recursive: true });
  const target = join(destDir, basename(backupPath));
  copyFileSync(backupPath, target);
  copyFileSync(`${backupPath}.json`, `${target}.json`);
  if (sha256File(target) !== readManifest(target).sha256) {
    rmSync(target, { force: true });
    rmSync(`${target}.json`, { force: true });
    throw new BackupError('The copy on the destination drive does not match. Try another drive.');
  }
  return target;
}
