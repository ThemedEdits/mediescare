import { can } from '@mediescare/core';
import { requirePage } from '@/server/page-auth';
import { UsersClient } from './users-client';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const auth = await requirePage('admin.user.view');
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-6">
      <UsersClient
        me={auth.userId}
        canCreate={can(auth.access, 'admin.user.create')}
        canEdit={can(auth.access, 'admin.user.edit')}
      />
    </main>
  );
}
