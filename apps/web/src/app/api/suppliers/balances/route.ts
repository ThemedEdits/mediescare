import { listSupplierBalances } from '@mediescare/db';
import { withPermission } from '@/server/guard';
import { jsonFor } from '@/server/respond';
import { getDb, writeContext } from '@/server/runtime';

export const dynamic = 'force-dynamic';

export const GET = withPermission('purchasing.supplier_payment.view', (request, auth) => {
  const params = request.nextUrl.searchParams;
  return jsonFor(auth, {
    balances: listSupplierBalances(getDb(), writeContext(auth.userId), {
      q: params.get('q') ?? undefined,
      onlyOwing: params.get('onlyOwing') === '1',
    }),
  });
});
