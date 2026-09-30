'use client';

import { useState, type ReactNode } from 'react';
import { api, Badge, Button, ErrorText, inputClass, useAsync } from '@/components/ui';
import { pkr } from '@/lib/format';
import { useT } from '@/i18n/client';
import { statusLabel, type TransferAbilities } from './types';

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
  const t = useT();
  const role = isHeadOffice ? 'shipper' : 'receiver';
  const total = report.totals[role];
  const c = total.cost;
  const loss = c ? c.damagedMinor + c.shortMinor : undefined;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card
          title={
            isHeadOffice
              ? t('transfers.rec.dispatchedToBranches')
              : t('transfers.rec.dispatchedToUs')
          }
          value={money(c?.dispatchedMinor)}
          note={t('transfers.rec.transfersCount', { count: total.transfers })}
        />
        <Card title={t('transfers.received')} value={money(c?.receivedMinor)} />
        <Card title={t('transfers.inTransit')} value={money(c?.inTransitMinor)} />
        <Card
          title={t('transfers.rec.lossTitle')}
          value={money(loss)}
          tone={loss ? 'danger' : undefined}
        />
        <Card
          title={t('transfers.difference')}
          value={money(c?.differenceMinor)}
          note={t('transfers.rec.differenceNote')}
          tone={c ? (c.differenceMinor === 0 ? 'success' : 'danger') : undefined}
        />
      </div>
      {!c ? <p className="text-xs text-muted">{t('transfers.rec.costRightNote')}</p> : null}
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">{t('common.branch')}</th>
              <th>
                {isHeadOffice ? t('transfers.rec.weShipToIt') : t('transfers.rec.itShipsToUs')}
              </th>
              <th className="text-end">{t('transfers.rec.transfers')}</th>
              <th className="text-end">{t('transfers.inTransit')}</th>
              <th className="text-end">{t('transfers.dispatched')}</th>
              <th className="text-end">{t('transfers.received')}</th>
              <th className="text-end">{t('transfers.rec.inTransitValue')}</th>
              <th className="text-end">{t('transfers.damaged')}</th>
              <th className="text-end">{t('transfers.short')}</th>
              <th className="px-3 text-end">{t('transfers.difference')}</th>
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
                  <td>
                    {p.role === 'shipper'
                      ? t('transfers.rec.roleSent')
                      : t('transfers.rec.roleReceived')}
                  </td>
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
                  {t('transfers.rec.noTransfersYet')}
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
  const t = useT();
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
        <h2 className="text-lg font-semibold">{t('transfers.rec.ledgerTitle')}</h2>
        <Button variant="outline" onClick={() => setVersion((v) => v + 1)}>
          {t('transfers.rec.checkAgain')}
        </Button>
      </div>
      <ErrorText message={error} />
      {data ? (
        <>
          <p className="text-sm">
            <Badge tone={data.ok ? 'success' : 'danger'}>
              {data.ok
                ? t('transfers.rec.ledgerOk')
                : t('transfers.rec.problems', { count: problems })}
            </Badge>{' '}
            <span className="text-muted">
              {t('transfers.rec.recomputed', {
                batches: data.batchesChecked,
                movements: data.movementsChecked,
              })}
              {data.cost
                ? ` · ${t('transfers.rec.stockValueAtCost', { value: pkr(data.cost.stockValueMinor) })}`
                : ''}
            </span>
          </p>
          <ProblemList
            title={t('transfers.rec.batchesBelowZero')}
            show={data.negativeBatches.length > 0}
          >
            {data.negativeBatches.map((b) => (
              <li key={b.batchId}>
                {t('transfers.rec.negativeBatch', {
                  item: b.itemName,
                  batchNo: b.batchNo,
                  balance: b.balanceBase,
                })}
              </li>
            ))}
          </ProblemList>
          <ProblemList
            title={t('transfers.rec.movementsNoBatch')}
            show={data.orphanMovements.length > 0}
          >
            {data.orphanMovements.map((m) => (
              <li key={m.movementId} className="font-mono text-xs">
                {m.movementId}
              </li>
            ))}
          </ProblemList>
          <ProblemList
            title={t('transfers.rec.movementsMismatch')}
            show={data.mismatchedMovements.length > 0}
          >
            {data.mismatchedMovements.map((m) => (
              <li key={m.movementId} className="font-mono text-xs">
                {m.movementId}
              </li>
            ))}
          </ProblemList>
          <ProblemList
            title={t('transfers.rec.movementsWrongSign')}
            show={data.signErrors.length > 0}
          >
            {data.signErrors.map((m) => (
              <li key={m.movementId}>
                {m.kind} {m.qtyBase} <span className="font-mono text-xs">{m.movementId}</span>
              </li>
            ))}
          </ProblemList>
          {!data.ok ? <p className="text-xs text-muted">{t('transfers.rec.historyNote')}</p> : null}
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
  const tr = useT();
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
      <th className="text-end">{tr('transfers.dispatched')}</th>
      <th className="text-end">{tr('transfers.received')}</th>
      <th className="text-end">{tr('transfers.inTransit')}</th>
      <th className="text-end">{tr('transfers.damaged')}</th>
      <th className="text-end">{tr('transfers.short')}</th>
    </>
  );

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">
          {abilities.isHeadOffice
            ? tr('transfers.rec.positionWithBranches')
            : tr('transfers.rec.positionWithHeadOffice')}
        </h2>
        <ErrorText message={position.error} />
        {position.data ? (
          <PositionCards report={position.data} isHeadOffice={abilities.isHeadOffice} />
        ) : null}
        <p className="text-xs text-muted">{tr('transfers.rec.syncNote')}</p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="me-auto text-lg font-semibold">
            {tr('transfers.rec.reconciliationTitle')}
          </h2>
          <select
            aria-label={tr('common.status')}
            className={`${inputClass} w-40`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{tr('common.all')}</option>
            <option value="dispatched">{tr('transfers.filter.inTransit')}</option>
            <option value="received">{tr('transfers.filter.received')}</option>
          </select>
          <input
            aria-label={tr('transfers.rec.fromDateAria')}
            type="date"
            className={`${inputClass} w-40`}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
          <input
            aria-label={tr('transfers.rec.toDateAria')}
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
                <Badge tone="success">{tr('transfers.rec.allBalance')}</Badge>
              ) : (
                <Badge tone="danger">
                  {tr('transfers.rec.unbalanced', { count: rec.data.totals.unbalanced })}
                </Badge>
              )}{' '}
              <span className="text-muted">
                {tr('transfers.rec.totalsLine', {
                  dispatched: rec.data.totals.qtyDispatched,
                  received: rec.data.totals.qtyReceived,
                  inTransit: rec.data.totals.qtyInTransit,
                  damaged: rec.data.totals.qtyDamaged,
                  short: rec.data.totals.qtyShort,
                })}
                {rec.data.totals.cost
                  ? ` · ${tr('transfers.rec.totalsCost', {
                      value: pkr(rec.data.totals.cost.dispatchedMinor),
                      loss: pkr(
                        rec.data.totals.cost.damagedMinor + rec.data.totals.cost.shortMinor,
                      ),
                    })}`
                  : ''}
              </span>
            </p>
            {rec.data.truncated ? (
              <p className="text-xs text-warning">{tr('transfers.rec.truncated')}</p>
            ) : null}
            <div className="overflow-x-auto rounded-[10px] border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2">{tr('transfers.list.transfer')}</th>
                    <th>{tr('common.branch')}</th>
                    <th>{tr('common.status')}</th>
                    {head}
                    <th className="text-end">{tr('transfers.value')}</th>
                    <th className="px-3 text-end">{tr('transfers.loss')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rec.data.transfers.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                        {t.docNo}
                      </td>
                      <td>{t.branchName}</td>
                      <td>
                        <Badge tone={t.status === 'received' ? 'success' : 'warning'}>
                          {statusLabel(tr, 'trfStatus', t.status)}
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
                        {tr('transfers.rec.noneInRange')}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <h3 className="pt-2 font-semibold">{tr('transfers.rec.byItem')}</h3>
            <div className="overflow-x-auto rounded-[10px] border border-border">
              <table className="w-full text-sm">
                <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
                  <tr>
                    <th className="px-3 py-2">{tr('common.item')}</th>
                    {head}
                    <th className="text-end">{tr('transfers.value')}</th>
                    <th className="px-3 text-end">{tr('transfers.loss')}</th>
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
