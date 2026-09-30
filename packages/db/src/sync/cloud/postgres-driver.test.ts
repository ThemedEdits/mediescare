import { afterAll, beforeAll } from 'vitest';
import { runCloudStoreContract } from '@mediescare/sync/contract';
import { migratedClient, postgresHarness, resetCloudTables } from './cloud-test-support';
import { createPostgresClient, type SqlClient } from './sql-client';

// Exercises the real `postgres` driver path (createPostgresClient: prepare:false, unsafe queries,
// sql.begin transactions, jsonb casts) against PGlite exposed over the PostgreSQL wire protocol on
// loopback. This proves the driver code without an external database.
let sql: SqlClient;
let stop: () => Promise<void>;

beforeAll(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket');
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1' });
  await server.start();
  const address = (
    server as unknown as { server?: { address(): { port: number } } }
  ).server?.address();
  const port = address?.port;
  if (!port) throw new Error('socket server did not report a port');
  const url = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  sql = await migratedClient(() => createPostgresClient(url, { max: 1 }));
  stop = async () => {
    await sql.close();
    await server.stop();
    await db.close();
  };
}, 60_000);
afterAll(async () => {
  await stop?.();
});

runCloudStoreContract('postgres (postgres.js driver over a socket)', async (now) => {
  await resetCloudTables(sql);
  return postgresHarness(sql, now);
});
