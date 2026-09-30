import { z } from 'zod';
import { allBranchSettings, setSettings } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

/**
 * Branch settings (POS, printing, tax defaults). Reading is allowed to anyone who can open the POS
 * screens through /api/lookups; this route is for the settings screen and needs the admin right.
 */
export const GET = withPermission('admin.settings.view', (_request, auth) =>
  json({ settings: allBranchSettings(getDb(), writeContext(auth.userId)) }),
);

const Body = z.object({
  settings: z.record(z.string(), z.union([z.string().max(600), z.number(), z.boolean()])),
});

/** Save any subset of settings in one step. Each value is validated by the database layer. */
export const PUT = withPermission('admin.settings.edit', async (request, auth) => {
  const { settings } = Body.parse(await request.json());
  const db = getDb();
  const ctx = writeContext(auth.userId);
  setSettings(db, ctx, settings);
  return json({ settings: allBranchSettings(db, ctx) });
});
