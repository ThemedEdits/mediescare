'use client';

import { useState, type ReactNode } from 'react';
import { api, Badge, Button, ErrorText, inputClass, useAsync } from '@/components/ui';
import { pkr } from '@/lib/format';
import type { TransferAbilities } from './types';

interface PositionCost {
  dispatchedMinor: number;
  receivedMinor: number;
  inTransitMinor: number;
  damagedMinor: number;
  shortMinor: number;
  differenceMinor: number;
}
interface Position {
  branchId: string;
  branchCode: string;
  branchName: string;
  role: 'shipper' | 'receiver';
  transfers: number;
  inTransitTransfers: number;
  qtyDispatched: number;
  qtyReceived: number;
  qtyDamaged: number;
  qtyShort: number;
  qtyInTransit: number;
  cost?: PositionCost;
}
interface PositionReport {
  positions: Position[];
  totals: Record<'shipper' | 'receiver', { transfers: number; cost?: PositionCost }>;
}
interface Quantities {
  qtyDispatched: number;
  qtyReceived: number;
  qtyDamaged: number;
  qtyShort: number;
  qtyInTransit: number;
}
interface Reconciliation {
  transfers: (Quantities & {
    id: string;
    docNo: string;
    status: string;
    direction: 'outgoing' | 'incoming';
    branchName: string;
    balanced: boolean;
    cost?: PositionCost;
  })[];
  items: (Quantities & { itemId: string; sku: string; name: string; cost?: PositionCost })[];
  totals: Quantities & { cost?: PositionCost; unbalanced: number };
  truncated: boolean;
}
interface LedgerCheck {
  ok: boolean;
  checkedAt: string;
  batchesChecked: number;
  movementsChecked: number;
  onHandBase: number;
  negativeBatches: { batchId: string; itemName: string; batchNo: string; balanceBase: number }[];
  orphanMovements: { movementId: string }[];
  mismatchedMovements: { movementId: string }[];
  signErrors: { movementId: string; kind: string; qtyBase: number }[];
  cost?: { stockValueMinor: number };
}

const money = (n: number | undefined) => (n === undefined ? '–' : pkr(n));

function Card({
  title,
  value,
  note,
  tone,
}: {
  title: string;
  value: string;
  note?: string;
  tone?: 'danger' | 'success';
}) {
  return (
    <div className="rounded-[10px] border border-border p-3">
      <p className="text-xs uppercase text-muted">{title}</p>
      <p
        className={`text-xl font-semibold tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'success' ? 'text-success' : ''}`}
      >
        {value}
      </p>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
    </div>
  );
}

