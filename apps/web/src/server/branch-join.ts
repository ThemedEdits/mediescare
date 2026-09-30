import { join } from 'node:path';
import {
  getServerIdentity,
  isHeadOfficeBranch,
  isPriceManagedElsewhere,
  joinOrganisation,
  type JoinProgress,
  type JoinResult,
} from '@mediescare/db';
import { enroll, type EnrollResult } from '@mediescare/sync';
import type { JoinOrganisationInput } from './branch-join-schemas';
import { getDb, getRuntime } from './runtime';
import { cloudAuthStore } from './sync-runtime';

/**
 * Web-side wiring of the multi-branch features (logic lives in packages/db `sync/`):
 *
 * - the branch join (`runJoin`): a new PC becomes a branch of an existing organisation,
 * - `serverIsHeadOffice`: the `/branches` menu entry and screen are for Head Office only.
 */

/** True when this server runs the Head Office branch (false before setup). */
export function serverIsHeadOffice(): boolean {
  const db = getDb();
  const identity = getServerIdentity(db);
  return identity ? isHeadOfficeBranch(db, identity.branchId) : false;
}

/** True on a branch of an organisation with a Head Office: items and prices come from Head Office. */
export function pricesSetByHeadOffice(): boolean {
  const db = getDb();
  const identity = getServerIdentity(db);
  return identity ? isPriceManagedElsewhere(db, identity) : false;
}

// ---------------------------------------------------------------------------------------------
// Branch join
// ---------------------------------------------------------------------------------------------

export interface JoinStatus {
  running: boolean;
  progress: JoinProgress | null;
  /** Message of the last failed attempt (cleared when a new one starts). */
  error: string | null;
}

const g = globalThis as unknown as { __mediescareJoin?: JoinStatus };

function state(): JoinStatus {
  g.__mediescareJoin ??= { running: false, progress: null, error: null };
  return g.__mediescareJoin;
}

export function joinStatus(): JoinStatus {
  const s = state();
  return { running: s.running, progress: s.progress, error: s.error };
}

export class JoinBusyError extends Error {
  constructor() {
    super('A join is already running on this PC');
    this.name = 'JoinBusyError';
  }
}

/** What the sync runner needs to take over right after a join: the stored (possibly rotated) credentials. */
export async function credentialsAfterJoin(result: JoinResult): Promise<{
  cloudUrl: string;
  enrolled: EnrollResult;
} | null> {
  const store = cloudAuthStore(getRuntime().dataDir);
  const stored = await store.load();
  if (!stored) return null;
  return {
    cloudUrl: stored.cloudUrl,
    enrolled: {
      deviceId: result.deviceId,
      tenantId: result.tenantId,
      tenantName: result.tenantName,
      branch: {
        id: result.branchId,
        code: result.branchCode,
        name: result.branchCode,
        isHeadOffice: false,
      },
      // The access token of the first sync has expired or is about to: the provider refreshes at once.
      accessToken: 'expired',
      refreshToken: stored.refreshToken,
      accessExpiresAt: new Date(0).toISOString(),
    },
  };
}

/**
 * Run the join on the real runtime: one at a time, progress kept for the setup screen to poll.
 * The recovery key and the start of the sync runner are the caller's job (they need the session layer).
 */
export async function runJoin(
  input: JoinOrganisationInput,
  passwordHash: string,
): Promise<JoinResult> {
  const s = state();
  if (s.running) throw new JoinBusyError();
  s.running = true;
  s.error = null;
  s.progress = { stage: 'enrolling', received: 0, applied: 0, byType: {} };
  const runtime = getRuntime();
  try {
    return await joinOrganisation(
      {
        enroll,
        tokenStore: cloudAuthStore(runtime.dataDir),
        live: runtime.handle,
        stagingFile: join(runtime.dataDir, 'mediescare.join.db'),
        keyHex: runtime.dbKeyHex,
        migrationsDir: process.env.MEDIESCARE_MIGRATIONS_DIR,
        allowInsecure: process.env.MEDIESCARE_CLOUD_ALLOW_INSECURE === '1',
        onProgress: (p) => {
          s.progress = p;
        },
      },
      {
        cloudUrl: input.cloudUrl,
        code: input.code,
        deviceName: process.env.COMPUTERNAME ?? 'Branch Server',
        admin: {
          username: input.admin.username,
          fullName: input.admin.fullName,
          passwordHash,
        },
      },
    );
  } catch (error) {
    s.error = error instanceof Error ? error.message : 'The join failed';
    throw error;
  } finally {
    s.running = false;
  }
}
