import { requirePage } from '@/server/page-auth';
import { ImportClient } from './import-client';

export const dynamic = 'force-dynamic';

export default async function ImportItemsPage() {
  await requirePage('pharmacy.item.import');
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <ImportClient />
    </main>
  );
}
