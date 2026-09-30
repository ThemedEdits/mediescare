import { can } from '@mediescare/core';
import { serverIsHeadOffice } from '@/server/branch-join';
import { requirePage } from '@/server/page-auth';
import { BranchesClient } from './branches-client';

export const dynamic = 'force-dynamic';

export default async function BranchesPage() {
  const auth = await requirePage('admin.branch.view');
  const headOffice = serverIsHeadOffice();
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <BranchesClient
        headOffice={headOffice}
        canCreate={headOffice && can(auth.access, 'admin.branch.create')}
      />
    </main>
  );
}
