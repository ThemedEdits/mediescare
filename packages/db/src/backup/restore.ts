import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { BackupError, readManifest, sha256File, checkDatabaseFile } from './backup';
import { RecoveryKeyError, unwrapDbKey } from './recovery';

export interface RestoreOptions {
  backupPath: string;
  /** The live database file to replace. The app (and its server) must be stopped. */
  targetDbFile: string;
  /** Folder for the safety copy of the database being replaced. */
  safetyDir: string;
  /** Same PC: the database key is known. Other PC or lost profile: give the recovery key instead. */
  dbKeyHex?: string;
  recoveryKey?: string;
  now?: Date;
}

export interface RestoreResult {
  /** Key that opens the restored database. The caller must store it (Electron wraps it with DPAPI). */
  dbKeyHex: string;
  safetyCopy: string | null;
}

/**
 * Replace the live database with a verified backup. Order matters: verify everything first, keep a
 * safety copy of the current database, and only then swap files. If anything fails before the swap
 * the current database is untouched.
 */
export function restoreBackup(options: RestoreOptions): RestoreResult {
  const manifest = readManifest(options.backupPath);
  if (!existsSync(options.backupPath)) throw new BackupError('Backup file is missing');

  let keyHex = options.dbKeyHex;
  if (!keyHex) {
    if (!options.recoveryKey)
      throw new RecoveryKeyError('Enter the recovery key to restore this backup');
    if (!manifest.wrappedKey)
      throw new RecoveryKeyError(
        'This backup has no recovery key data. Restore it on the original PC',
      );
    keyHex = unwrapDbKey(manifest.wrappedKey, options.recoveryKey);
  }

  if (sha256File(options.backupPath) !== manifest.sha256) {
    throw new BackupError('Backup checksum does not match: the file was changed or damaged');
  }
  checkDatabaseFile(options.backupPath, keyHex);

  let safetyCopy: string | null = null;
  if (existsSync(options.targetDbFile)) {
    mkdirSync(options.safetyDir, { recursive: true });
    const stamp = (options.now ?? new Date())
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\..+/, '')
      .replace('T', '-');
    safetyCopy = join(options.safetyDir, `before-restore-${stamp}.db`);
    copyFileSync(options.targetDbFile, safetyCopy);
  }

  mkdirSync(dirname(options.targetDbFile), { recursive: true });
  // Stale WAL/SHM files belong to the old database and would corrupt the restored one.
  for (const suffix of ['-wal', '-shm'])
    rmSync(`${options.targetDbFile}${suffix}`, { force: true });
  copyFileSync(options.backupPath, options.targetDbFile);
  return { dbKeyHex: keyHex, safetyCopy };
}
