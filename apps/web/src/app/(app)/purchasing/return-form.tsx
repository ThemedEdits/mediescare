'use client';

import { useEffect, useState } from 'react';
import { lineAmountMinor } from '@mediescare/core/money';
import { api, Button, ErrorText, inputClass, Modal, useAsync } from '@/components/ui';
import { pkr } from '@/lib/format';

interface Supplier {
  id: string;
  name: string;
}
interface Found {
  itemId: string;
  sku: string;
  name: string;
}
interface UnitChoice {
  unitId: string;
  name: string;
  factorToBase: number;
}
interface Batch {
  id: string;
  batchNo: string;
  expiryDate: string;
  available: number;
  costUnitMicro?: number;
}
interface Line {
  key: string;
  itemName: string;
  units: UnitChoice[];
  unitId: string;
  batch: Batch;
  qty: string;
}

const REASONS: [string, string][] = [
  ['damaged', 'Damaged'],
  ['expired', 'Expired'],
  ['near_expiry', 'Near expiry'],
  ['wrong_item', 'Wrong item sent'],
  ['overstock', 'Overstock'],
  ['recall', 'Recall'],
  ['other', 'Other (describe)'],
];

const key = () => Math.random().toString(36).slice(2, 9);

/** Return goods to a supplier: pick the batches leaving the shelf; the value becomes a credit on the supplier account. */
export function ReturnForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (docNo: string) => void;
}) {
  const suppliers = useAsync(() => api<{ suppliers: Supplier[] }>('/api/suppliers'));
  const [supplierId, setSupplierId] = useState('');
  const [reason, setReason] = useState('damaged');
  const [creditNoteNo, setCreditNoteNo] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [picking, setPicking] = useState<{
    name: string;
    units: UnitChoice[];
    batches: Batch[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) return setFound([]);
    const t = setTimeout(() => {
      api<{ rows: Found[] }>(`/api/items?q=${encodeURIComponent(q)}&pageSize=8`)
        .then((r) => setFound(r.rows))
        .catch(() => setFound([]));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  async function pickItem(f: Found) {
    setError(null);
    try {
      const [item, stock] = await Promise.all([
        api<{ item: { name: string; units: (UnitChoice & { isDefaultPurchase: boolean })[] } }>(
          `/api/items/${f.itemId}`,
        ),
        api<{ batches: Batch[] }>(`/api/stock/batches?itemId=${f.itemId}`),
      ]);
      const batches = stock.batches.filter((b) => b.available > 0);
      if (batches.length === 0) setError(`${item.item.name} has no stock to return.`);
      else setPicking({ name: item.item.name, units: item.item.units, batches });
      setQ('');
      setFound([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the batches');
    }
  }

  function addBatch(b: Batch) {
    if (!picking || lines.some((l) => l.batch.id === b.id)) return;
    const unit = picking.units[picking.units.length - 1];
    setLines((prev) => [
      ...prev,
      {
        key: key(),
        itemName: picking.name,
        units: picking.units,
        unitId: unit?.unitId ?? '',
        batch: b,
        qty: '1',
      },
    ]);
  }

  const patch = (k: string, p: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const qtyBase = (l: Line): number | null => {
    const unit = l.units.find((u) => u.unitId === l.unitId);
    const n = Number(l.qty);
    return unit && Number.isInteger(n) && n > 0 ? n * unit.factorToBase : null;
  };
  const amount = (l: Line): number | null => {
    const b = qtyBase(l);
    return b === null || l.batch.costUnitMicro === undefined
      ? null
      : lineAmountMinor(b, l.batch.costUnitMicro);
  };
  const total = lines.reduce((s, l) => s + (amount(l) ?? 0), 0);
  const ready =
    supplierId &&
    lines.length > 0 &&
    lines.every((l) => (qtyBase(l) ?? Infinity) <= l.batch.available && qtyBase(l) !== null) &&
    (reason !== 'other' || note.trim());

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ docNo: string }>('/api/purchase-returns', {
        body: {
          supplierId,
          reason,
          creditNoteNo: creditNoteNo || undefined,
          note: note || undefined,
          lines: lines.map((l) => ({ batchId: l.batch.id, qtyBase: qtyBase(l) as number })),
        },
      });
      onSaved(r.docNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the return');
      setBusy(false);
    }
  }

  const cell = 'h-9 rounded-[6px] border border-slate-400 bg-white px-2 text-sm';
  return (
    <Modal title="Return goods to a supplier" onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm">
            Supplier
            <select
              aria-label="Supplier"
              className={inputClass}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">Choose…</option>
              {suppliers.data?.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Reason
            <select
              aria-label="Reason"
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            >
              {REASONS.map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Supplier credit note no.
            <input
              aria-label="Credit note number"
              className={inputClass}
              value={creditNoteNo}
              onChange={(e) => setCreditNoteNo(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Note
            <input
              aria-label="Note"
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>

        <div className="relative">
          <input
            aria-label="Find item"
            className={inputClass}
            placeholder="Type an item name to choose the batch to return"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {found.length > 0 ? (
            <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-[6px] border border-border bg-white shadow-lg">
              {found.map((f) => (
                <li key={f.itemId}>
                  <button
                    type="button"
                    className="flex w-full justify-between px-3 py-2 text-start hover:bg-primary-50"
                    onClick={() => void pickItem(f)}
                  >
                    <span>{f.name}</span>
                    <span className="font-mono text-xs text-muted">{f.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {picking ? (
          <div className="rounded-[10px] border border-primary-600 bg-primary-50 p-3">
            <p className="mb-2 text-sm font-medium">Batches of {picking.name}</p>
            <div className="flex flex-wrap gap-2">
              {picking.batches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  disabled={lines.some((l) => l.batch.id === b.id)}
                  onClick={() => addBatch(b)}
                  className="rounded-[6px] border border-primary-600 bg-white px-3 py-1 text-start text-sm hover:bg-primary-50 disabled:opacity-40"
                >
                  <span className="font-mono">{b.batchNo}</span> · exp {b.expiryDate} ·{' '}
                  {b.available} in stock
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="max-h-[35vh] overflow-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-2 py-2">Item</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th className="text-end">In stock</th>
                <th>Unit</th>
                <th>Return qty</th>
                <th className="text-end">Credit</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const b = qtyBase(l);
                return (
                  <tr key={l.key} className="border-t border-border">
                    <td className="px-2 py-1 font-medium">{l.itemName}</td>
                    <td className="font-mono text-xs">{l.batch.batchNo}</td>
                    <td>{l.batch.expiryDate}</td>
                    <td className="text-end tabular-nums">{l.batch.available}</td>
                    <td>
                      <select
                        aria-label="Unit"
                        className={cell}
                        value={l.unitId}
                        onChange={(e) => patch(l.key, { unitId: e.target.value })}
                      >
                        {l.units.map((u) => (
                          <option key={u.unitId} value={u.unitId}>
                            {u.name}
                            {u.factorToBase > 1 ? ` (${u.factorToBase})` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        aria-label="Return quantity"
                        className={`${cell} w-20 ${b !== null && b > l.batch.available ? 'border-danger' : ''}`}
                        inputMode="numeric"
                        value={l.qty}
                        onChange={(e) => patch(l.key, { qty: e.target.value })}
                      />
                    </td>
                    <td className="px-2 text-end tabular-nums">
                      {amount(l) === null ? '–' : pkr(amount(l) as number)}
                    </td>
                    <td>
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-danger"
                        aria-label="Remove row"
                        onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted">
                    Search for an item and choose the batch that is going back.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-end justify-between gap-3">
          <ErrorText message={error} />
          <p className="ms-auto text-2xl font-bold tabular-nums" data-testid="return-total">
            Credit PKR {pkr(total)}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Return goods'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
