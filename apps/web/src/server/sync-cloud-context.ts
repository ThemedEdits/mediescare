import { InMemoryCloudStore, type CloudStore } from '@mediescare/sync';
import {
  CloudAuthService,
  createPgliteClient,
  createPostgresClient,
  PostgresCloudStore,
  runCloudMigrations,
  type SqlClient,
} from '@mediescare/db/cloud';
import { CloudConfigError } from './sync-http';

/**
 * Everything the cloud-mode routes need, created once per server process (and once per warm
 * serverless instance). Kept free of the SQLite runtime: see sync-http.ts.
 *
 * MEDIESCARE_CLOUD_STORE selects the store:
 *   (unset) | postgres   real PostgreSQL (Supabase) from MEDIESCARE_CLOUD_DATABASE_URL (pooler string)
 *   pglite               PGlite, free in-process PostgreSQL: local development and tests. Durable when
 *                        MEDIESCARE_CLOUD_PGLITE_DIR is set, in memory otherwise. Migrates itself.
 *   memory               the non-durable in-memory reference store (no device endpoints)
 */
export interface CloudContext {
  store: CloudStore;
  /** Null for the memory store, which has no device registry. */
  auth: CloudAuthService | null;
  /** Code that allows the first Head Office PC to create the organisation. Undefined: bootstrap is off. */
  bootstrapCode: string | undefined;
}

interface DevDevice {
  token: string;
  tenantId: string;
  branchId: string;
  deviceId: string;
  headOffice?: boolean;
}

type Env = Record<string, string | undefined>;
const holder = globalThis as unknown as { __mediescareCloud?: Promise<CloudContext> };

export function isCloudMode(env: Env = process.env): boolean {
  return (env.MEDIESCARE_MODE ?? '').trim() === 'cloud';
}

/** The cloud context, or null when this process is not in cloud mode. */
export function getCloudContext(env: Env = process.env): Promise<CloudContext | null> {
  if (!isCloudMode(env)) return Promise.resolve(null);
  if (!holder.__mediescareCloud) {
    holder.__mediescareCloud = createContext(env).catch((error: unknown) => {
      holder.__mediescareCloud = undefined; // retry on the next request (database may have been down)
      throw error;
    });
  }
  return holder.__mediescareCloud;
}

/** Forget the cached context (tests). */
export function resetCloudContext(): void {
  holder.__mediescareCloud = undefined;
}

async function createContext(env: Env): Promise<CloudContext> {
  const kind = (env.MEDIESCARE_CLOUD_STORE ?? 'postgres').trim();
  const bootstrapCode = env.MEDIESCARE_CLOUD_BOOTSTRAP_CODE?.trim() || undefined;

  if (kind === 'memory') {
    const mem = new InMemoryCloudStore();
    const devices = JSON.parse(env.MEDIESCARE_CLOUD_DEV_DEVICES ?? '[]') as DevDevice[];
    for (const d of devices) {
      mem.registerDevice(d.token, {
        tenantId: d.tenantId,
        branchId: d.branchId,
        deviceId: d.deviceId,
        headOffice: d.headOffice === true,
      });
    }
    return { store: mem, auth: null, bootstrapCode };
  }

  const jwtSecret = env.MEDIESCARE_CLOUD_JWT_SECRET?.trim();
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new CloudConfigError(
      'MEDIESCARE_CLOUD_JWT_SECRET is not set (or shorter than 32 characters).',
    );
  }

  let sql: SqlClient;
  if (kind === 'pglite') {
    sql = await createPgliteClient(env.MEDIESCARE_CLOUD_PGLITE_DIR?.trim() || undefined);
    await runCloudMigrations(sql);
  } else if (kind === 'postgres') {
    const url = env.MEDIESCARE_CLOUD_DATABASE_URL?.trim();
    if (!url) throw new CloudConfigError('MEDIESCARE_CLOUD_DATABASE_URL is not set.');
    sql = await createPostgresClient(url, { max: 3 });
  } else {
    throw new CloudConfigError(`Unknown MEDIESCARE_CLOUD_STORE "${kind}".`);
  }
  const auth = new CloudAuthService({ sql, jwtSecret });
  const store = new PostgresCloudStore({ sql, verifyToken: (t) => auth.verifyAccessToken(t) });
  return { store, auth, bootstrapCode };
}
