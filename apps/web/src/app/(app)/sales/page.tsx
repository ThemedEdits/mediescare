import { can } from '@mediescare/core/permissions';
import { requirePage } from '@/server/page-auth';
import { SalesClient } from './sales-client';

export const dynamic = 'force-dynamic';

export default async function SalesPage() {
  const auth = await requirePage('pharmacy.sale.view');
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <SalesClient
        canVoid={can(auth.access, 'pharmacy.sale.create')}
        canReturn={can(auth.access, 'pharmacy.sale_return.create')}
        canSeeProfit={can(auth.access, 'pharmacy.sale.view_profit')}
      />
    </main>
  );
}
