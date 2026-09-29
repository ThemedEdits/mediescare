import { join, resolve } from 'node:path';
import { parseRuntimeMode, type RuntimeMode } from '@mediescare/config';
import {
  createBackup,
  defaultMigrationsDir,
  getServerIdentity,
  hlcDeviceId,
  isInitialized,
  listBackups,
  openDatabase,
  pendingMigrationCount,
  readKeyring,
  runMigrations,
  type Db,
  type OpenDatabase,
  type ServerIdentity,
  type WriteContext,
} from '@mediescare/db';
import { HybridLogicalClock } from '@mediescare/sync';

interface Runtime {
  mode: RuntimeMode;
  handle: OpenDatabase;
  sessionSecret: string;
  dataDir: string;
  backupDir: string;
  dbKeyHex: string;
  clock?: HybridLogicalClock;
  identity?: ServerIdentity;
  jobs?: NodeJS.Timeout;
}

// Kept on globalThis so dev-server hot reloads do not open the database twice.
const holder = globalThis as unknown as { __mediescareRuntime?: Runtime };

const DAY_MS = 24 * 60 * 60 * 1000;

function requireEnv(name: string, minLength: number): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(
      `${name} is not set (or too short). The desktop shell sets it, or copy .env.example for development.`,
    );
  }
  return value;
}

/** Opens the branch database once per process. Terminals and cloud mode do not use the local database. */
export function getRuntime(): Runtime {
  if (holder.__mediescareRuntime) return holder.__mediescareRuntime;
  const mode = parseRuntimeMode(process.env.MEDIESCARE_MODE);
  if (mode === 'terminal')
    throw new Error('Terminals hold no data. They connect to the branch server.');
  if (mode === 'cloud') throw new Error('Cloud mode is not implemented yet (Phase 3).');

  // Dynamic runtime paths: tell the bundler not to trace the whole project for them.
  const dataDir = resolve(/*turbopackIgnore: true*/ process.env.MEDIESCARE_DATA_DIR ?? './data');
  const backupDir = resolve(
    /*turbopackIgnore: true*/ process.env.MEDIESCARE_BACKUP_DIR ?? join(dataDir, '..', 'backups'),
  );
  const dbKeyHex = requireEnv('MEDIESCARE_DB_KEY', 64);
  const handle = openDatabase({ file: join(dataDir, 'mediescare.db'), keyHex: dbKeyHex });
  const migrationsDir = process.env.MEDIESCARE_MIGRATIONS_DIR ?? defaultMigrationsDir();

  // Safety copy before any schema change on an existing database (forward-only migrations).
  if (isInitialized(handle.db) && pendingMigrationCount(handle.db, migrationsDir) > 0) {
    createBackup(handle, {
      dir: backupDir,
      kind: 'pre_migration',
      dbKeyHex,
      wrappedKey: readKeyring(dataDir),
    });
  }
  runMigrations(handle.db, migrationsDir);

  const runtime: Runtime = {
    mode,
    handle,
    sessionSecret: requireEnv('MEDIESCARE_SESSION_SECRET', 32),
    dataDir,
    backupDir,
    dbKeyHex,
  };
  holder.__mediescareRuntime = runtime;
  startBackgroundJobs(runtime);
  return runtime;
}

/** Automatic daily backup. Checked every 15 minutes; never blocks a request. */
function startBackgroundJobs(runtime: Runtime): void {
  if (runtime.jobs || process.env.MEDIESCARE_DISABLE_JOBS === '1') return;
  const tick = () => {
    try {
      if (!isInitialized(runtime.handle.db)) return;
      const latest = listBackups(runtime.handle, 200).find((b) => b.kind === 'scheduled');
      if (latest && Date.now() - Date.parse(latest.createdAt) < DAY_MS) return;
      createBackup(runtime.handle, {
        dir: runtime.backupDir,
        kind: 'scheduled',
        dbKeyHex: runtime.dbKeyHex,
        wrappedKey: readKeyring(runtime.dataDir),
        ctx: writeContext(null),
      });
    } catch (error) {
      console.error(
        '[backup] scheduled backup failed:',
        error instanceof Error ? error.message : 'unknown',
      );
    }
  };
  runtime.jobs = setInterval(tick, 15 * 60 * 1000);
  runtime.jobs.unref();
  setTimeout(tick, 30_000).unref();
}

export function getDb(): Db {
  return getRuntime().handle.db;
}

export function getSessionSecret(): string {
  return getRuntime().sessionSecret;
}

export function initialized(): boolean {
  return isInitialized(getDb());
}

/** Identity of this branch server, read from the database after first-run setup. */
export function getIdentity(): ServerIdentity {
  const runtime = getRuntime();
  if (runtime.identity) return runtime.identity;
  const identity = getServerIdentity(runtime.handle.db);
  if (!identity) throw new Error('This server has not been set up yet');
  runtime.identity = identity;
  runtime.clock = new HybridLogicalClock(hlcDeviceId(identity.deviceId));
  return identity;
}

/** Build the write context (who, where, which clock) for a request made by `userId`. */
export function writeContext(userId: string | null): WriteContext {
  const identity = getIdentity();
  const runtime = getRuntime();
  return { ...identity, userId, clock: runtime.clock as HybridLogicalClock };
}
