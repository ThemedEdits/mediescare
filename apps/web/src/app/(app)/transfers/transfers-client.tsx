'use client';

import { useState } from 'react';
import { useT } from '@/i18n/client';
import { RequisitionsTab } from './requisitions-tab';
import { InTransitTab, TransfersTab } from './transfers-tab';
import { ReconciliationTab } from './reconciliation-tab';
import type { TransferAbilities } from './types';

type Tab = 'requisitions' | 'transfers' | 'transit' | 'reconciliation';

/**
 * Head Office to branch stock transfers. A branch asks (requisition), Head Office approves and ships
 * (transfer note, dispatch), the branch counts what arrived (receive). Goods between dispatch and
 * receipt are in transit: on the document, in nobody's stock.
 */
export function TransfersClient({ abilities }: { abilities: TransferAbilities }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('requisitions');
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const changed = (message?: string) => {
    setVersion((v) => v + 1);
    if (message) setToast(message);
  };
  const tabs: [Tab, string][] = [
    ['requisitions', t('transfers.tabs.requisitions')],
    ['transfers', t('transfers.tabs.transfers')],
    [
      'transit',
      abilities.isHeadOffice
        ? t('transfers.tabs.transitHeadOffice')
        : t('transfers.tabs.transitBranch'),
    ],
    ['reconciliation', t('transfers.tabs.reconciliation')],
  ];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('transfers.title')}</h1>
        <p className="text-sm text-muted">
          {abilities.branchName} ·{' '}
          {abilities.isHeadOffice
            ? t('transfers.subtitleHeadOffice')
            : t('transfers.subtitleBranch')}
        </p>
      </div>
      {toast ? (
        <p role="status" className="rounded-[6px] bg-[#E8F5E9] px-3 py-2 text-sm text-success">
          {toast}
        </p>
      ) : null}
      <div role="tablist" className="flex gap-1 border-b border-border">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === id ? 'border-primary-600 text-primary-700' : 'border-transparent text-muted hover:text-slate-900'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'requisitions' ? (
        <RequisitionsTab abilities={abilities} version={version} onChanged={changed} />
      ) : null}
      {tab === 'transfers' ? (
        <TransfersTab abilities={abilities} version={version} onChanged={changed} />
      ) : null}
      {tab === 'transit' ? (
        <InTransitTab abilities={abilities} version={version} onChanged={changed} />
      ) : null}
      {tab === 'reconciliation' ? (
        <ReconciliationTab abilities={abilities} version={version} />
      ) : null}
    </div>
  );
}
