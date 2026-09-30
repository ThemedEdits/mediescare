import { can } from '@mediescare/core/permissions';
import { requirePage } from '@/server/page-auth';
import { PosClient } from './pos-client';

export const dynamic = 'force-dynamic';

export default async function PosPage() {
  const auth = await requirePage('pharmacy.sale.create');
  return (
    <PosClient
      branchName={auth.branchName ?? ''}
      cashier={auth.fullName}
      canHold={can(auth.access, 'pharmacy.hold_invoice.create')}
      canMissed={can(auth.access, 'pharmacy.missed_sale.create')}
    />
  );
}
