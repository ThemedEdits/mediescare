import {
  checkPasswordPolicy,
  hashPassword,
  isInitialized,
  issueRecoveryKey,
  JoinError,
  runFirstRunSetup,
} from '@mediescare/db';
import {
  CreateOrganisationBody,
  JoinOrganisationBody,
  type JoinOrganisationInput,
} from '@/server/branch-join-schemas';
import { credentialsAfterJoin, joinStatus, JoinBusyError, runJoin } from '@/server/branch-join';
import { json, publicRoute } from '@/server/guard';
import { getDb, getRuntime, writeContext } from '@/server/runtime';
import { auditCloudLink, connectToCloud } from '@/server/sync-runtime';

export const dynamic = 'force-dynamic';

/**
 * Setup state for the first-run screen: whether the server is set up, and how far a running join
 * has got (the join screen polls this while its POST is busy). Nothing secret is returned.
 */
export const GET = publicRoute(() => {
  const initialized = isInitialized(getDb());
  return json({ initialized, join: initialized ? null : joinStatus() });
});

/**
 * First-run only. Two ways in, both refuse as soon as the database is initialised, so this cannot
 * be used to take over a server:
 * - create a new organisation (the first branch is always Head Office),
 * - join an existing organisation as a branch, with the enrollment code Head Office created.
 */
export const POST = publicRoute(async (request) => {
  const db = getDb();
  if (isInitialized(db)) return json({ error: { code: 'ALREADY_INITIALIZED' } }, 409);
  const raw: unknown = await request.json();
  const isJoin =
    typeof raw === 'object' && raw !== null && (raw as { mode?: unknown }).mode === 'join';
  if (isJoin) return joinExisting(JoinOrganisationBody.parse(raw));

  const body = CreateOrganisationBody.parse(raw);
  const policy = checkPasswordPolicy(body.admin.password, body.admin.username);
  if (!policy.ok) return json({ error: { code: 'WEAK_PASSWORD', problems: policy.problems } }, 400);

  const result = runFirstRunSetup(db, {
    tenantName: body.tenantName,
    branchCode: body.branchCode,
    branchName: body.branchName,
    // The first branch of a new organisation is Head Office; branches join it later.
    isHeadOffice: true,
    deviceName: process.env.COMPUTERNAME ?? 'Branch Server',
    admin: {
      username: body.admin.username,
      fullName: body.admin.fullName,
      passwordHash: await hashPassword(body.admin.password),
    },
  });
  // Shown to the owner exactly once. Only the wrapped database key is stored (ADR-0001).
  const runtime = getRuntime();
  const recoveryKey = issueRecoveryKey(runtime.dataDir, runtime.dbKeyHex);
  return json(
    { ok: true, branchId: result.branchId, sampleDocNo: result.sampleDocNo, recoveryKey },
    201,
  );
});

async function joinExisting(body: JoinOrganisationInput): Promise<Response> {
  const policy = checkPasswordPolicy(body.admin.password, body.admin.username);
  if (!policy.ok) return json({ error: { code: 'WEAK_PASSWORD', problems: policy.problems } }, 400);
  let result;
  try {
    result = await runJoin(body, await hashPassword(body.admin.password));
  } catch (error) {
    if (error instanceof JoinBusyError) return json({ error: { code: 'JOIN_RUNNING' } }, 409);
    if (error instanceof JoinError)
      return json(
        { error: { code: 'JOIN_FAILED', message: error.message, stage: error.stage } },
        400,
      );
    throw error;
  }

  const runtime = getRuntime();
  const recoveryKey = issueRecoveryKey(runtime.dataDir, runtime.dbKeyHex);
  // Start syncing now, without a restart. The join already works without it: a failure here only
  // means the first sync cycle waits for the next start of the app.
  try {
    const credentials = await credentialsAfterJoin(result);
    if (credentials) {
      const input = {
        db: getDb(),
        dataDir: runtime.dataDir,
        auditContext: () => {
          try {
            return writeContext(null);
          } catch {
            return null;
          }
        },
      };
      connectToCloud(input, credentials.cloudUrl, credentials.enrolled);
      auditCloudLink(getDb(), writeContext(null), 'sync.cloud.connect', {
        cloudHost: new URL(credentials.cloudUrl).host,
        organisation: result.tenantName,
      });
    }
  } catch (error) {
    console.error(
      '[join] branch joined, but the sync worker did not start:',
      error instanceof Error ? error.message : 'unknown',
    );
  }
  return json(
    {
      ok: true,
      branchId: result.branchId,
      branchCode: result.branchCode,
      recoveryKey,
      recordsReceived: result.eventsReceived,
      items: result.byType.items ?? 0,
      seconds: Math.round(result.seconds),
    },
    201,
  );
}