function PositionCards({
  report,
  isHeadOffice,
}: {
  report: PositionReport;
  isHeadOffice: boolean;
}) {
  const role = isHeadOffice ? 'shipper' : 'receiver';
  const total = report.totals[role];
  const c = total.cost;
  const loss = c ? c.damagedMinor + c.shortMinor : undefined;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card
          title={isHeadOffice ? 'Dispatched to branches' : 'Dispatched to us'}
          value={money(c?.dispatchedMinor)}
          note={`${total.transfers} transfers`}
        />
        <Card title="Received" value={money(c?.receivedMinor)} />
        <Card title="In transit" value={money(c?.inTransitMinor)} />
        <Card
          title="Damage and shortage loss"
          value={money(loss)}
          tone={loss ? 'danger' : undefined}
        />
        <Card
          title="Difference"
          value={money(c?.differenceMinor)}
          note="Dispatched minus everything accounted for"
          tone={c ? (c.differenceMinor === 0 ? 'success' : 'danger') : undefined}
        />
      </div>
      {!c ? (
        <p className="text-xs text-muted">Values at cost are shown to users with the cost right.</p>
      ) : null}
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Branch</th>
              <th>{isHeadOffice ? 'We ship to it' : 'It ships to us'}</th>
              <th className="text-end">Transfers</th>
              <th className="text-end">In transit</th>
              <th className="text-end">Dispatched</th>
              <th className="text-end">Received</th>
              <th className="text-end">In transit value</th>
              <th className="text-end">Damaged</th>
              <th className="text-end">Short</th>
              <th className="px-3 text-end">Difference</th>
            </tr>
          </thead>
          <tbody>
            {report.positions
              .filter((p) => p.role === role)
              .map((p) => (
                <tr key={p.role + p.branchId} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">
                    {p.branchCode} · {p.branchName}
                  </td>
                  <td>{p.role === 'shipper' ? 'Sent' : 'Received'}</td>
                  <td className="text-end tabular-nums">{p.transfers}</td>
                  <td className="text-end tabular-nums">{p.inTransitTransfers}</td>
                  <td className="text-end tabular-nums">{money(p.cost?.dispatchedMinor)}</td>
                  <td className="text-end tabular-nums">{money(p.cost?.receivedMinor)}</td>
                  <td className="text-end tabular-nums">{money(p.cost?.inTransitMinor)}</td>
                  <td className="text-end tabular-nums">{money(p.cost?.damagedMinor)}</td>
                  <td className="text-end tabular-nums">{money(p.cost?.shortMinor)}</td>
                  <td className="px-3 text-end tabular-nums">{money(p.cost?.differenceMinor)}</td>
                </tr>
              ))}
            {report.positions.filter((p) => p.role === role).length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-8 text-center text-muted">
                  No transfers yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LedgerBox() {
  const [version, setVersion] = useState(0);
  const { data, error } = useAsync(() => api<LedgerCheck>('/api/stock/ledger-check'), [version]);
  const problems = data
    ? data.negativeBatches.length +
      data.orphanMovements.length +
      data.mismatchedMovements.length +
      data.signErrors.length
    : 0;
  return (
    <section className="space-y-2 rounded-[10px] border border-border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Stock ledger check</h2>
        <Button variant="outline" onClick={() => setVersion((v) => v + 1)}>
          Check again
        </Button>
      </div>
      <ErrorText message={error} />
      {data ? (
        <>
          <p className="text-sm">
            <Badge tone={data.ok ? 'success' : 'danger'}>
              {data.ok ? 'Ledger is consistent' : `${problems} problems`}
            </Badge>{' '}
            <span className="text-muted">
              {data.batchesChecked} batches and {data.movementsChecked} movements recomputed
              {data.cost ? ` · stock value at cost ${pkr(data.cost.stockValueMinor)}` : ''}
            </span>
          </p>
          <ProblemList title="Batches below zero" show={data.negativeBatches.length > 0}>
            {data.negativeBatches.map((b) => (
              <li key={b.batchId}>
                {b.itemName}, batch {b.batchNo}: {b.balanceBase}
              </li>
            ))}
          </ProblemList>
          <ProblemList title="Movements with no batch" show={data.orphanMovements.length > 0}>
            {data.orphanMovements.map((m) => (
              <li key={m.movementId} className="font-mono text-xs">
                {m.movementId}
              </li>
            ))}
          </ProblemList>
          <ProblemList
            title="Movements on another branch's or item's batch"
            show={data.mismatchedMovements.length > 0}
          >
            {data.mismatchedMovements.map((m) => (
              <li key={m.movementId} className="font-mono text-xs">
                {m.movementId}
              </li>
            ))}
          </ProblemList>
          <ProblemList title="Movements with the wrong sign" show={data.signErrors.length > 0}>
            {data.signErrors.map((m) => (
              <li key={m.movementId}>
                {m.kind} {m.qtyBase} <span className="font-mono text-xs">{m.movementId}</span>
              </li>
            ))}
          </ProblemList>
          {!data.ok ? (
            <p className="text-xs text-muted">
              History is never edited. A problem is corrected with a stock adjustment, a return or a
              recount.
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function ProblemList({
  title,
  show,
  children,
}: {
  title: string;
  show: boolean;
  children: ReactNode;
}) {
  return show ? (
    <div className="text-sm">
      <p className="font-medium text-danger">{title}</p>
      <ul className="list-disc ps-5">{children}</ul>
    </div>
  ) : null;
}

/** Inter-branch position, transfer reconciliation per transfer and per item, and the ledger integrity check. */
export function ReconciliationTab({
  abilities,
  version,
}: {
  abilities: TransferAbilities;
  version: number;
}) {
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const position = useAsync(
    () => api<PositionReport>('/api/transfers/reports/position'),
    [version],
  );
  const qs = new URLSearchParams();
  if (status) qs.set('status', status);
  if (from) qs.set('from', from);
  if (to) qs.set('to', to);
  const rec = useAsync(
    () => api<Reconciliation>(`/api/transfers/reports/reconciliation?${qs.toString()}`),
    [version, status, from, to],
  );
  const cell = (q: Quantities) => (
    <>
      <td className="text-end tabular-nums">{q.qtyDispatched}</td>
      <td className="text-end tabular-nums">{q.qtyReceived}</td>
      <td className="text-end tabular-nums">{q.qtyInTransit}</td>
      <td className="text-end tabular-nums">{q.qtyDamaged}</td>
      <td className="text-end tabular-nums">{q.qtyShort}</td>
    </>
  );
  const head = (
    <>
      <th className="text-end">Dispatched</th>
      <th className="text-end">Received</th>
      <th className="text-end">In transit</th>
      <th className="text-end">Damaged</th>
      <th className="text-end">Short</th>
    </>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          Position with {abilities.isHeadOffice ? 'branches' : 'Head Office'}
        </h2>
        <ErrorText message={position.error} />
        {position.data ? (
          <PositionCards report={position.data} isHeadOffice={abilities.isHeadOffice} />
        ) : null}
        <p className="text-xs text-muted">
          Figures come from the documents on this computer. A receipt reaches Head Office after the
          branch syncs, so Head Office can show goods as in transit until then.
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="me-auto text-lg font-semibold">Transfer reconciliation</h2>
          <select
            aria-label="Status"
            className={`${inputClass} w-40`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">All</option>
            <option value="dispatched">In transit</option>
            <option value="received">Received</option>
          </select>
          <input
            aria-label="From date"
            type="date"
            className={`${inputClass} w-40`}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            aria-label="To date"
            type="date"
            className={`${inputClass} w-40`}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <ErrorText message={rec.error} />
        {rec.data ? (
          <>
            <p className="text-sm">
              {rec.data.totals.unbalanced === 0 ? (
                <Badge tone="success">Every transfer balances</Badge>
              ) : (
                <Badge tone="danger">{rec.data.totals.unbalanced} transfers do not balance</Badge>
              )}{' '}
              <span className="text-muted">
                dispatched {rec.data.totals.qtyDispatched} · received {rec.data.totals.qtyReceived}{' '}
                · in transit {rec.data.totals.qtyInTransit} · damaged {rec.data.totals.qtyDamaged} ·
                short {rec.data.totals.qtyShort}
                {rec.data.totals.cost
                  ? ` · value ${pkr(rec.data.totals.cost.dispatchedMinor)}, loss ${pkr(rec.data.totals.cost.damagedMinor + rec.data.totals.cost.shortMinor)}`
                  : ''}
              </span>
            </p>
            {rec.data.truncated ? (
              <p className="text-xs text-warning">
                Only the newest 2000 transfers are shown. Narrow the dates.
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-[10px] border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2">Transfer</th>
                    <th>Branch</th>
                    <th>Status</th>
                    {head}
                    <th className="text-end">Value</th>
                    <th className="px-3 text-end">Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.data.transfers.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs">{t.docNo}</td>
                      <td>{t.branchName}</td>
                      <td>
                        <Badge tone={t.status === 'received' ? 'success' : 'warning'}>
                          {t.status}
                        </Badge>
                      </td>
                      {cell(t)}
                      <td className="text-end tabular-nums">{money(t.cost?.dispatchedMinor)}</td>
                      <td className="px-3 text-end tabular-nums">
                        {t.cost ? pkr(t.cost.damagedMinor + t.cost.shortMinor) : '–'}
                      </td>
                    </tr>
                  ))}
                  {rec.data.transfers.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-muted">
                        No dispatched transfers in this range.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <h3 className="pt-2 font-semibold">By item</h3>
            <div className="overflow-x-auto rounded-[10px] border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    {head}
                    <th className="text-end">Value</th>
                    <th className="px-3 text-end">Loss</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.data.items.map((i) => (
                    <tr key={i.itemId} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{i.name}</td>
                      {cell(i)}
                      <td className="text-end tabular-nums">{money(i.cost?.dispatchedMinor)}</td>
                      <td className="px-3 text-end tabular-nums">
                        {i.cost ? pkr(i.cost.damagedMinor + i.cost.shortMinor) : '–'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </section>

      {abilities.viewStock ? <LedgerBox /> : null}
    </div>
  );
}
