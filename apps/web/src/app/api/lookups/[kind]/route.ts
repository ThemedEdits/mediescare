import { z } from 'zod';
import { createCategory, createManufacturer, createRack } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

const Body = z.object({ name: z.string().trim().min(1).max(80) });

/** Quick-add of a category, manufacturer or rack from the item form. */
export const POST = withPermission(
  'pharmacy.item.create',
  async (request, auth, ctx: { params: Promise<{ kind: string }> }) => {
    const { kind } = await ctx.params;
    const { name } = Body.parse(await request.json());
    const db = getDb();
    const wc = writeContext(auth.userId);
    if (kind === 'categories') return json({ id: createCategory(db, wc, name) }, 201);
    if (kind === 'manufacturers') return json({ id: createManufacturer(db, wc, name) }, 201);
    if (kind === 'racks') return json({ id: createRack(db, wc, name) }, 201);
    return json({ error: { code: 'NOT_FOUND' } }, 404);
  },
);
