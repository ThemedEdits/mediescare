import { can } from '@mediescare/core/permissions';
import { describeOwnBranch } from '@mediescare/db';
import { requirePage } from '@/server/page-auth';
import { getDb, writeContext } from '@/server/runtime';
import { TransfersClient } from './transfers-client';
import type { TransferAbilities } from './types';

export const dynamic = 'force-dynamic';

export default async function TransfersPage() {
  const auth = await requirePage('inventory.transfer.view');
  const branch = describeOwnBranch(getDb(), writeContext(auth.userId));
  const allow = (key: Parameters<typeof can>[1]) => can(auth.access, key);
  const abilities: TransferAbilities = {
    isHeadOffice: branch.isHeadOffice,
    branchName: branch.name,
    createRequisition: allow('inventory.requisition.create'),
    approveRequisition: allow('inventory.requisition.approve'),
    createTransfer: allow('inventory.transfer.create'),
    dispatch: allow('inventory.transfer.approve'),
    cancelTransfer: allow('inventory.transfer.edit'),
    receive: allow('inventory.transfer.create'),
    print: allow('inventory.transfer.print'),
    viewStock: allow('inventory.stock.view'),
  };
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <TransfersClient abilities={abilities} />
    </main>
  );
}
