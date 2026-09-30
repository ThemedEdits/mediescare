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
import { today } from '@/lib/format';
import { ItemPicker } from './item-picker';
import { QtyInput } from './qty-input';
import {
  qty,
  REQ_TONE,
  type ItemRef,
  type RequisitionDetail,
  type RequisitionRow,
  statusLabel,
  type TransferAbilities,
} from './types';

interface Props {
  abilities: TransferAbilities;
  version: number;
  onChanged: (message?: string) => void;
}

/** Requisitions: a branch asks Head Office for stock; Head Office approves (and may lower quantities). */
export function RequisitionsTab({ abilities, version, onChanged }: Props) {
  const t = useT();
  const [status, setStatus] = useState('');
  const { data, error } = useAsync(
    () =>
      api<{ rows: RequisitionRow[] }>(
        `/api/requisitions?pageSize=100${status ? `&status=${status}` : ''}`,
      ),
    [version, status],
  );
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const canAsk = abilities.createRequisition && !abilities.isHeadOffice;

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
          <option value="submitted">{t('transfers.filter.waiting')}</option>
          <option value="approved">{t('transfers.filter.approved')}</option>
          <option value="fulfilled">{t('transfers.filter.shipped')}</option>
          <option value="cancelled">{t('transfers.filter.cancelled')}</option>
        </select>
        <span className="flex-1" />
        {canAsk ? (
          <Button onClick={() => setCreating(true)}>{t('transfers.requisitions.new')}</Button>
        ) : null}
      </div>
      <ErrorText message={error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">{t('transfers.requisition')}</th>
              <th>{t('common.date')}</th>
              <th>{t('common.from')}</th>
              <th>{t('common.to')}</th>
              <th className="text-end">{t('transfers.requisitions.items')}</th>
              <th>{t('transfers.requisitions.neededBy')}</th>
              <th className="px-3">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-border hover:bg-primary-50"
                onClick={() => setOpenId(r.id)}
              >
                <td className="px-3 py-2 font-mono text-xs" dir="ltr">
                  {r.docNo}
                </td>
                <td dir="ltr">{r.createdAt.slice(0, 10)}</td>
                <td>{r.fromBranchName}</td>
                <td>{r.toBranchName}</td>
                <td className="text-end tabular-nums">{r.lineCount}</td>
                <td dir="ltr">{r.neededBy ?? '–'}</td>
                <td className="px-3">
                  <Badge tone={REQ_TONE[r.status]}>{statusLabel(t, 'reqBadge', r.status)}</Badge>
                </td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  {t('transfers.requisitions.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {creating ? (
        <RequisitionForm
          onClose={() => setCreating(false)}
          onSaved={(docNo) => {
            setCreating(false);
            onChanged(t('transfers.requisitions.sentToast', { docNo }));
          }}
        />
      ) : null}
      {openId ? (
        <RequisitionModal
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

interface FormLine {
  item: ItemRef;
  qtyBase: number;
}

function RequisitionForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (docNo: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [lines, setLines] = useState<FormLine[]>([]);
  const [neededBy, setNeededBy] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = lines.length > 0 && lines.every((l) => l.qtyBase > 0);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ docNo: string }>('/api/requisitions', {
        body: {
          neededBy: neededBy || null,
          note: note || undefined,
          lines: lines.map((l) => ({ itemId: l.item.id, qtyBase: l.qtyBase })),
        },
      });
      onSaved(r.docNo);
    } catch (e) {
      setError(errorText(e, 'transfers.requisitions.sendFailed'));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('transfers.requisitions.new')} onClose={onClose} wide>
      <div className="space-y-3">
        <ItemPicker
          onError={setError}
          onPick={(item) =>
            setLines((prev) =>
              prev.some((l) => l.item.id === item.id) ? prev : [...prev, { item, qtyBase: 0 }],
            )
          }
        />
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">{t('common.item')}</th>
                <th>{t('common.quantity')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.item.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{l.item.name}</td>
                  <td>
                    <QtyInput
                      label={t('transfers.requisitions.quantityOf', { name: l.item.name })}
                      units={l.item.units}
                      valueBase={l.qtyBase}
                      onChange={(b) =>
                        setLines((prev) => prev.map((x, j) => (j === i ? { ...x, qtyBase: b } : x)))
                      }
                    />
                  </td>
                  <td className="px-3 text-end">
                    <button
                      type="button"
                      className="text-sm text-danger"
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                    >
                      {t('common.remove')}
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted">
                    {t('transfers.requisitions.searchToAdd')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            {t('transfers.requisitions.neededBy')}
            <input
              type="date"
              min={today()}
              className={inputClass}
              value={neededBy}
              onChange={(e) => setNeededBy(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            {t('transfers.note')}
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy ? t('transfers.requisitions.sending') : t('transfers.requisitions.send')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function RequisitionModal({
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
  const t = useT();
  const errorText = useErrorText();
  const { data, error: loadError } = useAsync(() =>
    api<{ requisition: RequisitionDetail }>(`/api/requisitions/${id}`),
  );
  const req = data?.requisition;
  const [granted, setGranted] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canApprove = abilities.approveRequisition && req?.incoming && req.status === 'submitted';
  const canCancel =
    req?.status === 'submitted' && (abilities.createRequisition || abilities.approveRequisition);

  const canWriteNote =
    abilities.createTransfer && req?.incoming && req.status === 'approved' && !req.transferId;

  /** Picks the approved quantities first-expiry-first from Head Office stock. The batches can be reviewed on the draft. */
  async function writeNote() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ docNo: string }>('/api/transfers', { body: { requisitionId: id } });
      onChanged(t('transfers.requisitions.noteWrittenToast', { docNo: r.docNo }));
    } catch (e) {
      setError(errorText(e, 'transfers.requisitions.noteFailed'));
      setBusy(false);
    }
  }

  async function run(path: string, body: unknown, message: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/requisitions/${id}/${path}`, { body });
      onChanged(message);
    } catch (e) {
      setError(errorText(e, 'common.couldNotSave'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        req
          ? t('transfers.requisitions.modalTitle', { docNo: req.docNo })
          : t('transfers.requisition')
      }
      onClose={onClose}
      wide
    >
      <ErrorText message={loadError} />
      {req ? (
        <div className="space-y-3">
          <p className="text-sm">
            {t('transfers.requisitions.asks', { from: req.fromBranchName, to: req.toBranchName })} ·{' '}
            <Badge tone={REQ_TONE[req.status]}>{statusLabel(t, 'reqStatus', req.status)}</Badge>
            {req.neededBy
              ? ` · ${t('transfers.requisitions.neededByDate', { date: req.neededBy })}`
              : ''}
          </p>
          {req.note ? <p className="text-sm text-muted">{req.note}</p> : null}
          {req.cancelReason ? (
            <p className="text-sm text-danger">
              {t('transfers.requisitions.cancelledReason', { reason: req.cancelReason })}
            </p>
          ) : null}
          <div className="overflow-x-auto rounded-[10px] border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2">{t('common.item')}</th>
                  <th>{t('transfers.requisitions.asked')}</th>
                  <th>{t('transfers.requisitions.approved')}</th>
                </tr>
              </thead>
              <tbody>
                {req.lines.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{l.item.name}</td>
                    <td>{qty(l.qtyRequestedBase, l.item.units)}</td>
                    <td>
                      {canApprove ? (
                        <QtyInput
                          label={t('transfers.requisitions.approvedQuantityOf', {
                            name: l.item.name,
                          })}
                          units={l.item.units}
                          valueBase={granted[l.id] ?? l.qtyRequestedBase}
                          onChange={(b) => setGranted((g) => ({ ...g, [l.id]: b }))}
                        />
                      ) : l.qtyApprovedBase === null ? (
                        '–'
                      ) : (
                        qty(l.qtyApprovedBase, l.item.units)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canApprove ? (
            <p className="text-xs text-muted">{t('transfers.requisitions.approveHint')}</p>
          ) : null}
          {cancelling ? (
            <div className="space-y-2">
              <input
                aria-label={t('transfers.requisitions.cancelReasonAria')}
                className={inputClass}
                placeholder={t('common.reason')}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() =>
                  void run(
                    'cancel',
                    { reason },
                    t('transfers.requisitions.cancelledToast', { docNo: req.docNo }),
                  )
                }
              >
                {t('transfers.requisitions.confirmCancel')}
              </Button>
            </div>
          ) : null}
          <ErrorText message={error} />
          <div className="flex justify-end gap-2">
            {canCancel && !cancelling ? (
              <Button variant="outline" onClick={() => setCancelling(true)}>
                {t('transfers.requisitions.cancel')}
              </Button>
            ) : null}
            {canApprove ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(
                    'approve',
                    {
                      lines: Object.entries(granted).map(([lineId, qtyApprovedBase]) => ({
                        lineId,
                        qtyApprovedBase,
                      })),
                    },
                    t('transfers.requisitions.approvedToast', { docNo: req.docNo }),
                  )
                }
              >
                {busy ? t('common.saving') : t('transfers.requisitions.approve')}
              </Button>
            ) : null}
            {canWriteNote ? (
              <Button disabled={busy} onClick={() => void writeNote()}>
                {busy ? t('transfers.requisitions.writing') : t('transfers.requisitions.writeNote')}
              </Button>
            ) : null}
            <Button variant="outline" onClick={onClose}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
