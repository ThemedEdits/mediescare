import { can } from '@mediescare/core/permissions';
import { requirePage } from '@/server/page-auth';
import { StockTakeClient } from './stock-take-client';

export const dynamic = 'force-dynamic';

export default async function StockTakePage() {
  const auth = await requirePage('inventory.count.view');
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <StockTakeClient
        canCount={can(auth.access, 'inventory.count.create')}
        canPost={can(auth.access, 'inventory.count.approve')}
      />
    </main>
  );
}
