import { can } from '@mediescare/core/permissions';
import { requirePage } from '@/server/page-auth';
import { PurchasingClient } from './purchasing-client';

export const dynamic = 'force-dynamic';

export default async function PurchasingPage() {
  const auth = await requirePage('purchasing.supplier.view');
  const allow = (key: Parameters<typeof can>[1]) => can(auth.access, key);
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <PurchasingClient
        branchName={auth.branchName ?? ''}
        can={{
          viewOrders: allow('purchasing.purchase_order.view'),
          createOrder: allow('purchasing.purchase_order.create'),
          editOrder: allow('purchasing.purchase_order.edit'),
          approveOrder: allow('purchasing.purchase_order.approve'),
          viewBills: allow('purchasing.grn.view'),
          receive: allow('purchasing.grn.create'),
          viewAccounts: allow('purchasing.supplier_payment.view'),
          pay: allow('purchasing.supplier_payment.create'),
          viewReturns: allow('purchasing.purchase_return.view'),
          createReturn: allow('purchasing.purchase_return.create'),
          addSupplier: allow('purchasing.supplier.create'),
        }}
      />
    </main>
  );
}
