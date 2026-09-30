import { requirePage } from '@/server/page-auth';
import { ReportsClient } from './reports-client';

export const dynamic = 'force-dynamic';

export default async function ReportsPage() {
  const auth = await requirePage('reports.sales.view');
  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <ReportsClient branchName={auth.branchName ?? ''} />
    </main>
  );
}
