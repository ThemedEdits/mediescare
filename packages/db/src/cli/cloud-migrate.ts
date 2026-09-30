import {
  createPostgresClient,
  databaseHost,
  runCloudMigrations,
  scrubSecrets,
} from '../sync/cloud';

/**
 * Creates or updates the cloud-only tables (packages/db/cloud/*.sql) in the cloud PostgreSQL
 * database named by MEDIESCARE_CLOUD_DATABASE_URL (the Supabase *Session pooler* string).
 * Safe to run again: applied files are skipped. Never prints the connection string.
 */
async function main(): Promise<void> {
  const url = process.env.MEDIESCARE_CLOUD_DATABASE_URL?.trim();
  if (!url) {
    console.error(
      'MEDIESCARE_CLOUD_DATABASE_URL is not set. Put the Supabase Session pooler connection string in the ' +
        'repository .env (Supabase dashboard > Connect > Session pooler). See docs/cloud-deploy.md.',
    );
    process.exit(1);
  }
  const host = databaseHost(url);
  const sql = await createPostgresClient(url, { max: 1, connectTimeoutSeconds: 10 });
  try {
    const result = await runCloudMigrations(sql);
    console.log(`Cloud database ${host}: ${result.applied.length} migration(s) applied.`);
    for (const f of result.applied) console.log(`  applied  ${f}`);
    for (const f of result.alreadyApplied) console.log(`  already  ${f}`);
  } finally {
    await sql.close().catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? scrubSecrets(error.message) : 'Cloud migration failed');
    process.exit(1);
  },
);
