'use client';

import { useState } from 'react';
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
  const [tab, setTab] = useState<Tab>('requisitions');
  const [version, setVersion] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const changed = (message?: string) => {
    setVersion((v) => v + 1);
    if (message) setToast(message);
  };
  const tabs: [Tab, string][] = [
    ['requisitions', 'Requisitions'],
    ['transfers', 'Transfers'],
    ['transit', abilities.isHeadOffice ? 'In transit' : 'In transit / Receive'],
    ['reconciliation', 'Reconciliation'],
  ];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Stock transfers</h1>
        <p className="text-sm text-muted">
          {abilities.branchName} ·{' '}
          {abilities.isHeadOffice
            ? 'Head Office: approve requisitions, write transfer notes and dispatch.'
            : 'Ask Head Office for stock and count what arrives.'}
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
