import { join } from 'node:path';
import {
  appendAudit,
  disabledSyncStatus,
  PairingCodes,
  SyncRunner,
  type Db,
  type WriteContext,
} from '@mediescare/db';
import {
  FileTokenStore,
  HttpCloudAdapter,
  normaliseCloudUrl,
  RefreshingTokenProvider,
  type CloudAdapter,
  type EnrollResult,
  type TokenProvider,
  type TokenSession,
} from '@mediescare/sync';
import { pullOptionFor } from './pull-option';

/**
 * Wires the sync worker into the branch server process. Opt-in: nothing starts until this PC is
 * connected to a cloud, and the app behaves exactly as before. The worker runs on timers, off the
 * request path, so no POS request ever waits for it or for the network.
 *
 * How the server finds its cloud credentials, in order:
 *   1. `cloud-auth.json` in the data folder: cloud address + rotating refresh token, written by
 *      `connectToCloud` (the "Connect to cloud" form, or the branch setup screen). Encrypted with a
 *      key derived from MEDIESCARE_DB_KEY, which the desktop shell keeps sealed with the OS
 *      credential store. The server rotates the refresh token itself, so it is the one that saves it.
 *   2. Legacy: MEDIESCARE_CLOUD_URL + MEDIESCARE_CLOUD_TOKEN (a fixed token; development only).
 *
 * Other environment variables:
 *   MEDIESCARE_CLOUD_ALLOW_INSECURE 1 to allow plain http to a non-loopback host (tests, private networks)
 *   MEDIESCARE_SYNC_INTERVAL_MS     pause between cycles, default 5000
 *   MEDIESCARE_SYNC_EXPORT_DIR      where a fenced server writes its unsent tail
 */
interface SyncHolder {
  runner: SyncRunner | null;
  started: boolean;
  codes: PairingCodes;
  /** Address and token source of the running worker (see getCloudAccess). */
  access?: { cloudUrl: string; provider: RefreshingTokenProvider } | null;
}

const g = globalThis as unknown as { __mediescareSync?: SyncHolder };

function holder(): SyncHolder {
  g.__mediescareSync ??= { runner: null, started: false, codes: new PairingCodes() };
  return g.__mediescareSync;
}

export interface StartSyncInput {
  db: Db;
  dataDir: string;
  auditContext: () => WriteContext | null;
  env?: NodeJS.ProcessEnv;
}

export function cloudAuthStore(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
): FileTokenStore {
  const key = env.MEDIESCARE_DB_KEY;
  return new FileTokenStore(join(dataDir, 'cloud-auth.json'), {
    secretHex: key && /^[0-9a-fA-F]{64}$/.test(key) ? key : null,
  });
}

function interval(env: NodeJS.ProcessEnv): number {
  const n = Number.parseInt(env.MEDIESCARE_SYNC_INTERVAL_MS ?? '', 10);
  return Number.isFinite(n) && n >= 500 ? n : 5_000;
}

function makeRunner(
  input: StartSyncInput,
  origin: string,
  adapter: CloudAdapter,
  tokens?: TokenSession,
): SyncRunner {
  const env = input.env ?? process.env;
  return new SyncRunner({
    db: input.db,
    adapter,
    tokens,
    intervalMs: interval(env),
    exportDir: env.MEDIESCARE_SYNC_EXPORT_DIR ?? join(input.dataDir, '..', 'sync-exports'),
    auditContext: input.auditContext,
    pull: pullOptionFor(input.db, input.auditContext),
    cloudHost: new URL(origin).host,
  });
}

function startWithProvider(
  input: StartSyncInput,
  cloudUrl: string,
  provider: RefreshingTokenProvider,
): SyncRunner {
  const env = input.env ?? process.env;
  const allowInsecure = env.MEDIESCARE_CLOUD_ALLOW_INSECURE === '1';
  const origin = normaliseCloudUrl(cloudUrl, allowInsecure);
  const adapter = new HttpCloudAdapter({
    baseUrl: origin,
    allowInsecure,
    tokenProvider: provider.provider(),
    forceRefresh: () => provider.forceRefresh(),
  });
  const runner = makeRunner(input, origin, adapter, provider);
  holder().runner = runner;
  holder().access = { cloudUrl: origin, provider };
  runner.start();
  return runner;
}

