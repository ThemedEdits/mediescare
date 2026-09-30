import { join } from 'node:path';
import {
  appendAudit,
  disabledSyncStatus,
  PairingCodes,
  SyncRunner,
  type Db,
  type WriteContext,
} from '@mediescare/db';
import { HttpCloudAdapter, normaliseCloudUrl } from '@mediescare/sync';

/**
 * Wires the sync worker into the branch server process. Opt-in: with MEDIESCARE_CLOUD_URL unset
 * nothing starts and the app behaves exactly as before. The worker runs on timers, off the
 * request path, so no POS request ever waits for it or for the network.
 *
 * Environment (set by the desktop shell, or .env for development):
 *   MEDIESCARE_CLOUD_URL            https origin of a cloud-mode instance
 *   MEDIESCARE_CLOUD_TOKEN          device token issued by the cloud (never logged)
 *   MEDIESCARE_CLOUD_ALLOW_INSECURE 1 to allow plain http to a non-loopback host (tests, private networks)
 *   MEDIESCARE_SYNC_INTERVAL_MS     pause between cycles, default 5000
 *   MEDIESCARE_SYNC_EXPORT_DIR      where a fenced server writes its unsent tail
 */
interface SyncHolder {
  runner: SyncRunner | null;
  started: boolean;
  codes: PairingCodes;
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

export function startSyncIfConfigured(input: StartSyncInput): SyncRunner | null {
  const h = holder();
  if (h.started) return h.runner;
  h.started = true;
  const env = input.env ?? process.env;
  const url = env.MEDIESCARE_CLOUD_URL?.trim();
  if (!url || env.MEDIESCARE_DISABLE_JOBS === '1') return null;
  const token = env.MEDIESCARE_CLOUD_TOKEN?.trim();
  if (!token) {
    console.error(
      '[sync] MEDIESCARE_CLOUD_URL is set but MEDIESCARE_CLOUD_TOKEN is missing; sync stays off',
    );
    return null;
  }
  try {
    const allowInsecure = env.MEDIESCARE_CLOUD_ALLOW_INSECURE === '1';
    const origin = normaliseCloudUrl(url, allowInsecure);
    const interval = Number.parseInt(env.MEDIESCARE_SYNC_INTERVAL_MS ?? '', 10);
    h.runner = new SyncRunner({
      db: input.db,
      adapter: new HttpCloudAdapter({ baseUrl: origin, token, allowInsecure }),
      intervalMs: Number.isFinite(interval) && interval >= 500 ? interval : 5_000,
      exportDir: env.MEDIESCARE_SYNC_EXPORT_DIR ?? join(input.dataDir, '..', 'sync-exports'),
      auditContext: input.auditContext,
      cloudHost: new URL(origin).host,
    });
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
