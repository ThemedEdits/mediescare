'use client';

import { useState } from 'react';
import {
  api,
  Badge,
  Button,
  ErrorText,
  inputClass,
  Modal,
  useAsync,
  useErrorText,
} from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr, rate } from '@/lib/format';
import { ReceiveDialog } from './receive-dialog';
import { TransferForm } from './transfer-form';
import {
  qty,
  statusLabel,
  TRF_TONE,
  type TransferAbilities,
  type TransferDetail,
  type TransferRow,
} from './types';

interface Props {
  abilities: TransferAbilities;
  version: number;
  onChanged: (message?: string) => void;
}

function TransferTable({
  rows,
  onOpen,
  empty,
}: {
  rows: TransferRow[] | undefined;
  onOpen: (id: string) => void;
  empty: string;
}) {
  const t = useT();
  return (
    <div className="overflow-x-auto rounded-[10px] border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
          <tr>
            <th className="px-3 py-2">{t('transfers.list.transfer')}</th>
            <th>{t('common.date')}</th>
            <th>{t('common.from')}</th>
            <th>{t('common.to')}</th>
            <th className="text-end">{t('transfers.list.lines')}</th>
            <th className="text-end">{t('transfers.sent')}</th>
            <th className="text-end">{t('transfers.damaged')}</th>
            <th className="text-end">{t('transfers.short')}</th>
            <th className="text-end">{t('transfers.list.valueAtCost')}</th>
            <th className="px-3">{t('common.status')}</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-t border-border hover:bg-primary-50"
              onClick={() => onOpen(r.id)}
            >
              <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                {r.docNo}
              </td>
              <td dir="ltr">{(r.dispatchedAt ?? r.createdAt).slice(0, 10)}</td>
              <td>{r.fromBranchName}</td>
              <td>{r.toBranchName}</td>
              <td className="text-end tabular-nums">{r.lineCount}</td>
              <td className="text-end tabular-nums">{r.qtyDispatched}</td>
              <td className="text-end tabular-nums">
                {r.status === 'received' ? r.qtyDamaged : '–'}
              </td>
              <td className="text-end tabular-nums">
                {r.status === 'received' ? r.qtyShort : '–'}
              </td>
              <td className="text-end tabular-nums">
                {r.cost ? pkr(r.cost.dispatchedMinor) : '–'}
              </td>
              <td className="px-3">
                <Badge tone={TRF_TONE[r.status]}>{statusLabel(t, 'trfStatus', r.status)}</Badge>
              </td>
            </tr>
          ))}
          {rows && rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-3 py-10 text-center text-muted">
                {empty}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** All transfer notes of this branch. Head Office writes notes here. */
export function TransfersTab({ abilities, version, onChanged }: Props) {
  const t = useT();
  const [status, setStatus] = useState('');
  const { data, error } = useAsync(
    () =>
      api<{ rows: TransferRow[] }>(
        `/api/transfers?pageSize=100${status ? `&status=${status}` : ''}`,
      ),
    [version, status],
  );
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('transfers.filter.aria')}
          className={`${inputClass} w-44`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('transfers.filter.allStatuses')}</option>
          {abilities.isHeadOffice ? (
            <option value="draft">{t('transfers.filter.draft')}</option>
          ) : null}
          <option value="dispatched">{t('transfers.filter.inTransit')}</option>
          <option value="received">{t('transfers.filter.received')}</option>
          {abilities.isHeadOffice ? (
            <option value="cancelled">{t('transfers.filter.cancelled')}</option>
          ) : null}
        </select>
        <span className="flex-1" />
        {abilities.isHeadOffice && abilities.createTransfer ? (
          <Button onClick={() => setCreating(true)}>{t('transfers.list.new')}</Button>
        ) : null}
      </div>
      <ErrorText message={error} />
      <TransferTable rows={data?.rows} onOpen={setOpenId} empty={t('transfers.list.empty')} />
      {creating ? (
        <TransferForm
          onClose={() => setCreating(false)}
          onSaved={(docNo) => {
            setCreating(false);
            onChanged(t('transfers.list.savedToast', { docNo }));
          }}
        />
      ) : null}
      {openId ? (
        <TransferModal
          id={openId}
          abilities={abilities}
          onClose={() => setOpenId(null)}
          onChanged={(m) => {
            setOpenId(null);
            onChanged(m);
          }}
        />
      ) : null}
    </div>
  );
}

