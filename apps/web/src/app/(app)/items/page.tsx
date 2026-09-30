import { can } from '@mediescare/core/permissions';
import { requirePage } from '@/server/page-auth';
import { ItemsClient } from './items-client';

export const dynamic = 'force-dynamic';

export default async function ItemsPage() {
  const auth = await requirePage('pharmacy.item.view');
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <ItemsClient
        canCreate={can(auth.access, 'pharmacy.item.create')}
        canImport={can(auth.access, 'pharmacy.item.import')}
        canEdit={can(auth.access, 'pharmacy.item.edit')}
        canSeeCost={can(auth.access, 'pharmacy.item.view_cost')}
      />
    </main>
  );
}
