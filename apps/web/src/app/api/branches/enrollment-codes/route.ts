import { issueBranchEnrollment } from '@mediescare/db';
import { EnrollmentCodeBody } from '@/server/branch-join-schemas';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';
import { getCloudAccess } from '@/server/sync-runtime';

export const dynamic = 'force-dynamic';

/**
 * Head Office adds a branch (code and name) and gets a one-time enrollment code for the branch PC.
 * The code is returned once in this response and is not stored or logged here. Needs a password
 * session (admin.* permissions never work with a quick PIN) and this PC connected to the cloud.
 */
export const POST = withPermission('admin.branch.create', async (request, auth) => {
  const body = EnrollmentCodeBody.parse(await request.json());
  const access = getCloudAccess();
  if (!access) {
    return json(
      {
        error: {
          code: 'NOT_CONNECTED',
          message:
            'This PC is not connected to the cloud. Connect it first (Settings > Cloud sync), then create the code',
        },
      },
      409,
    );
  }
  const issued = await issueBranchEnrollment(getDb(), writeContext(auth.userId), body, {
    cloudUrl: access.cloudUrl,
    provider: access.provider,
  });
  return json(
    {
      branch: issued.branch,
      code: issued.code,
      expiresAt: issued.expiresAt,
      cloudUrl: access.cloudUrl,
      branchCreated: issued.branchCreated,
    },
    201,
  );
});
