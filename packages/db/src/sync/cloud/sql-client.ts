/**
 * Minimal SQL interface for the cloud store, so the same code runs on PGlite (free in-process
 * WebAssembly PostgreSQL, used for tests and local cloud development) and on a real PostgreSQL
 * (Supabase) through the `postgres` package. Both drivers are imported lazily and ONLY here: the
 * desktop and branch-server processes never load them.
 *
 * Rules that keep it portable to Supabase's pooler (Supavisor, transaction mode):
 * - no named prepared statements (`prepare: false`);
 * - no session state between statements: anything that must be atomic runs inside `transaction`;
 * - parameters are plain values; JSON goes in as text and is cast with `$n::text::jsonb` in the SQL
 *   (postgres.js would otherwise JSON-encode the string a second time for a jsonb-typed parameter).
 */
export type SqlRow = Record<string, unknown>;

export interface SqlQueryable {
  query<T extends SqlRow = SqlRow>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** One or more statements without parameters (migrations). */
  exec(text: string): Promise<void>;
}

export interface SqlClient extends SqlQueryable {
  transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** The database host cannot be reached (DNS, IPv6-only host on an IPv4 network, firewall, paused project). */
export class CloudDatabaseUnreachableError extends Error {
  constructor(
    readonly host: string,
    readonly reason: string,
  ) {
    super(unreachableMessage(host, reason));
    this.name = 'CloudDatabaseUnreachableError';
  }
}

/** The database answered but refused the login. */
export class CloudDatabaseAuthError extends Error {
  constructor() {
    super(
      'The cloud database refused the login. Check the user and password in MEDIESCARE_CLOUD_DATABASE_URL (copy the Session pooler string again from Supabase dashboard > Connect).',
    );
    this.name = 'CloudDatabaseAuthError';
  }
}

const DIRECT_HOST = /^db\.[a-z0-9]+\.supabase\.co$/i;

function unreachableMessage(host: string, reason: string): string {
  const direct = DIRECT_HOST.test(host);
  return (
    `Cannot reach the cloud database at ${host} (${reason}). ` +
    (direct
      ? 'This is the Supabase direct connection, which only has an IPv6 address on the free plan, and many PCs and hosts (including Vercel) cannot use it. '
      : '') +
    'Use the Session pooler connection string instead: Supabase dashboard > Connect > Session pooler ' +
    '(host aws-0-<region>.pooler.supabase.com, user postgres.<project-ref>, port 5432) and put it in MEDIESCARE_CLOUD_DATABASE_URL. ' +
    'Also check that the project is not paused (free projects pause after 7 days without use).'
  );
}

/** Remove anything that looks like a password or token from text that may be logged or shown. */
export function scrubSecrets(text: string): string {
  return text
    .replace(/(postgres(?:ql)?:\/\/)[^@\s/]*@/gi, '$1***@')
    .replace(/(password|passwd|pwd|secret|token)=([^\s&;]+)/gi, '$1=***');
}

const NETWORK_CODES = new Set([
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNRESET',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_ENDED',
]);

/** Turn a connection failure into a friendly, password-free error. Other errors keep their type, with the text scrubbed. */
export function translateDbError(error: unknown, host: string): Error {
  if (error instanceof CloudDatabaseUnreachableError || error instanceof CloudDatabaseAuthError)
    return error;
  const e = error as { code?: unknown; message?: unknown; errors?: unknown[] } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  const message = typeof e?.message === 'string' ? e.message : 'unknown error';
  if (NETWORK_CODES.has(code) || (Array.isArray(e?.errors) && e.errors.length > 0 && !code)) {
    return new CloudDatabaseUnreachableError(host, code || 'network error');
  }
  if (code === '28P01' || code === '28000' || /password authentication failed/i.test(message))
    return new CloudDatabaseAuthError();
  // Keep the original error (its class and code matter to callers); only its text is scrubbed.
  if (error instanceof Error) {
    error.message = scrubSecrets(error.message);
    return error;
  }
  return new Error(scrubSecrets(message));
}

/** True for loopback and private hosts, where TLS is not needed. */
export function isLocalHost(host: string): boolean {
  return /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|host\.docker\.internal)$/i.test(host);
}

/** Host of a connection string without credentials, for messages. */
export function databaseHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'the database host';
  }
}

