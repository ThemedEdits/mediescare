'use client';

import { useState } from 'react';
import { useT } from '@/i18n/client';
import { CashBookTab } from './cashbook-tab';
import { CategoriesTab } from './categories-tab';
import { ExpensesTab } from './expenses-tab';
import { ProfitTab } from './profit-tab';

interface Props {
  branchName: string;
  canCreate: boolean;
  canVoid: boolean;
  canBackdate: boolean;
  canManageCategories: boolean;
  canCashBook: boolean;
  canCashBookExport: boolean;
  canCashEntries: boolean;
  canProfit: boolean;
  canProfitExport: boolean;
}

type Tab = 'expenses' | 'categories' | 'cashBook' | 'profit';

/** Basic accounts: expenses, categories, cash book and profit and loss. */
export function AccountsClient(props: Props) {
  const t = useT();
  const tabs: Tab[] = [
    'expenses',
    'categories',
    ...(props.canCashBook ? (['cashBook'] as const) : []),
    ...(props.canProfit ? (['profit'] as const) : []),
  ];
  const [tab, setTab] = useState<Tab>('expenses');
  return (
    <div className="space-y-4">
      <div className="no-print">
        <h1 className="text-2xl font-semibold">{t('accounts.title')}</h1>
        <p className="text-sm text-muted">
          {props.branchName ? `${props.branchName} · ` : ''}
          {t('accounts.intro')}
        </p>
      </div>
      <div className="no-print flex flex-wrap gap-1 border-b border-border" role="tablist">
        {tabs.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              tab === id
                ? 'border-primary-600 font-semibold text-primary-700'
                : 'border-transparent text-slate-700 hover:bg-surface-2'
            }`}
          >
            {t(`accounts.tabs.${id}`)}
          </button>
        ))}
      </div>
      {tab === 'expenses' ? (
        <ExpensesTab
          canCreate={props.canCreate}
          canVoid={props.canVoid}
          canBackdate={props.canBackdate}
        />
      ) : null}
      {tab === 'categories' ? <CategoriesTab canManage={props.canManageCategories} /> : null}
      {tab === 'cashBook' ? (
        <CashBookTab canExport={props.canCashBookExport} canAdjust={props.canCashEntries} />
      ) : null}
      {tab === 'profit' ? <ProfitTab canExport={props.canProfitExport} /> : null}
    </div>
  );
}
