import { existsSync, rmSync } from 'node:fs';
import {
  HttpCloudAdapter,
  HybridLogicalClock,
  normaliseCloudUrl,
  RefreshingTokenProvider,
  type CloudAdapter,
  type EnrollResult,
  type TokenProvider,
  type TokenStore,
} from '@mediescare/sync';
import { openDatabase, type OpenDatabase } from '../client';
import { runFirstRunSetup } from '../firstRun';
import { hlcDeviceId } from '../identity';
import { runMigrations } from '../migrate';
import { ensurePharmacyDefaults } from '../pharmacy/defaults';
import { createChangeApplier } from './appliers/change-applier';
import { registeredEntityTypes } from './appliers/registry';
import { copyStagedDatabase, verifyJoinedDatabase } from './branch-join';
import { pullChanges, type PullProgress } from './pull';

export type JoinStage = 'enrolling' | 'preparing' | 'syncing' | 'checking' | 'saving' | 'done';

export interface JoinProgress {
  stage: JoinStage;
  /** Events received and applied so far during the first sync. */
  received: number;
  applied: number;
  /** Events handled per entity type (items, suppliers ...). */
  byType: Record<string, number>;
}

/** A join step failed. `message` is written for the owner; nothing was left behind in the live database. */
export class JoinError extends Error {
  constructor(
    message: string,
    readonly stage: JoinStage,
  ) {
    super(message);
    this.name = 'JoinError';
  }
}

export interface JoinInput {
  cloudUrl: string;
  /** One-time enrollment code created by Head Office. Never logged. */
  code: string;
  deviceName: string;
  admin: { username: string; fullName: string; passwordHash: string };
}

export interface JoinDeps {
  /** `enroll` from @mediescare/sync (injected so tests use a fake). */
  enroll: (input: { cloudUrl: string; code: string; deviceName: string }) => Promise<EnrollResult>;
  /** The adapter used for the first sync. Default: HTTP with a refreshing token provider. */
  createAdapter?: (ctx: {
    cloudUrl: string;
    enrolled: EnrollResult;
    provider: TokenProvider;
  }) => CloudAdapter;
  tokenStore: TokenStore;
  /** The live (still empty) database. It is only written at the very end, in one transaction. */
  live: OpenDatabase;
  /** Scratch database file. Created, filled and deleted by the join. */
  stagingFile: string;
  keyHex: string;
  migrationsDir?: string;
  allowInsecure?: boolean;
  fetchImpl?: typeof fetch;
  onProgress?: (progress: JoinProgress) => void;
  now?: () => Date;
}

export interface JoinResult {
  tenantId: string;
  tenantName: string;
  branchId: string;
  branchCode: string;
  deviceId: string;
  eventsReceived: number;
  byType: Record<string, number>;
  seconds: number;
}

function removeDatabaseFiles(file: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal'])
    rmSync(`${file}${suffix}`, { force: true });
}

/**
 * Join an existing organisation as a new branch (the screen "Join an existing organisation"):
 *
 * 1. enroll with the one-time code (network; nothing is created yet),
 * 2. build the branch database in a staging file: same tenant id as Head Office, the branch from the
 *    enrollment (never Head Office), a local owner, the cloud's device id,
 * 3. initial sync: pull every master record from cursor 0, in pages, with progress,
 * 4. check the result, then copy it into the live database in one transaction.
 *
 * On any failure the staging file is deleted, the stored credentials are cleared and the live
 * database is exactly as it was, so the owner can correct the problem and try again (the one-time
 * code is used up once the cloud accepted it; Head Office creates a new one).
 */
