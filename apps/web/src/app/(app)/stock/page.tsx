import { can } from '@mediescare/core/permissions';
import { requirePage } from '@/server/page-auth';
import { StockClient } from './stock-client';

export const dynamic = 'force-dynamic';

export default async function StockPage() {
  const auth = await requirePage('inventory.stock.view');
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <StockClient
        canReceive={can(auth.access, 'purchasing.grn.create')}
        canAdjust={can(auth.access, 'inventory.adjustment.create')}
        canSeeCost={can(auth.access, 'inventory.stock.view_cost')}
        canAddSupplier={can(auth.access, 'purchasing.supplier.create')}
      />
    </main>
  );
}
