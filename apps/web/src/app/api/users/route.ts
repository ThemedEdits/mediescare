import { z } from 'zod';
import { createUser, listUsers } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('admin.user.view', (request, auth) => {
  const q = request.nextUrl.searchParams;
  const status = q.get('status');
  const users = listUsers(getDb(), writeContext(auth.userId).tenantId, {
    q: q.get('q') ?? undefined,
    status: status === 'active' || status === 'disabled' ? status : undefined,
    roleCode: q.get('role') ?? undefined,
  });
  return json({ users });
});

const Create = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-z0-9._-]+$/, 'Lowercase letters, digits, dot, dash, underscore'),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200).nullish(),
  phone: z.string().trim().max(30).nullish(),
  language: z.enum(['en', 'ur']).optional(),
  password: z.string().max(200).optional(),
  roleIds: z.array(z.string()).min(1),
  branchIds: z.array(z.string()),
  allBranches: z.boolean().optional(),
});

export const POST = withPermission('admin.user.create', async (request, auth) => {
  const body = Create.parse(await request.json());
  const result = await createUser(getDb(), writeContext(auth.userId), body);
  // The temporary password is shown once to the admin and is not stored in readable form.
  return json({ id: result.id, temporaryPassword: result.temporaryPassword ?? null }, 201);
});
