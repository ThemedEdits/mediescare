import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client';

/**
 * Migrations folder next to the package sources (development, tests, CLI).
 * Built with path functions, not `new URL(..., import.meta.url)`, so bundlers do not try to
 * treat the folder as an importable asset. In the packaged app the shell passes the folder explicitly.
 */
export function defaultMigrationsDir(): string {
  return join(/*turbopackIgnore: true*/ dirname(fileURLToPath(import.meta.url)), '..', 'migrations', 'sqlite');
}

/** Applies forward-only migrations. The caller takes a pre-migration backup first. */
export function runMigrations(db: Db, migrationsFolder: string = defaultMigrationsDir()): void {
  migrate(db, { migrationsFolder });
}
