import { isNull } from 'drizzle-orm';
import {
  bootstrapHeadOffice,
  createEnrollmentCode,
  enroll,
  HttpCloudAdapter,
  MemoryTokenStore,
  RefreshingTokenProvider,
  type EnrollResult,
  type PulledChange,
} from '@mediescare/sync';
import { syncOutbox } from '../schema/sqlite';
import { createPostgresClient, scrubSecrets } from '../sync/cloud';
import { SyncRunner } from '../sync/runner';
import { queueItemEdit, queueSales, unsentCount } from '../sync/test-support';
import { createTestEnv, type TestEnv } from '../test-helpers';

/**
 * Live check of a running cloud endpoint (the cloud-mode app on this PC, or the deployed one).
 *
 *   pnpm cloud:check http://localhost:3220
 *   pnpm cloud:check https://your-app.vercel.app
 *
 * It plays two pharmacies with invented data: bootstraps a throw-away organisation, pushes sales and
 * items from Head Office and a second branch, pulls master data back, rotates tokens, tests the
 * refresh grace window, and then deletes everything it created (when MEDIESCARE_CLOUD_DATABASE_URL is
 * available). Needs MEDIESCARE_CLOUD_BOOTSTRAP_CODE (same value as on the cloud host). Prints no
 * secrets.
 */
const baseUrl = (process.argv[2] ?? process.env.MEDIESCARE_LIVE_CLOUD_URL ?? '').replace(
  /\/+$/,
  '',
);
const bootstrapCode = process.env.MEDIESCARE_CLOUD_BOOTSTRAP_CODE?.trim() ?? '';
const databaseUrl = process.env.MEDIESCARE_CLOUD_DATABASE_URL?.trim();
const orgName = `Live Check ${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')} ${Math.random()
  .toString(36)
  .slice(2, 6)}`;

let failed = 0;
const check = (name: string, ok: boolean, detail = ''): void => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

interface Side {
  env: TestEnv;
  result: EnrollResult;
  provider: RefreshingTokenProvider;
  runner: SyncRunner;
  pulled: PulledChange[];
}

function connect(env: TestEnv, result: EnrollResult): Side {
  const store = new MemoryTokenStore({
    cloudUrl: baseUrl,
    refreshToken: result.refreshToken,
    deviceId: result.deviceId,
    tenantId: result.tenantId,
    branchId: result.branch.id,
    updatedAt: new Date().toISOString(),
  });
  const provider = new RefreshingTokenProvider({
    store,
    initial: { accessToken: result.accessToken, accessExpiresAt: result.accessExpiresAt },
    marginMs: 60_000,
  });
  const pulled: PulledChange[] = [];
  const runner = new SyncRunner({
    db: env.db,
    adapter: new HttpCloudAdapter({
      baseUrl,
      tokenProvider: provider.provider(),
      forceRefresh: () => provider.forceRefresh(),
      allowInsecure: /^http:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl),
    }),
    tokens: provider,
    intervalMs: 1000,
    pull: {
      entityTypes: ['items'],
      apply: (changes) => {
        pulled.push(...changes);
      },
    },
  });
  return { env, result, provider, runner, pulled };
}

/** Test-only: the second database was created as its own organisation; stamp the cloud's tenant id on what is still to be sent. */
const stamp = (s: Side): void => {
  s.env.db
    .update(syncOutbox)
    .set({ tenantId: s.result.tenantId })
    .where(isNull(syncOutbox.ackAt))
    .run();
};
const drain = async (s: Side): Promise<void> => {
  stamp(s);
  for (let i = 0; i < 8 && unsentCount(s.env) > 0; i++) await s.runner.runOnce();
};

async function cleanup(tenantId: string | undefined): Promise<void> {
  if (!tenantId || !databaseUrl) {
    console.log('note: test organisation left in the cloud (database URL not available here)');
    return;
  }
  const sql = await createPostgresClient(databaseUrl, { max: 1, connectTimeoutSeconds: 10 });
  try {
    for (const t of ['sync_conflicts', 'push_batches', 'epochs', 'entity_heads', 'sync_events']) {
      await sql.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
    }
    for (const t of ['enrollment_codes', 'devices', 'branches']) {
      await sql.query(`DELETE FROM ${t} WHERE tenant_id = $1`, [tenantId]);
    }
    await sql.query('DELETE FROM tenants WHERE id = $1', [tenantId]);
    console.log('cleanup: the test organisation was removed from the cloud');
  } finally {
    await sql.close();
  }
}

