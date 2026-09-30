/** Shared setup for the cloud store tests. Not a test file. All ids and names are invented. */
import type { ContractHarness } from '@mediescare/sync/contract';
import type { DeviceAuth } from '@mediescare/sync';
import { CloudAuthService } from './device-auth';
import { runCloudMigrations } from './migrate';
import { PostgresCloudStore } from './postgres-store';
import type { SqlClient } from './sql-client';

export const TEST_JWT_SECRET = 'test-secret-0123456789-0123456789-abcdef';

const TABLES = [
  'tenants',
  'branches',
  'devices',
  'enrollment_codes',
  'sync_events',
  'entity_heads',
  'push_batches',
  'epochs',
  'sync_conflicts',
];

/** Empty every cloud table (keeps the schema), so one database can serve many tests. */
export async function resetCloudTables(sql: SqlClient): Promise<void> {
  await sql.exec(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export async function migratedClient(make: () => Promise<SqlClient>): Promise<SqlClient> {
  const sql = await make();
  await runCloudMigrations(sql);
  return sql;
}

export function postgresHarness(
  sql: SqlClient,
  now: () => number,
): ContractHarness & {
  auth: CloudAuthService;
  store: PostgresCloudStore;
} {
  const auth = new CloudAuthService({ sql, jwtSecret: TEST_JWT_SECRET, now });
  const store = new PostgresCloudStore({
    sql,
    now,
    verifyToken: (t) => auth.verifyAccessToken(t),
  });
  const tokens = new Map<string, string>();
  const key = (a: DeviceAuth) => `${a.tenantId}|${a.deviceId}`;
  const hoDevice = new Map<string, DeviceAuth>();

  return {
    auth,
    store,
    async register(a) {
      const known = tokens.get(key(a));
      if (known) return known;
      let result;
      if (a.headOffice) {
        result = await auth.bootstrap({
          organisationName: `Org ${a.tenantId}`,
          branchCode: `B${a.branchId.slice(-6)}`,
          branchName: `Branch ${a.branchId.slice(-4)}`,
          deviceName: 'Test PC',
          identity: { tenantId: a.tenantId, branchId: a.branchId, deviceId: a.deviceId },
        });
        hoDevice.set(a.tenantId, a);
      } else {
        const ho = hoDevice.get(a.tenantId);
        if (!ho) throw new Error('register the Head Office device of the tenant first');
        const code = await auth.createEnrollmentCode(ho, {
          branchCode: `B${a.branchId.slice(-6)}`,
          branchName: `Branch ${a.branchId.slice(-4)}`,
        });
        result = await auth.enroll({
          code: code.code,
          deviceName: 'Test PC',
          identity: { branchId: a.branchId, deviceId: a.deviceId },
        });
      }
      tokens.set(key(a), result.accessToken);
      return result.accessToken;
    },
    async revoke(a) {
      await auth.revokeDevice(a.deviceId);
    },
    epochOf: (a) => store.epochOf(a),
    async countEvents() {
      const r = await sql.query<{ n: string }>('SELECT count(*)::text AS n FROM sync_events');
      return Number(r[0]?.n ?? 0);
    },
    async master(entityType, entityId) {
      const r = await sql.query<{
        record: { fields: Record<string, unknown>; voided: boolean };
        version: number;
      }>('SELECT record, version FROM entity_heads WHERE entity_type = $1 AND entity_id = $2', [
        entityType,
        entityId,
      ]);
      const row = r[0];
      return row
        ? { fields: row.record.fields, version: row.version, voided: row.record.voided }
        : null;
    },
    async conflicts() {
      const r = await sql.query<{
        entity_type: string;
        entity_id: string;
        field: string;
        reason: string;
      }>('SELECT entity_type, entity_id, field, reason FROM sync_conflicts ORDER BY id');
      return r.map((c) => ({
        entityType: c.entity_type,
        entityId: c.entity_id,
        field: c.field,
        reason: c.reason,
      }));
    },
    close: () => Promise.resolve(),
  };
}
