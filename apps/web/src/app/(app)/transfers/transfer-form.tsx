'use client';

import { useState } from 'react';
import { api, Button, ErrorText, inputClass, Modal, useAsync } from '@/components/ui';
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
const REASON = { expired: 'expired', blocked: 'blocked', empty: 'empty' } as const;

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
          notes.push(`${l.item.name}: ${qty(sug.shortfallBase, l.item.units)} is not in stock`);
      }
      setLines(next);
      setShort(notes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the requisition');
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
      setError(e instanceof Error ? e.message : 'Could not load the batches');
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
      setError(e instanceof Error ? e.message : 'Could not save the transfer note');
      setBusy(false);
    }
  }

  const update = (i: number, patch: Partial<FormLine>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <Modal title="New transfer note" onClose={onClose} wide>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            From an approved requisition
            <select
              aria-label="Requisition"
              className={inputClass}
              value={requisitionId}
              onChange={(e) => void chooseRequisition(e.target.value)}
            >
              <option value="">None (direct transfer)</option>
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
              Send to
              <select
                aria-label="Receiving branch"
                className={inputClass}
                value={toBranchId}
                onChange={(e) => setToBranchId(e.target.value)}
              >
                <option value="">Choose a branch…</option>
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
            Not fully covered by stock: {short.join('; ')}.
          </p>
        ) : null}
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th>Batch (first expiry first)</th>
                <th>Quantity</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-t border-border align-top">
                  <td className="px-3 py-2 font-medium">{l.item.name}</td>
                  <td>
                    <select
                      aria-label={`Batch of ${l.item.name}`}
                      className={`${inputClass} w-72`}
                      value={l.batchId}
                      onChange={(e) => update(i, { batchId: e.target.value })}
                    >
                      <option value="">Choose a batch…</option>
                      {l.batches.map((b) => (
                        <option key={b.batchId} value={b.batchId} disabled={!b.eligible}>
                          {b.batchNo} · exp {b.expiryDate} · {qty(b.availableBase, l.item.units)}
                          {b.reason ? ` (${REASON[b.reason]})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <QtyInput
                      label={`Quantity of ${l.item.name}`}
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
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-muted">
                    {requisitionId
                      ? 'Loading the approved items…'
                      : 'Search an item above to add it.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <label className="block text-sm">
          Note
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="text-xs text-muted">
          Goods are sent at batch cost. Nothing leaves your stock until you dispatch the note.
        </p>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Save transfer note'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
