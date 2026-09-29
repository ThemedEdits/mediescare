import { z } from 'zod';
import { checkPasswordPolicy, hashPassword, isInitialized, runFirstRunSetup } from '@mediescare/db';
import { json, publicRoute } from '@/server/guard';
import { getDb } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({
  tenantName: z.string().trim().min(2).max(120),
  branchCode: z.string().regex(/^[A-Z][A-Z0-9]{1,7}$/, 'Use 2-8 capital letters or digits, starting with a letter'),
  branchName: z.string().trim().min(2).max(120),
  isHeadOffice: z.boolean(),
  admin: z.object({
    username: z.string().trim().min(3).max(40).regex(/^[a-z0-9._-]+$/, 'Lowercase letters, digits, dot, dash, underscore'),
    fullName: z.string().trim().min(2).max(120),
    password: z.string().min(1).max(200),
  }),
});

/**
 * First-run only: creates the tenant, branch and Super Admin. It is open (no session exists yet)
 * but refuses as soon as the database is initialised, so it cannot be used to take over a server.
 */
export const POST = publicRoute(async (request) => {
  const db = getDb();
  if (isInitialized(db)) return json({ error: { code: 'ALREADY_INITIALIZED' } }, 409);
  const body = Body.parse(await request.json());
  const policy = checkPasswordPolicy(body.admin.password, body.admin.username);
  if (!policy.ok) return json({ error: { code: 'WEAK_PASSWORD', problems: policy.problems } }, 400);

  const result = runFirstRunSetup(db, {
    tenantName: body.tenantName,
    branchCode: body.branchCode,
    branchName: body.branchName,
    isHeadOffice: body.isHeadOffice,
    deviceName: process.env.COMPUTERNAME ?? 'Branch Server',
    admin: {
      username: body.admin.username,
      fullName: body.admin.fullName,
      passwordHash: await hashPassword(body.admin.password),
    },
  });
  return json({ ok: true, branchId: result.branchId, sampleDocNo: result.sampleDocNo }, 201);
});
