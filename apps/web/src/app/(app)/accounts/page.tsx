import { can } from '@mediescare/core/permissions';
import { requirePage } from '@/server/page-auth';
import { AccountsClient } from './accounts-client';

export const dynamic = 'force-dynamic';

export default async function AccountsPage() {
  const auth = await requirePage('finance.expense.view');
  const allow = (key: string) => can(auth.access, key, auth.branchId ?? undefined);
  return (
    <main className="mx-auto max-w-7xl space-y-4 p-6">
      <AccountsClient
        branchName={auth.branchName ?? ''}
        canCreate={allow('finance.expense.create')}
        canVoid={allow('finance.expense.delete')}
        canBackdate={allow('pharmacy.sale.backdate')}
        canManageCategories={allow('finance.expense_category.edit')}
        canCashBook={allow('reports.financial.view')}
        canCashBookExport={allow('reports.financial.export')}
        canCashEntries={allow('finance.ledger.create')}
        canProfit={allow('reports.profit.view')}
        canProfitExport={allow('reports.profit.export')}
      />
    </main>
  );
}
