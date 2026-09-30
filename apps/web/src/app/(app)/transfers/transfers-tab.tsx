'use client';

import { useState } from 'react';
import { api, Badge, Button, ErrorText, inputClass, Modal, useAsync } from '@/components/ui';
import { pkr, rate } from '@/lib/format';
import { ReceiveDialog } from './receive-dialog';
import { TransferForm } from './transfer-form';
import {
  qty,
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
  return (
    <div className="overflow-x-auto rounded-[10px] border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
          <tr>
            <th className="px-3 py-2">Transfer</th>
            <th>Date</th>
            <th>From</th>
            <th>To</th>
            <th className="text-end">Lines</th>
            <th className="text-end">Sent</th>
            <th className="text-end">Damaged</th>
            <th className="text-end">Short</th>
            <th className="text-end">Value at cost</th>
            <th className="px-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows?.map((r) => (
            <tr
              key={r.id}
              className="cursor-pointer border-t border-border hover:bg-primary-50"
              onClick={() => onOpen(r.id)}
            >
              <td className="px-3 py-2 font-mono text-xs">{r.docNo}</td>
              <td>{(r.dispatchedAt ?? r.createdAt).slice(0, 10)}</td>
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
                <Badge tone={TRF_TONE[r.status]}>{r.status}</Badge>
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
          aria-label="Filter by status"
          className={`${inputClass} w-44`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {abilities.isHeadOffice ? <option value="draft">Draft</option> : null}
          <option value="dispatched">In transit</option>
          <option value="received">Received</option>
          {abilities.isHeadOffice ? <option value="cancelled">Cancelled</option> : null}
        </select>
        <span className="flex-1" />
        {abilities.isHeadOffice && abilities.createTransfer ? (
          <Button onClick={() => setCreating(true)}>New transfer note</Button>
        ) : null}
      </div>
      <ErrorText message={error} />
      <TransferTable rows={data?.rows} onOpen={setOpenId} empty="No transfers." />
      {creating ? (
        <TransferForm
          onClose={() => setCreating(false)}
          onSaved={(docNo) => {
            setCreating(false);
            onChanged(`Transfer note ${docNo} saved as a draft. Open it to dispatch`);
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
  const { data, error } = useAsync(
    () => api<{ rows: TransferRow[] }>('/api/transfers?status=dispatched&pageSize=100'),
    [version],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        {abilities.isHeadOffice
          ? 'Dispatched from Head Office and not yet received by the branch. These goods are in nobody’s stock.'
          : 'Dispatched to this branch. Open a transfer and count it to add the goods to your stock.'}
      </p>
      <ErrorText message={error} />
      <TransferTable rows={data?.rows} onOpen={setOpenId} empty="Nothing in transit." />
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
      setError(e instanceof Error ? e.message : 'Could not save');
      setBusy(false);
    }
  }

  if (t && receiving)
    return (
      <ReceiveDialog transfer={t} onClose={() => setReceiving(false)} onReceived={onChanged} />
    );

  return (
    <Modal title={t ? `Transfer ${t.docNo}` : 'Transfer'} onClose={onClose} wide>
      <ErrorText message={loadError} />
      {t ? (
        <div className="space-y-3">
          <div id="doc-print" className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold">Transfer note</p>
                <p className="font-mono text-sm">{t.docNo}</p>
              </div>
              <Badge tone={TRF_TONE[t.status]}>{t.status}</Badge>
            </div>
            <div className="grid gap-1 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted">From: </span>
                <strong>{t.fromBranchName}</strong>
              </p>
              <p>
                <span className="text-muted">To: </span>
                <strong>{t.toBranchName}</strong>
              </p>
              <p>
                <span className="text-muted">Dispatched: </span>
                {t.dispatchedAt ? t.dispatchedAt.slice(0, 16).replace('T', ' ') : 'not yet'}
              </p>
              <p>
                <span className="text-muted">Received: </span>
                {t.receivedAt ? t.receivedAt.slice(0, 16).replace('T', ' ') : 'not yet'}
              </p>
              {t.requisitionDocNo ? (
                <p>
                  <span className="text-muted">Requisition: </span>
                  {t.requisitionDocNo}
                </p>
              ) : null}
              {t.note ? (
                <p>
                  <span className="text-muted">Note: </span>
                  {t.note}
                </p>
              ) : null}
              {t.receiveNote ? (
                <p>
                  <span className="text-muted">Receiving note: </span>
                  {t.receiveNote}
                </p>
              ) : null}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
                <tr>
                  <th className="px-2 py-2">#</th>
                  <th>Item</th>
                  <th>Batch</th>
                  <th>Expiry</th>
                  <th className="text-end">Sent</th>
                  {t.status === 'received' ? (
                    <>
                      <th className="text-end">Received</th>
                      <th className="text-end">Damaged</th>
                      <th className="text-end">Short</th>
                    </>
                  ) : null}
                  <th className="text-end">Cost / unit</th>
                  <th className="px-2 text-end">Value</th>
                </tr>
              </thead>
              <tbody>
                {t.lines.map((l) => (
                  <tr key={l.id} className="border-t border-border">
                    <td className="px-2 py-1.5">{l.lineNo}</td>
                    <td className="font-medium">{l.item.name}</td>
                    <td className="font-mono text-xs">{l.batchNo}</td>
                    <td>{l.expiryDate}</td>
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
                      Total at cost
                    </td>
                    <td className="px-2 text-end tabular-nums">{pkr(t.cost.dispatchedMinor)}</td>
                  </tr>
                  {t.status === 'received' ? (
                    <tr className="text-sm text-muted">
                      <td colSpan={9} className="px-2 py-1 text-end">
                        Received {pkr(t.cost.receivedMinor)} · damaged {pkr(t.cost.damagedMinor)} ·
                        short {pkr(t.cost.shortMinor)}
                      </td>
                      <td />
                    </tr>
                  ) : null}
                </tfoot>
              ) : null}
            </table>
            <div className="grid grid-cols-2 gap-8 pt-8 text-sm text-muted">
              <p className="border-t border-slate-400 pt-1">Dispatched by</p>
              <p className="border-t border-slate-400 pt-1">Received by</p>
            </div>
          </div>
          {t.cancelReason ? (
            <p className="text-sm text-danger">Cancelled: {t.cancelReason}</p>
          ) : null}
          {cancelling ? (
            <div className="space-y-2">
              <input
                aria-label="Reason for cancelling"
                className={inputClass}
                placeholder="Reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <Button
                variant="danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() => void post('cancel', { reason }, `Transfer ${t.docNo} cancelled`)}
              >
                Confirm cancel
              </Button>
            </div>
          ) : null}
          <ErrorText message={error} />
          <div className="flex flex-wrap justify-end gap-2">
            {isSender && t.status === 'draft' && abilities.cancelTransfer && !cancelling ? (
              <Button variant="outline" onClick={() => setCancelling(true)}>
                Cancel note
              </Button>
            ) : null}
            {isSender && t.status === 'draft' && abilities.dispatch ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void post(
                    'dispatch',
                    {},
                    `Transfer ${t.docNo} dispatched. The goods are in transit`,
                  )
                }
              >
                {busy ? 'Dispatching…' : 'Dispatch'}
              </Button>
            ) : null}
            {!isSender && t.status === 'dispatched' && abilities.receive ? (
              <Button onClick={() => setReceiving(true)}>Receive</Button>
            ) : null}
            {abilities.print && t.status !== 'cancelled' ? (
              <Button variant="outline" onClick={() => window.print()}>
                Print A4
              </Button>
            ) : null}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
