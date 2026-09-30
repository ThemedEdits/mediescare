import { receiveGrn } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';
import { GrnBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

/** Goods receipt ("Add stock"): creates batches and posts purchase movements in one transaction. */
export const POST = withPermission('purchasing.grn.create', async (request, auth) => {
  const result = receiveGrn(
    getDb(),
    writeContext(auth.userId),
    GrnBody.parse(await request.json()),
  );
  return jsonFor(auth, result, 201);
});
