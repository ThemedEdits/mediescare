import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlClient } from './sql-client';

/**
 * Forward-only SQL migrations for the cloud-only tables (packages/db/cloud/NNN_name.sql). These are
 * not Drizzle tables and are not part of the SQLite/PostgreSQL parity test. Every file runs in its
 * own transaction together with its `schema_migrations` row, so a failure leaves nothing half-applied.
 */
export function defaultCloudMigrationsDir(): string {
  const candidates = [
    process.env.MEDIESCARE_CLOUD_MIGRATIONS_DIR,
    // Next.js production server: the working directory is apps/web (or the standalone copy of it).
    resolve(process.cwd(), '../../packages/db/cloud'),
    resolve(process.cwd(), 'packages/db/cloud'),
    (() => {
      try {
        return resolve(dirname(fileURLToPath(import.meta.url)), '../../../cloud');
      } catch {
        return undefined;
      }
    })(),
  ];
  const found = candidates.find((c): c is string => !!c && existsSync(c));
  if (!found) throw new Error('Cloud migration files (packages/db/cloud) were not found');
  return found;
}

export interface CloudMigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function runCloudMigrations(
  sql: SqlClient,
  dir: string = defaultCloudMigrationsDir(),
): Promise<CloudMigrationResult> {
  await sql.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  const files = readdirSync(dir)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  const done = new Set(
    (await sql.query<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name),
  );
  const result: CloudMigrationResult = { applied: [], alreadyApplied: [] };
  for (const file of files) {
    if (done.has(file)) {
      result.alreadyApplied.push(file);
      continue;
    }
    const text = readFileSync(resolve(dir, file), 'utf8');
    await sql.transaction(async (tx) => {
      await tx.exec(text);
      await tx.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    });
    result.applied.push(file);
  }
  return result;
}
