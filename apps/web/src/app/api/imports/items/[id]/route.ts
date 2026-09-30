import { z } from 'zod';
import { getImportJob, remapImportJob, startImportJob } from '@mediescare/db';
import { json, withPermission } from '@/server/guard';
import { jobView, MappingBody, toMapping } from '@/server/items-import';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('commit'),
    importStock: z.boolean(),
    defaultExpiry: z.string().max(10).nullish(),
  }),
  z.object({
    action: z.literal('remap'),
    mapping: MappingBody,
    importStock: z.boolean().default(false),
  }),
]);

/** Status and progress of an import. The browser polls this while the commit runs. */
export const GET = withPermission('pharmacy.item.import', async (_request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  const write = writeContext(auth.userId);
  return json(jobView(getImportJob(id, write.tenantId, auth.userId)));
});

/** `commit` starts the background import and returns at once. `remap` validates the file again. */
export const POST = withPermission('pharmacy.item.import', async (request, auth, ctx: Ctx) => {
  const { id } = await ctx.params;
  const body = Body.parse(await request.json());
  const write = writeContext(auth.userId);
  const job = getImportJob(id, write.tenantId, auth.userId);
  if (body.action === 'remap') {
    remapImportJob(getDb(), write, job, toMapping(body.mapping), { importStock: body.importStock });
    return json(jobView(job));
  }
  startImportJob(getDb(), write, job, {
    importStock: body.importStock,
    defaultExpiry: body.defaultExpiry ?? null,
  });
  return json(jobView(job), 202);
});