/** Goods that left Head Office and have not been counted yet. The branch receives them here. */
export function InTransitTab({ abilities, version, onChanged }: Props) {
  const t = useT();
  const { data, error } = useAsync(
    () => api<{ rows: TransferRow[] }>('/api/transfers?status=dispatched&pageSize=100'),
    [version],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {abilities.isHeadOffice
          ? t('transfers.list.transitHeadOffice')
          : t('transfers.list.transitBranch')}
      </p>
      <ErrorText message={error} />
      <TransferTable
        rows={data?.rows}
        onOpen={setOpenId}
        empty={t('transfers.list.nothingInTransit')}
      />
      {openId ? (
        <TransferModal
          id={openId}
          abilities={abilities}
          onClose={() => setOpenId(null)}
          onChanged={(m) => {
            setOpenId(null);
            onChanged(m);
          }}
        />
      ) : null}
    </div>
  );
}

function TransferModal({
  id,
  abilities,
  onClose,
  onChanged,
}: {
  id: string;
  abilities: TransferAbilities;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const tr = useT();
  const errorText = useErrorText();
  const { data, error: loadError } = useAsync(() =>
    api<{ transfer: TransferDetail }>(`/api/transfers/${id}`),
  );
  const t = data?.transfer;
  const [receiving, setReceiving] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isSender = t?.direction === 'outgoing';

  async function post(path: string, body: unknown, message: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/transfers/${id}/${path}`, { method: 'POST', body: body ?? {} });
      onChanged(message);
    } catch (e) {
      setError(errorText(e, 'common.couldNotSave'));
      setBusy(false);
    }
  }

  if (t && receiving)
    return (
      <ReceiveDialog transfer={t} onClose={() => setReceiving(false)} onReceived={onChanged} />
    );

  return (
    <Modal
      title={t ? tr('transfers.list.transferTitle', { docNo: t.docNo }) : tr('transfers.transfer')}
      onClose={onClose}
      wide
    >
      <ErrorText message={loadError} />
      {t ? (
        <div className="space-y-3">
          <div id="doc-print" className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold">{tr('transfers.detail.noteTitle')}</p>
                <p className="font-mono text-sm" dir="ltr">
                  {t.docNo}
                </p>
              </div>
              <Badge tone={TRF_TONE[t.status]}>{statusLabel(tr, 'trfStatus', t.status)}</Badge>
            </div>
            <div className="grid gap-1 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted">{tr('common.from')}: </span>
                <strong>{t.fromBranchName}</strong>
              </p>
              <p>
                <span className="text-muted">{tr('common.to')}: </span>
                <strong>{t.toBranchName}</strong>
              </p>
              <p>
                <span className="text-muted">{tr('transfers.dispatched')}: </span>
                {t.dispatchedAt ? (
                  <bdi>{t.dispatchedAt.slice(0, 16).replace('T', ' ')}</bdi>
                ) : (
                  tr('transfers.detail.notYet')
                )}
              </p>
              <p>
                <span className="text-muted">{tr('transfers.received')}: </span>
                {t.receivedAt ? (
                  <bdi>{t.receivedAt.slice(0, 16).replace('T', ' ')}</bdi>
                ) : (
                  tr('transfers.detail.notYet')
                )}
              </p>
              {t.requisitionDocNo ? (
                <p>
                  <span className="text-muted">{tr('transfers.requisition')}: </span>
                  <bdi>{t.requisitionDocNo}</bdi>
                </p>
              ) : null}
              {t.note ? (
                <p>
                  <span className="text-muted">{tr('transfers.note')}: </span>
                  {t.note}
                </p>
              ) : null}
              {t.receiveNote ? (
                <p>
                  <span className="text-muted">{tr('transfers.detail.receivingNote')}: </span>
                  {t.receiveNote}
                </p>
              ) : null}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th>{tr('common.item')}</th>
                  <th>{tr('transfers.batch')}</th>
                  <th>{tr('transfers.expiry')}</th>
                  <th className="text-end">{tr('transfers.sent')}</th>
                  {t.status === 'received' ? (
                    <>
                      <th className="text-end">{tr('transfers.received')}</th>
                      <th className="text-end">{tr('transfers.damaged')}</th>
                      <th className="text-end">{tr('transfers.short')}</th>
                    </>
                  ) : null}
                  <th className="text-end">{tr('transfers.detail.costPerUnit')}</th>
                  <th className="px-2 text-end">{tr('transfers.value')}</th>
                </tr>
              </thead>
              <tbody>
                {t.lines.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-2 py-1.5">{l.lineNo}</td>
                    <td className="font-medium">{l.item.name}</td>
                    <td className="font-mono text-xs" dir="ltr">
                      {l.batchNo}
                    </td>
                    <td dir="ltr">{l.expiryDate}</td>
                    <td className="text-end tabular-nums">{qty(l.qtyDispatched, l.item.units)}</td>
                    {t.status === 'received' ? (
                      <>
                        <td className="text-end tabular-nums">{l.qtyReceived}</td>
                        <td className="text-end tabular-nums">{l.qtyDamaged}</td>
                        <td className="text-end tabular-nums">{l.qtyShort}</td>
                      </>
                    ) : null}
                    <td className="text-end tabular-nums">
                      {l.costUnitMicro === undefined ? '–' : rate(l.costUnitMicro)}
                    </td>
                    <td className="px-2 text-end tabular-nums">
                      {l.cost ? pkr(l.cost.dispatchedMinor) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
              {t.cost ? (
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td colSpan={t.status === 'received' ? 9 : 6} className="px-2 py-2 text-end">
                      {tr('transfers.detail.totalAtCost')}
                    </td>
                    <td className="px-2 text-end tabular-nums">{pkr(t.cost.dispatchedMinor)}</td>
                  </tr>
                  {t.status === 'received' ? (
                    <tr className="text-sm text-muted">
                      <td colSpan={9} className="px-2 py-1 text-end">
                        {tr('transfers.detail.receivedSummary', {
                          received: pkr(t.cost.receivedMinor),
                          damaged: pkr(t.cost.damagedMinor),
                          short: pkr(t.cost.shortMinor),
                        })}
                      </td>
                      <td />
                    </tr>
                  ) : null}
                </tfoot>
              ) : null}
            </table>
            <div className="grid grid-cols-2 gap-8 pt-8 text-sm text-muted">
              <p className="border-t border-slate-400 pt-1">
                {tr('transfers.detail.dispatchedBy')}
              </p>
              <p className="border-t border-slate-400 pt-1">{tr('transfers.detail.receivedBy')}</p>
            </div>
          </div>
          {t.cancelReason ? (
            <p className="text-sm text-danger">
              {tr('transfers.requisitions.cancelledReason', { reason: t.cancelReason })}
            </p>
          ) : null}
          {cancelling ? (
            <div className="space-y-2">
              <input
                aria-label={tr('transfers.requisitions.cancelReasonAria')}
                className={inputClass}
                placeholder={tr('common.reason')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  void post(
                    'cancel',
                    { reason },
                    tr('transfers.detail.cancelledToast', { docNo: t.docNo }),
                  )
                }
              >
                {tr('transfers.requisitions.confirmCancel')}
              </Button>
            </div>
          ) : null}
          <ErrorText message={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {isSender && t.status === 'draft' && abilities.cancelTransfer && !cancelling ? (
              <Button variant="outline" onClick={() => setCancelling(true)}>
                {tr('transfers.detail.cancelNote')}
              </Button>
            ) : null}
            {isSender && t.status === 'draft' && abilities.dispatch ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void post(
                    'dispatch',
                    {},
                    tr('transfers.detail.dispatchedToast', { docNo: t.docNo }),
                  )
                }
              >
                {busy ? tr('transfers.detail.dispatching') : tr('transfers.detail.dispatch')}
              </Button>
            ) : null}
            {!isSender && t.status === 'dispatched' && abilities.receive ? (
              <Button onClick={() => setReceiving(true)}>{tr('transfers.detail.receive')}</Button>
            ) : null}
            {abilities.print && t.status !== 'cancelled' ? (
              <Button variant="outline" onClick={() => window.print()}>
                {tr('transfers.detail.printA4')}
              </Button>
            ) : null}
            <Button variant="outline" onClick={onClose}>
              {tr('common.close')}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
