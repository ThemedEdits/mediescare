import { z } from 'zod';
import { allBranchSettings, setSetting } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('admin.settings.view', (_request, auth) =>
  json({ settings: allBranchSettings(getDb(), writeContext(auth.userId)) }),
);

const Body = z.object({
  rounding: z.enum(['none', 'rupee', 'half_rupee']).optional(),
  invoiceNote: z.string().trim().max(200).optional(),
});

export const PUT = withPermission('admin.settings.edit', async (request, auth) => {
  const body = Body.parse(await request.json());
  const db = getDb();
  const ctx = writeContext(auth.userId);
  if (body.rounding !== undefined) setSetting(db, ctx, 'pos.rounding', body.rounding);
  if (body.invoiceNote !== undefined) setSetting(db, ctx, 'pos.invoice_note', body.invoiceNote);
  return json({ settings: allBranchSettings(db, ctx) });
});
