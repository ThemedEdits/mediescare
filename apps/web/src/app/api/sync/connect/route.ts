import { eq } from 'drizzle-orm';
import { schema } from '@mediescare/db';
import { bootstrapHeadOffice, CloudRequestError, normaliseCloudUrl } from '@mediescare/sync';
import { json, withPermission } from '@/server/guard';
import { getDb, getIdentity, getRuntime, writeContext } from '@/server/runtime';
import { ConnectBodySchema } from '@/server/sync-schemas';
import { auditCloudLink, connectToCloud, getSyncRunner } from '@/server/sync-runtime';

export const dynamic = 'force-dynamic';

/**
 * Head Office PC: connect this database to a cloud. The form gives the cloud address, the cloud's
 * bootstrap code and the organisation name; the branch code, name and ids come from this database,
 * so its existing events are accepted. Uploading the whole history then starts in the background.
 * Branches do not use this: they join with an enrollment code on the setup screen.
 */
export const POST = withPermission('admin.sync.edit', async (request, auth) => {
  const body = ConnectBodySchema.parse(await request.json());
  const runtime = getRuntime();
  const db = getDb();
  const identity = getIdentity();
  const branch = db
    .select({
      code: schema.branches.code,
      name: schema.branches.name,
      isHeadOffice: schema.branches.isHeadOffice,
    })
    .from(schema.branches)
    .where(eq(schema.branches.id, identity.branchId))
    .get();
  if (!branch?.isHeadOffice) {
    return json(
      {
        error: {
          code: 'NOT_HEAD_OFFICE',
          message:
            'Only the Head Office PC connects with a bootstrap code. A branch joins with an enrollment code from Head Office.',
        },
      },
      409,
    );
  }
  const current = getSyncRunner()?.status();
  if (current && current.state !== 'revoked') {
    return json(
      {
        error: {
          code: 'ALREADY_CONNECTED',
          message: 'This PC is already connected. Disconnect first.',
        },
      },
      409,
    );
  }
  let cloudUrl: string;
  try {
    cloudUrl = normaliseCloudUrl(
      body.cloudUrl,
      process.env.MEDIESCARE_CLOUD_ALLOW_INSECURE === '1',
    );
  } catch (error) {
    return json(
      {
        error: {
          code: 'INVALID_INPUT',
          message: error instanceof Error ? error.message : 'Invalid address',
        },
      },
      400,
    );
  }
  const device = db
    .select({ name: schema.devices.name })
    .from(schema.devices)
    .where(eq(schema.devices.id, identity.deviceId))
    .get();
  try {
    const result = await bootstrapHeadOffice({
      cloudUrl,
      bootstrapCode: body.bootstrapCode,
      organisationName: body.organisationName,
      branchCode: branch.code,
      branchName: branch.name,
      deviceName: device?.name ?? 'Head Office server',
      identity,
    });
    const input = {
      db,
      dataDir: runtime.dataDir,
      auditContext: () => writeContext(null),
    };
    connectToCloud(input, cloudUrl, result);
    auditCloudLink(db, writeContext(auth.userId), 'sync.cloud.connect', {
      cloudHost: new URL(cloudUrl).host,
      organisation: result.tenantName,
    });
    return json({ connected: true, cloudHost: new URL(cloudUrl).host }, 201);
  } catch (error) {
    if (error instanceof CloudRequestError) {
      return json(
        { error: { code: error.code ?? 'CLOUD_UNREACHABLE', message: error.message } },
        error.status === null ? 502 : error.status === 429 ? 429 : 409,
      );
    }
    throw error;
  }
});
