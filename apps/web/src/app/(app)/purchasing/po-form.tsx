'use client';

import { useEffect, useState } from 'react';
import { lineAmountMinor, unitRateFromPack } from '@mediescare/core/money';
import { api, Button, ErrorText, inputClass, Modal, useAsync, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr, rate, tryMicro } from '@/lib/format';

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
interface Line {
  key: string;
  itemId: string;
  name: string;
  units: UnitChoice[];
  unitId: string;
  qty: string;
  price: string;
}
interface Suggestion {
  itemId: string;
  name: string;
  unitId: string;
  unitName: string;
  factorToBase: number;
  suggestedQty: number;
  unitPriceMicro: number;
}

export interface EditablePo {
  id: string;
  version: number;
  supplierId: string;
  expectedDate: string | null;
  note: string | null;
  lines: {
    itemId: string;
    itemName: string;
    unitId: string;
    unitName: string;
    factorToBase: number;
    qtyUnits: number;
    unitPriceMicro: number;
  }[];
}

const key = () => Math.random().toString(36).slice(2, 9);

/** Create a purchase order, or edit a draft one. "Fill from low stock" adds what needs reordering. */
export function PoForm({
  order,
  onClose,
  onSaved,
}: {
  order?: EditablePo;
  onClose: () => void;
  onSaved: (docNo: string | null) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const suppliers = useAsync(() => api<{ suppliers: Supplier[] }>('/api/suppliers'));
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? '');
  const [expected, setExpected] = useState(order?.expectedDate ?? '');
  const [note, setNote] = useState(order?.note ?? '');
  const [lines, setLines] = useState<Line[]>(
    () =>
      order?.lines.map((l) => ({
        key: key(),
        itemId: l.itemId,
        name: l.itemName,
        units: [{ unitId: l.unitId, name: l.unitName, factorToBase: l.factorToBase }],
        unitId: l.unitId,
        qty: String(l.qtyUnits),
        price: rate(l.unitPriceMicro),
      })) ?? [],
  );
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim()) return setFound([]);
    const timer = setTimeout(() => {
      api<{ rows: Found[] }>(`/api/items?q=${encodeURIComponent(q)}&pageSize=8`)
        .then((r) => setFound(r.rows))
        .catch(() => setFound([]));
    }, 150);
    return () => clearTimeout(timer);
  }, [q]);

  async function addItem(f: Found) {
    try {
      const r = await api<{
        item: { id: string; name: string; units: (UnitChoice & { isDefaultPurchase: boolean })[] };
      }>(`/api/items/${f.itemId}`);
      const unit =
        r.item.units.find((u) => u.isDefaultPurchase) ?? r.item.units[r.item.units.length - 1];
      setLines((prev) => [
        ...prev,
        {
          key: key(),
          itemId: r.item.id,
          name: r.item.name,
          units: r.item.units,
          unitId: unit?.unitId ?? '',
          qty: '1',
          price: '',
        },
      ]);
      setQ('');
      setFound([]);
    } catch (e) {
      setError(errorText(e, 'purchasing.form.couldNotAddItem'));
    }
  }

  async function fillFromLowStock() {
    setError(null);
    try {
      const r = await api<{ suggestions: Suggestion[] }>('/api/purchase-orders/suggestions');
      const have = new Set(lines.map((l) => l.itemId));
      const add = r.suggestions
        .filter((s) => !have.has(s.itemId))
        .map((s): Line => ({
          key: key(),
          itemId: s.itemId,
          name: s.name,
          units: [{ unitId: s.unitId, name: s.unitName, factorToBase: s.factorToBase }],
          unitId: s.unitId,
          qty: String(s.suggestedQty),
          price: s.unitPriceMicro > 0 ? rate(s.unitPriceMicro) : '',
        }));
      if (add.length === 0) setError(t('purchasing.form.nothingLow'));
      setLines((prev) => [...prev, ...add]);
    } catch (e) {
      setError(errorText(e, 'purchasing.form.couldNotLoadSuggestions'));
    }
  }

  const patch = (k: string, p: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const lineTotal = (l: Line): number | null => {
    const micro = tryMicro(l.price);
    const unit = l.units.find((u) => u.unitId === l.unitId);
    const qty = Number(l.qty);
    if (micro === null || !unit || !Number.isInteger(qty) || qty <= 0) return null;
    return lineAmountMinor(qty * unit.factorToBase, unitRateFromPack(micro, unit.factorToBase));
  };
  const total = lines.reduce((s, l) => s + (lineTotal(l) ?? 0), 0);
  const ready = supplierId !== '' && lines.length > 0 && lines.every((l) => lineTotal(l) !== null);

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      supplierId,
      expectedDate: expected || null,
      note: note || null,
      lines: lines.map((l) => ({
        itemId: l.itemId,
        unitId: l.unitId,
        qty: Number(l.qty),
        unitPriceMicro: tryMicro(l.price) as number,
      })),
    };
    try {
      if (order) {
        await api(`/api/purchase-orders/${order.id}`, {
          method: 'PUT',
          body: { ...body, expectedVersion: order.version },
        });
        onSaved(null);
      } else {
        const r = await api<{ docNo: string }>('/api/purchase-orders', { body });
        onSaved(r.docNo);
      }
    } catch (e) {
      setError(errorText(e, 'purchasing.form.couldNotSaveOrder'));
      setBusy(false);
    }
  }

  const cell = 'h-9 rounded-[6px] border border-slate-400 bg-white px-2 text-sm';
  return (
    <Modal
      title={order ? t('purchasing.form.editTitle') : t('purchasing.actions.newOrder')}
      onClose={onClose}
      wide
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            {t('common.supplier')}
            <select
              aria-label={t('common.supplier')}
              className={inputClass}
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
            >
              <option value="">{t('purchasing.choose')}</option>
              {suppliers.data?.suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            {t('purchasing.form.expectedOn')}
            <input
              type="date"
              aria-label={t('purchasing.form.expectedDateAria')}
              className={inputClass}
              value={expected}
              onChange={(e) => setExpected(e.target.value)}
            />
          </label>
          <label className="text-sm">
            {t('purchasing.note')}
            <input
              aria-label={t('purchasing.note')}
              className={inputClass}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </div>

        <div className="flex gap-2">
          <div className="relative flex-1">
            <input
              aria-label={t('purchasing.form.addItemAria')}
              className={inputClass}
              placeholder={t('purchasing.form.addItemPlaceholder')}
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
                      onClick={() => void addItem(f)}
                    >
                      <span>{f.name}</span>
                      <bdi className="font-mono text-xs text-muted">{f.sku}</bdi>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <Button type="button" variant="outline" onClick={() => void fillFromLowStock()}>
            {t('purchasing.form.fillLowStock')}
          </Button>
        </div>

        <div className="max-h-[45vh] overflow-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-start text-xs uppercase text-muted">
              <tr>
                <th className="px-2 py-2">{t('common.item')}</th>
                <th>{t('purchasing.col.unit')}</th>
                <th>{t('purchasing.col.qty')}</th>
                <th>{t('purchasing.form.priceUnitCol')}</th>
                <th className="text-end">{t('purchasing.col.amount')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-t border-border">
                  <td className="px-2 py-1 font-medium">{l.name}</td>
                  <td>
                    <select
                      aria-label={t('purchasing.col.unit')}
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
                      aria-label={t('common.quantity')}
                      className={`${cell} w-20`}
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => patch(l.key, { qty: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={t('purchasing.form.priceAria')}
                      className={`${cell} w-24 text-end`}
                      inputMode="decimal"
                      value={l.price}
                      onChange={(e) => patch(l.key, { price: e.target.value })}
                    />
                  </td>
                  <td className="px-2 text-end tabular-nums">
                    {lineTotal(l) === null ? '–' : pkr(lineTotal(l) as number)}
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-danger"
                      aria-label={t('purchasing.form.removeRow')}
                      onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted">
                    {t('purchasing.form.empty')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-end justify-between gap-3">
          <ErrorText message={error} />
          <p className="ms-auto text-2xl font-bold tabular-nums" data-testid="po-total">
            <bdi>PKR {pkr(total)}</bdi>
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy
              ? t('common.saving')
              : order
                ? t('purchasing.form.saveChanges')
                : t('purchasing.form.saveAsDraft')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