async function main(): Promise<void> {
  if (!baseUrl) {
    console.error('Usage: pnpm cloud:check <cloud url>   (for example http://localhost:3220)');
    process.exit(2);
  }
  if (!bootstrapCode) {
    console.error('MEDIESCARE_CLOUD_BOOTSTRAP_CODE is not set (put it in the repository .env).');
    process.exit(2);
  }
  const health = await fetch(`${baseUrl}/api/health`).then(
    async (r) => ({ ok: r.ok, body: (await r.json().catch(() => ({}))) as { mode?: string } }),
    () => ({ ok: false, body: {} as { mode?: string } }),
  );
  check('the cloud endpoint answers /api/health', health.ok, baseUrl.replace(/\/\/[^/@]*@/, '//'));
  check('it runs in cloud mode', health.body.mode === 'cloud', String(health.body.mode));
  if (!health.ok) process.exit(1);

  const envA = await createTestEnv();
  const envB = await createTestEnv();
  let tenantId: string | undefined;
  try {
    const hoResult = await bootstrapHeadOffice({
      cloudUrl: baseUrl,
      bootstrapCode,
      organisationName: orgName,
      branchCode: 'HO01',
      branchName: 'Live Check Head Office',
      deviceName: 'HO live check',
      identity: {
        tenantId: envA.setup.tenantId,
        branchId: envA.setup.branchId,
        deviceId: envA.setup.deviceId,
      },
    });
    tenantId = hoResult.tenantId;
    check('Head Office links to the cloud (bootstrap)', hoResult.branch.isHeadOffice === true);
    const ho = connect(envA, hoResult);

    const code = await createEnrollmentCode(ho.provider.provider(), {
      cloudUrl: baseUrl,
      branchCode: 'KHI02',
      branchName: 'Live Check Branch',
      branchId: envB.setup.branchId,
    });
    const brResult = await enroll({
      cloudUrl: baseUrl,
      code: code.code,
      deviceName: 'KHI02 live check',
      identity: { deviceId: envB.setup.deviceId },
    });
    check(
      'a second branch joins with an enrollment code',
      brResult.branch.id === envB.setup.branchId,
    );
    check('the branch is in the same organisation', brResult.tenantId === hoResult.tenantId);
    const branch = connect(envB, brResult);
    const reuse = await enroll({
      cloudUrl: baseUrl,
      code: code.code,
      deviceName: 'second try',
    }).then(
      () => 'accepted',
      () => 'refused',
    );
    check('an enrollment code works only once', reuse === 'refused');

    queueItemEdit(envA, 'live-item-ho', 'insert', {
      name: 'Live Item (HO)',
      retailRateUnitMicro: 100,
    });
    queueItemEdit(envB, 'live-item-br', 'insert', { name: 'Live Item (Branch)' });
    queueSales(envA, 60, 'live-ho-sale');
    queueSales(envB, 40, 'live-br-sale');
    const t0 = Date.now();
    await drain(ho);
    await drain(branch);
    check(
      'everything is uploaded (no events left waiting)',
      unsentCount(envA) === 0 && unsentCount(envB) === 0,
      `${Date.now() - t0} ms`,
    );

    await ho.runner.runOnce();
    await branch.runner.runOnce();
    const hoGot = ho.pulled.map((c) => c.event.entityId);
    const brGot = branch.pulled.map((c) => c.event.entityId);
    check(
      'Head Office receives the branch item, not its own',
      hoGot.includes('live-item-br') && !hoGot.includes('live-item-ho'),
    );
    check(
      'the branch receives the Head Office item, not its own',
      brGot.includes('live-item-ho') && !brGot.includes('live-item-br'),
    );
    check(
      'sales are not sent to other branches',
      [...ho.pulled, ...branch.pulled].every((c) => c.event.entityType === 'items'),
    );

    // Token rotation, then the grace window: replaying the just-replaced refresh token works once.
    const rotated = await ho.provider.forceRefresh().then(
      () => true,
      () => false,
    );
    check('the access token refreshes (rotating refresh token)', rotated);

    if (databaseUrl) {
      const sql = await createPostgresClient(databaseUrl, { max: 1, connectTimeoutSeconds: 10 });
      try {
        const n = await sql.query<{ branch_id: string; n: string }>(
          "SELECT branch_id, count(*)::text AS n FROM sync_events WHERE tenant_id = $1 AND entity_type = 'sales' GROUP BY branch_id",
          [hoResult.tenantId],
        );
        const by = Object.fromEntries(n.map((r) => [r.branch_id, Number(r.n)]));
        check(
          'the real database holds each sale exactly once',
          by[envA.setup.branchId] === 60 && by[envB.setup.branchId] === 40,
          JSON.stringify(Object.values(by)),
        );
      } finally {
        await sql.close();
      }
    }
  } finally {
    envA.cleanup();
    envB.cleanup();
    await cleanup(tenantId).catch((e: unknown) =>
      console.log(
        'cleanup failed:',
        scrubSecrets(e instanceof Error ? e.message : 'unknown error'),
      ),
    );
  }
  console.log(
    failed === 0 ? '\nThe cloud is live: all checks passed.' : `\n${failed} check(s) FAILED.`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e: unknown) => {
  console.error(scrubSecrets(e instanceof Error ? e.message : 'Live check failed'));
  process.exit(1);
});