export function startSyncIfConfigured(input: StartSyncInput): SyncRunner | null {
  const h = holder();
  if (h.started) return h.runner;
  h.started = true;
  const env = input.env ?? process.env;
  if (env.MEDIESCARE_DISABLE_JOBS === '1') return null;
  try {
    const store = cloudAuthStore(input.dataDir, env);
    const stored = store.loadSync();
    if (stored) {
      return startWithProvider(
        input,
        stored.cloudUrl,
        new RefreshingTokenProvider({ store, stored }),
      );
    }
    // Legacy fixed token from the environment.
    const url = env.MEDIESCARE_CLOUD_URL?.trim();
    if (!url) return null;
    const token = env.MEDIESCARE_CLOUD_TOKEN?.trim();
    if (!token) {
      console.error(
        '[sync] MEDIESCARE_CLOUD_URL is set but MEDIESCARE_CLOUD_TOKEN is missing; sync stays off',
      );
      return null;
    }
    const allowInsecure = env.MEDIESCARE_CLOUD_ALLOW_INSECURE === '1';
    const origin = normaliseCloudUrl(url, allowInsecure);
    h.runner = makeRunner(
      input,
      origin,
      new HttpCloudAdapter({ baseUrl: origin, token, allowInsecure }),
    );
    h.runner.start();
    return h.runner;
  } catch (error) {
    console.error(
      '[sync] not started:',
      error instanceof Error ? error.message : 'invalid configuration',
    );
    return null;
  }
}

/**
 * Save the credentials the cloud issued to this PC and start syncing now (no restart needed).
 * Used by the Head Office "Connect to cloud" form and by the branch setup screen after `enroll()`.
 * The ids in `result` must be the ones this database already uses (the cloud adopted them) or
 * belong to a database that is created with them; otherwise the cloud rejects every event.
 */
export function connectToCloud(
  input: StartSyncInput,
  cloudUrl: string,
  result: EnrollResult,
): SyncRunner {
  const env = input.env ?? process.env;
  const origin = normaliseCloudUrl(cloudUrl, env.MEDIESCARE_CLOUD_ALLOW_INSECURE === '1');
  const store = cloudAuthStore(input.dataDir, env);
  const stored = {
    cloudUrl: origin,
    refreshToken: result.refreshToken,
    deviceId: result.deviceId,
    tenantId: result.tenantId,
    branchId: result.branch.id,
    updatedAt: new Date().toISOString(),
  };
  store.saveSync(stored);
  stopSync();
  const h = holder();
  h.started = true;
  return startWithProvider(
    input,
    origin,
    new RefreshingTokenProvider({
      store,
      stored,
      initial: { accessToken: result.accessToken, accessExpiresAt: result.accessExpiresAt },
    }),
  );
}

/** Stop syncing and forget the cloud credentials. Every local record stays exactly as it is. */
export function disconnectFromCloud(input: StartSyncInput): void {
  stopSync();
  cloudAuthStore(input.dataDir, input.env).clearSync();
  holder().started = true; // do not fall back to the legacy environment token until the next restart
}

function stopSync(): void {
  const h = holder();
  h.runner?.stop();
  h.runner = null;
  h.access = null;
}

/**
 * Cloud address and token source of the running sync worker, for features that talk to the cloud
 * on behalf of this PC (Head Office asking for a branch enrollment code). It is the worker's own
 * provider: the refresh token rotates on every refresh, so only one provider may ever use it.
 */
export function getCloudAccess(): { cloudUrl: string; provider: TokenProvider } | null {
  const a = holder().access;
  return a ? { cloudUrl: a.cloudUrl, provider: a.provider.provider() } : null;
}

/** True when this PC has saved cloud credentials (whether or not the last sync worked). */
export function hasCloudCredentials(dataDir: string): boolean {
  return cloudAuthStore(dataDir).loadSync() !== null;
}

export function getSyncRunner(): SyncRunner | null {
  return holder().runner;
}

export function getPairingCodes(): PairingCodes {
  return holder().codes;
}

export function syncStatus(db: Db) {
  return holder().runner?.status() ?? disabledSyncStatus(db);
}

/** Audit a pairing-code creation (the code itself is never logged). */
export function auditPairingCode(db: Db, ctx: WriteContext, expiresAt: string): void {
  db.transaction((tx) => {
    appendAudit(tx, ctx, {
      action: 'device.pairing_code.create',
      entityType: 'device',
      newValue: { expiresAt },
    });
  });
}

/** Audit connecting to or disconnecting from the cloud. Only the host is recorded, never a token or code. */
export function auditCloudLink(
  db: Db,
  ctx: WriteContext,
  action: 'sync.cloud.connect' | 'sync.cloud.disconnect',
  detail: { cloudHost?: string | null; organisation?: string },
): void {
  db.transaction((tx) => {
    appendAudit(tx, ctx, { action, entityType: 'sync', newValue: detail });
  });
}
