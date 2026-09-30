import { paySupplier } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';
import { SupplierPaymentBody } from '@/server/schemas';

export const dynamic = 'force-dynamic';

export const POST = withPermission('purchasing.supplier_payment.create', async (request, auth) =>
  jsonFor(
    auth,
    paySupplier(
      getDb(),
      writeContext(auth.userId),
      SupplierPaymentBody.parse(await request.json()),
    ),
    201,
  ),
);
