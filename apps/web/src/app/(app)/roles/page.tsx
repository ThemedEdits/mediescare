import { can } from '@mediescare/core';
import { requirePage } from '@/server/page-auth';
import { RolesClient } from './roles-client';

export const dynamic = 'force-dynamic';

export default async function RolesPage() {
  const auth = await requirePage('admin.role.view');
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <RolesClient
        canCreate={can(auth.access, 'admin.role.create')}
        canEdit={can(auth.access, 'admin.role.edit')}
        canDelete={can(auth.access, 'admin.role.delete')}
      />
    </main>
  );
}
