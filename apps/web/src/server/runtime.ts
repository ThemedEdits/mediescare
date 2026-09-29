import { join, resolve } from 'node:path';
import { parseRuntimeMode, type RuntimeMode } from '@mediescare/config';
import {
  defaultMigrationsDir,
  getServerIdentity,
  hlcDeviceId,
  isInitialized,
  openDatabase,
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
  clock?: HybridLogicalClock;
  identity?: ServerIdentity;
}

// Kept on globalThis so dev-server hot reloads do not open the database twice.
const holder = globalThis as unknown as { __mediescareRuntime?: Runtime };

function requireEnv(name: string, minLength: number): string {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(`${name} is not set (or too short). The desktop shell sets it, or copy .env.example for development.`);
  }
  return value;
}

/** Opens the branch database once per process. Terminals and cloud mode do not use the local database. */
export function getRuntime(): Runtime {
  if (holder.__mediescareRuntime) return holder.__mediescareRuntime;
  const mode = parseRuntimeMode(process.env.MEDIESCARE_MODE);
  if (mode === 'terminal') throw new Error('Terminals hold no data. They connect to the branch server.');
  if (mode === 'cloud') throw new Error('Cloud mode is not implemented yet (Phase 3).');

  // Dynamic runtime path: tell the bundler not to trace the whole project for it.
  const dataDir = resolve(/*turbopackIgnore: true*/ process.env.MEDIESCARE_DATA_DIR ?? './data');
  const handle = openDatabase({
    file: join(dataDir, 'mediescare.db'),
    keyHex: requireEnv('MEDIESCARE_DB_KEY', 64),
  });
  runMigrations(handle.db, process.env.MEDIESCARE_MIGRATIONS_DIR ?? defaultMigrationsDir());
  const runtime: Runtime = { mode, handle, sessionSecret: requireEnv('MEDIESCARE_SESSION_SECRET', 32) };
  holder.__mediescareRuntime = runtime;
  return runtime;
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
