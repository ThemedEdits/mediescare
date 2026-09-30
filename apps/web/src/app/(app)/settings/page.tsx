import { can } from '@mediescare/core/permissions';
import { requirePage } from '@/server/page-auth';
import { SettingsClient } from './settings-client';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const auth = await requirePage('admin.settings.view');
  return (
    <main className="mx-auto max-w-4xl space-y-4 p-6">
      <SettingsClient
        branchName={auth.branchName ?? ''}
        canEdit={can(auth.access, 'admin.settings.edit')}
        canSync={can(auth.access, 'admin.sync.edit')}
        canPair={can(auth.access, 'admin.device.create')}
      />
    </main>
  );
}
