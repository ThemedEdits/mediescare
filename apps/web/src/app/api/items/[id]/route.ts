import { z } from 'zod';
import { getItem, updateItem } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';
import { ItemBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

export const GET = withPermission('pharmacy.item.view', async (_request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  return jsonFor(auth, { item: getItem(getDb(), writeContext(auth.userId).tenantId, id) });
});

const Update = ItemBody.extend({ expectedVersion: z.number().int().min(1) });

export const PUT = withPermission('pharmacy.item.edit', async (request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  updateItem(getDb(), writeContext(auth.userId), id, Update.parse(await request.json()));
  return jsonFor(auth, { ok: true });
});
