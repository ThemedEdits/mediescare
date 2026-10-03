import { afterAll, beforeAll, describe, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { runCloudStoreContract } from '@mediescare/sync/contract';
import { migratedClient, postgresHarness, resetCloudTables } from './cloud-test-support';
import { createPostgresClient, probePostgres, type SqlClient } from './sql-client';

/**
 * The same contract suite against the REAL cloud database. It runs only when
 * MEDIESCARE_RUN_LIVE_DB_TESTS=1 is set, MEDIESCARE_CLOUD_DATABASE_URL is set and answers within
 * 5 seconds; otherwise it is skipped with the reason below. It works in a throwaway schema (`test_<random>`, dropped afterwards), so real
 * data is never touched. The URL is read from the environment only and never printed.
 */
const url = process.env.MEDIESCARE_CLOUD_DATABASE_URL?.trim();
// Opt in with MEDIESCARE_RUN_LIVE_DB_TESTS=1: the suite makes many round trips over the internet (about 7 minutes).
const optedIn = process.env.MEDIESCARE_RUN_LIVE_DB_TESTS === '1';
const problem = !optedIn
  ? 'set MEDIESCARE_RUN_LIVE_DB_TESTS=1 to run it'
  : url
    ? await probePostgres(url, 5_000)
    : 'MEDIESCARE_CLOUD_DATABASE_URL is not set';
if (problem) {
  console.warn(`[skipped] real Supabase integration test: ${problem}`);
}

// Every query crosses the internet to the pooler, so each contract test needs far more than the default 10 s.
vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });

describe.skipIf(Boolean(problem))('real PostgreSQL (throwaway schema)', () => {
  const schema = `test_${randomBytes(6).toString('hex')}`;
  let admin: SqlClient;
  let sql: SqlClient;

  beforeAll(async () => {
    admin = await createPostgresClient(url as string, { max: 1 });
    await admin.exec(`CREATE SCHEMA ${schema}`);
    sql = await migratedClient(() => createPostgresClient(url as string, { max: 1, schema }));
  }, 60_000);

  afterAll(async () => {
    await sql?.close();
    await admin?.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin?.close();
  }, 60_000);

  runCloudStoreContract('postgres (real database)', async (now) => {
    await resetCloudTables(sql);
    return postgresHarness(sql, now);
  });
});
