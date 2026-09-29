import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './client';

/**
 * Migrations folder next to the package sources (development, tests, CLI).
 * Built with path functions, not `new URL(..., import.meta.url)`, so bundlers do not try to
 * treat the folder as an importable asset. In the packaged app the shell passes the folder explicitly.
 */
export function defaultMigrationsDir(): string {
  return join(
    /*turbopackIgnore: true*/ dirname(fileURLToPath(import.meta.url)),
    '..',
    'migrations',
    'sqlite',
  );
}

/** Applies forward-only migrations. The caller takes a pre-migration backup first. */
export function runMigrations(db: Db, migrationsFolder: string = defaultMigrationsDir()): void {
  migrate(db, { migrationsFolder });
}

/** How many bundled migrations have not been applied to this database yet. */
export function pendingMigrationCount(
  db: Db,
  migrationsFolder: string = defaultMigrationsDir(),
): number {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as { entries: unknown[] };
  const applied = (() => {
    try {
      return db.get<{ n: number }>(sql`SELECT count(*) AS n FROM __drizzle_migrations`).n;
    } catch {
      return 0; // brand new database: the migrations table does not exist yet
    }
  })();
  return Math.max(0, journal.entries.length - applied);
}
