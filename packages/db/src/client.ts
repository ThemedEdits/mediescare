import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema/sqlite';

export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either the database or an open transaction. Services accept both. */
export type DbOrTx = Db | Tx;

export class DatabaseKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseKeyError';
  }
}

export interface OpenOptions {
  file: string;
  /** 64 hex characters (256-bit key). Omit only for unencrypted throwaway databases in tests. */
  keyHex?: string;
  /** SQLite busy timeout, a safety net on top of the single-writer server process. */
  busyTimeoutMs?: number;
}

export interface OpenDatabase {
  db: Db;
  raw: Database.Database;
  close(): void;
}

const KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Opens (creating if needed) the branch database encrypted with SQLCipher (ADR-0001),
 * in WAL mode with full synchronous writes so a power cut cannot lose a committed sale.
 */
export function openDatabase(options: OpenOptions): OpenDatabase {
  if (options.file !== ':memory:') mkdirSync(dirname(options.file), { recursive: true });
  const raw = new Database(options.file);
  try {
    if (options.keyHex !== undefined) {
      if (!KEY_PATTERN.test(options.keyHex)) {
        throw new DatabaseKeyError('Database key must be exactly 64 hex characters');
      }
      // The cipher must be selected before the key, and the key before any other statement.
      raw.pragma(`cipher='sqlcipher'`);
      raw.pragma(`key="x'${options.keyHex}'"`);
    }
    try {
      raw.prepare('SELECT count(*) FROM sqlite_master').get();
    } catch {
      throw new DatabaseKeyError('Cannot open database: wrong key or the file is not a Mediescare database');
    }
    raw.pragma('journal_mode = WAL');
    raw.pragma('synchronous = FULL');
    raw.pragma('foreign_keys = ON');
    raw.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
  } catch (error) {
    raw.close();
    throw error;
  }
  // 'better-sqlite3' is aliased to the multiple-ciphers fork in package.json, so drizzle uses it directly.
  const db = drizzle(raw, { schema });
  return { db, raw, close: () => raw.close() };
}
