'use client';

import { useState } from 'react';
import { api, Button, ErrorText, inputClass, Modal, useAsync, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { ItemPicker } from './item-picker';
import { QtyInput } from './qty-input';
import { qty, type ItemRef, type RequisitionDetail, type RequisitionRow } from './types';

interface BatchChoice {
  batchId: string;
  batchNo: string;
  expiryDate: string;
  availableBase: number;
  eligible: boolean;
  reason: 'expired' | 'blocked' | 'empty' | null;
}
interface Suggestion {
  picks: { batchId: string; qtyBase: number }[];
  shortfallBase: number;
}
interface FormLine {
  key: string;
  item: ItemRef;
  batches: BatchChoice[];
  batchId: string;
  qtyBase: number;
}

const key = () => Math.random().toString(36).slice(2, 9);

async function batchesOf(itemId: string): Promise<BatchChoice[]> {
  return (await api<{ batches: BatchChoice[] }>(`/api/transfers/batches?itemId=${itemId}`)).batches;
}

/**
 * Transfer note at Head Office. Either from an approved requisition (the approved quantities are
 * picked first-expiry-first and can be changed batch by batch) or directly to a branch. Expired and
 * blocked batches are listed but cannot be chosen.
 */
export function TransferForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (docNo: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const requisitions = useAsync(() =>
    api<{ rows: RequisitionRow[] }>('/api/requisitions?status=approved&pageSize=100'),
  );
  const branches = useAsync(() =>
    api<{ branches: { id: string; name: string; code: string }[] }>('/api/transfers/branches'),
  );
  const [requisitionId, setRequisitionId] = useState('');
  const [toBranchId, setToBranchId] = useState('');
  const [lines, setLines] = useState<FormLine[]>([]);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [short, setShort] = useState<string[]>([]);
  const ready =
    lines.length > 0 &&
    lines.every((l) => l.batchId && l.qtyBase > 0) &&
    (requisitionId !== '' || toBranchId !== '');

  async function chooseRequisition(id: string) {
    setRequisitionId(id);
    setLines([]);
    setShort([]);
    setError(null);
    if (!id) return;
    try {
      const req = (await api<{ requisition: RequisitionDetail }>(`/api/requisitions/${id}`))
        .requisition;
      const next: FormLine[] = [];
      const notes: string[] = [];
      for (const l of req.lines) {
        const want = l.qtyApprovedBase ?? l.qtyRequestedBase;
        if (want <= 0) continue;
        const [batches, sug] = await Promise.all([
          batchesOf(l.item.id),
          api<Suggestion>(`/api/transfers/suggest?itemId=${l.item.id}&qtyBase=${want}`),
        ]);
        for (const p of sug.picks)
          next.push({ key: key(), item: l.item, batches, batchId: p.batchId, qtyBase: p.qtyBase });
        if (sug.shortfallBase > 0)
          notes.push(
            t('transfers.form.notInStock', {
              item: l.item.name,
              qty: qty(sug.shortfallBase, l.item.units),
            }),
          );
      }
      setLines(next);
      setShort(notes);
    } catch (e) {
      setError(errorText(e, 'transfers.form.loadRequisitionFailed'));
    }
  }

  async function addItem(item: ItemRef) {
    try {
      const batches = await batchesOf(item.id);
      const first = batches.find((b) => b.eligible);
      setLines((prev) => [
        ...prev,
        { key: key(), item, batches, batchId: first?.batchId ?? '', qtyBase: 0 },
      ]);
    } catch (e) {
      setError(errorText(e, 'transfers.form.loadBatchesFailed'));
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ docNo: string }>('/api/transfers', {
        body: {
          requisitionId: requisitionId || null,
          toBranchId: requisitionId ? null : toBranchId,
          note: note || undefined,
          lines: lines.map((l) => ({ itemId: l.item.id, batchId: l.batchId, qtyBase: l.qtyBase })),
        },
      });
      onSaved(r.docNo);
    } catch (e) {
      setError(errorText(e, 'transfers.form.saveFailed'));
      setBusy(false);
    }
  }

  const update = (i: number, patch: Partial<FormLine>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Modal title={t('transfers.form.title')} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            {t('transfers.form.fromRequisition')}
            <select
              aria-label={t('transfers.requisition')}
              className={inputClass}
              value={requisitionId}
              onChange={(e) => void chooseRequisition(e.target.value)}
            >
              <option value="">{t('transfers.form.directTransfer')}</option>
              {requisitions.data?.rows
                .filter((r) => r.incoming && !r.transferId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.docNo} · {r.fromBranchName}
                  </option>
                ))}
            </select>
          </label>
          {!requisitionId ? (
            <label className="block text-sm">
              {t('transfers.form.sendTo')}
              <select
                aria-label={t('transfers.form.receivingBranchAria')}
                className={inputClass}
                value={toBranchId}
                onChange={(e) => setToBranchId(e.target.value)}
              >
                <option value="">{t('transfers.form.chooseBranch')}</option>
                {branches.data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} · {b.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {!requisitionId ? <ItemPicker onError={setError} onPick={(i) => void addItem(i)} /> : null}
        {short.length > 0 ? (
          <p role="status" className="rounded-[6px] bg-[#FEF3C7] px-3 py-2 text-sm text-warning">
            {t('transfers.form.notFullyCovered', { list: short.join('; ') })}
          </p>
        ) : null}
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">{t('common.item')}</th>
                <th>{t('transfers.form.batchHeader')}</th>
                <th>{t('common.quantity')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium">{l.item.name}</td>
                  <td>
                    <select
                      aria-label={t('transfers.form.batchOfAria', { name: l.item.name })}
                      className={`${inputClass} w-72`}
                      value={l.batchId}
                      onChange={(e) => update(i, { batchId: e.target.value })}
                    >
                      <option value="">{t('transfers.form.chooseBatch')}</option>
                      {l.batches.map((b) => (
                        <option key={b.batchId} value={b.batchId} disabled={!b.eligible}>
                          {t('transfers.form.batchOption', {
                            batchNo: b.batchNo,
                            expiry: b.expiryDate,
                            qty: qty(b.availableBase, l.item.units),
                          })}
                          {b.reason ? ` (${t(`transfers.form.reason.${b.reason}`)})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <QtyInput
                      label={t('transfers.requisitions.quantityOf', { name: l.item.name })}
                      units={l.item.units}
                      valueBase={l.qtyBase}
                      onChange={(b) => update(i, { qtyBase: b })}
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
                  <td colSpan={4} className="px-3 py-6 text-center text-muted">
                    {requisitionId
                      ? t('transfers.form.loadingApproved')
                      : t('transfers.requisitions.searchToAdd')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <label className="block text-sm">
          {t('transfers.note')}
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="text-xs text-muted">{t('transfers.form.costHint')}</p>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy ? t('common.saving') : t('transfers.form.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
