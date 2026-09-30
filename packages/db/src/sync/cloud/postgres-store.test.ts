import { afterAll, beforeAll } from 'vitest';
import { runCloudStoreContract } from '@mediescare/sync/contract';
import { migratedClient, postgresHarness, resetCloudTables } from './cloud-test-support';
import { createPgliteClient, type SqlClient } from './sql-client';

// The PostgreSQL store against PGlite (real PostgreSQL in WebAssembly). The real-Supabase run of the
// same suite is supabase.integration.test.ts (skipped unless MEDIESCARE_CLOUD_DATABASE_URL is reachable).
let sql: SqlClient;
beforeAll(async () => {
  sql = await migratedClient(() => createPgliteClient());
}, 60_000);
afterAll(async () => {
  await sql.close();
});

runCloudStoreContract('postgres (PGlite)', async (now) => {
  await resetCloudTables(sql);
  return postgresHarness(sql, now);
});