export async function joinOrganisation(deps: JoinDeps, input: JoinInput): Promise<JoinResult> {
  const started = Date.now();
  const progress: JoinProgress = { stage: 'enrolling', received: 0, applied: 0, byType: {} };
  let stage: JoinStage = 'enrolling';
  const report = (patch: Partial<JoinProgress>) => {
    Object.assign(progress, patch);
    deps.onProgress?.({ ...progress, byType: { ...progress.byType } });
  };
  const at = (next: JoinStage) => {
    stage = next;
    report({ stage: next });
  };
  let credentialsSaved = false;
  let staging: OpenDatabase | null = null;

  try {
    at('enrolling');
    let cloudUrl: string;
    try {
      cloudUrl = normaliseCloudUrl(input.cloudUrl, deps.allowInsecure);
    } catch (error) {
      throw new JoinError(error instanceof Error ? error.message : 'Invalid cloud address', stage);
    }
    const enrolled = await deps.enroll({
      cloudUrl,
      code: input.code,
      deviceName: input.deviceName,
    });
    if (enrolled.branch.isHeadOffice)
      throw new JoinError(
        'This code belongs to Head Office. A branch joins with a code that Head Office created for that branch',
        stage,
      );

    at('preparing');
    const stored = {
      cloudUrl,
      refreshToken: enrolled.refreshToken,
      deviceId: enrolled.deviceId,
      tenantId: enrolled.tenantId,
      branchId: enrolled.branch.id,
      updatedAt: (deps.now ? deps.now() : new Date()).toISOString(),
    };
    await deps.tokenStore.save(stored);
    credentialsSaved = true;

    removeDatabaseFiles(deps.stagingFile);
    staging = openDatabase({ file: deps.stagingFile, keyHex: deps.keyHex });
    runMigrations(staging.db, deps.migrationsDir);
    runFirstRunSetup(staging.db, {
      tenantName: enrolled.tenantName,
      branchCode: enrolled.branch.code,
      branchName: enrolled.branch.name,
      isHeadOffice: false,
      deviceName: input.deviceName,
      admin: input.admin,
      join: {
        tenantId: enrolled.tenantId,
        branchId: enrolled.branch.id,
        deviceId: enrolled.deviceId,
      },
      now: deps.now,
    });

    at('syncing');
    const provider = new RefreshingTokenProvider({
      store: deps.tokenStore,
      stored,
      initial: { accessToken: enrolled.accessToken, accessExpiresAt: enrolled.accessExpiresAt },
      fetchImpl: deps.fetchImpl,
    });
    const adapter =
      deps.createAdapter?.({ cloudUrl, enrolled, provider: provider.provider() }) ??
      new HttpCloudAdapter({
        baseUrl: cloudUrl,
        tokenProvider: provider.provider(),
        allowInsecure: deps.allowInsecure,
        fetch: deps.fetchImpl,
      });
    const clock = new HybridLogicalClock(hlcDeviceId(enrolled.deviceId));
    const summary = await pullChanges(staging.db, adapter, {
      entityTypes: registeredEntityTypes(),
      apply: createChangeApplier(staging.db, { clock, now: deps.now }),
      limit: 500,
      maxPages: 100_000,
      clock,
      now: deps.now,
      onProgress: (p: PullProgress) =>
        report({ received: p.received, applied: p.applied, byType: p.byType }),
    });
    const waiting = Object.entries(summary.blocked);
    if (waiting.length > 0)
      throw new JoinError(
        `The data from Head Office is incomplete (${waiting.map(([t, why]) => `${t}: ${why}`).join('; ')}). Try again in a few minutes`,
        stage,
      );

    at('checking');
    const problem = verifyJoinedDatabase(staging.db, {
      tenantId: enrolled.tenantId,
      branchId: enrolled.branch.id,
      branchCode: enrolled.branch.code,
    });
    if (problem) throw new JoinError(problem, stage);

    at('saving');
    copyStagedDatabase(staging.raw, deps.live.raw);
    staging.close();
    staging = null;
    removeDatabaseFiles(deps.stagingFile);
    try {
      ensurePharmacyDefaults(deps.live.db); // walk-in customer and any default the pull did not bring
    } catch {
      // Not fatal: the same call runs again at every server start.
    }
    at('done');
    return {
      tenantId: enrolled.tenantId,
      tenantName: enrolled.tenantName,
      branchId: enrolled.branch.id,
      branchCode: enrolled.branch.code,
      deviceId: enrolled.deviceId,
      eventsReceived: summary.received,
      byType: { ...progress.byType },
      seconds: (Date.now() - started) / 1000,
    };
  } catch (error) {
    try {
      staging?.close();
    } catch {
      // already closed
    }
    if (existsSync(deps.stagingFile) || existsSync(`${deps.stagingFile}-wal`))
      removeDatabaseFiles(deps.stagingFile);
    if (credentialsSaved) await deps.tokenStore.clear().catch(() => undefined);
    if (error instanceof JoinError) throw error;
    throw new JoinError(error instanceof Error ? error.message : 'The join failed', stage);
  }
}
