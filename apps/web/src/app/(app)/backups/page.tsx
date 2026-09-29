import { can } from '@mediescare/core';
import { requirePage } from '@/server/page-auth';
import { BackupsClient } from './backups-client';

export const dynamic = 'force-dynamic';

export default async function BackupsPage() {
  const auth = await requirePage('admin.backup.view');
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-6">
      <BackupsClient
        canCreate={can(auth.access, 'admin.backup.create')}
        canRotate={can(auth.access, 'admin.backup.edit')}
      />
    </main>
  );
}