// ---------------------------------------------------------------- PGlite

interface PgliteQuery {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  exec(text: string): Promise<unknown>;
}
interface PgliteLike extends PgliteQuery {
  transaction<T>(fn: (tx: PgliteQuery) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * PGlite: real PostgreSQL compiled to WebAssembly, running inside this process. Free, no install.
 * `dataDir` undefined keeps everything in memory; a folder path makes it durable on disk.
 * The specifier is built at run time so bundlers do not pull PGlite into production bundles.
 */
export async function createPgliteClient(dataDir?: string): Promise<SqlClient> {
  const specifier = ['@electric-sql', 'pglite'].join('/');
  const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ specifier)) as {
    PGlite: new (dir?: string) => PgliteLike;
  };
  const db = new mod.PGlite(dataDir);
  const wrap = (q: PgliteQuery): SqlQueryable => ({
    async query<T extends SqlRow = SqlRow>(text: string, params?: readonly unknown[]) {
      const res = await q.query(text, params ? [...params] : undefined);
      return res.rows as T[];
    },
    async exec(text: string) {
      await q.exec(text);
    },
  });
  return {
    ...wrap(db),
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}

// ---------------------------------------------------------------- PostgreSQL (postgres.js)

interface PostgresSql {
  unsafe(text: string, params?: unknown[]): Promise<unknown[]> & PromiseLike<unknown[]>;
  begin<T>(fn: (tx: PostgresSql) => Promise<T>): Promise<T>;
  end(options?: { timeout?: number }): Promise<void>;
}

export interface PostgresClientOptions {
  /** Create and use this schema only (integration tests). Default: the connection's own search path. */
  schema?: string;
  /** Connections in the pool. Default 3: serverless instances should stay small. */
  max?: number;
  /** Seconds to wait for a connection. Default 8. */
  connectTimeoutSeconds?: number;
}

/**
 * Real PostgreSQL through `postgres` (porsager). TLS is on for every non-local host. Prepared
 * statements are off so Supabase's transaction pooler works. Connection problems become
 * `CloudDatabaseUnreachableError`, whose message never contains the password.
 */
export async function createPostgresClient(
  url: string,
  options: PostgresClientOptions = {},
): Promise<SqlClient> {
  const host = databaseHost(url);
  const { default: postgres } = (await import('postgres')) as unknown as {
    default: (url: string, o: Record<string, unknown>) => PostgresSql;
  };
  const sql = postgres(url, {
    prepare: false,
    ssl: isLocalHost(host) ? false : 'require',
    max: options.max ?? 3,
    connect_timeout: options.connectTimeoutSeconds ?? 8,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    onnotice: () => undefined,
    ...(options.schema ? { connection: { search_path: options.schema } } : {}),
  });
  const wrap = (q: PostgresSql): SqlQueryable => ({
    async query<T extends SqlRow = SqlRow>(text: string, params?: readonly unknown[]) {
      try {
        return (await q.unsafe(text, params ? [...params] : undefined)) as unknown as T[];
      } catch (error) {
        throw translateDbError(error, host);
      }
    },
    async exec(text: string) {
      try {
        await q.unsafe(text);
      } catch (error) {
        throw translateDbError(error, host);
      }
    },
  });
  return {
    ...wrap(sql),
    async transaction<T>(fn: (tx: SqlQueryable) => Promise<T>): Promise<T> {
      try {
        return await sql.begin((tx) => fn(wrap(tx)));
      } catch (error) {
        throw translateDbError(error, host);
      }
    },
    close: () => sql.end({ timeout: 5 }),
  };
}

/** Quick reachability probe used by `cloud:migrate` and the integration test. */
export async function probePostgres(url: string, timeoutMs = 5_000): Promise<string | null> {
  let client: SqlClient | null = null;
  try {
    client = await createPostgresClient(url, {
      max: 1,
      connectTimeoutSeconds: Math.max(1, Math.ceil(timeoutMs / 1000)),
    });
    await Promise.race([
      client.query('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new CloudDatabaseUnreachableError(databaseHost(url), 'timeout')),
          timeoutMs,
        ),
      ),
    ]);
    return null;
  } catch (error) {
    return error instanceof Error ? scrubSecrets(error.message) : 'unreachable';
  } finally {
    await client?.close().catch(() => undefined);
  }
}
