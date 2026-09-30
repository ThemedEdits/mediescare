'use client';

import { useEffect, useState } from 'react';
import { unitRateFromPack } from '@mediescare/core/money';
import { lineAmountMinor } from '@mediescare/core/money';
import { api, Button, ErrorText, inputClass, Modal, NameDialog, useAsync } from '@/components/ui';
import { pkr, rate, tryMicro, tryMinor } from '@/lib/format';

interface Supplier {
  id: string;
  name: string;
}
interface Found {
  itemId: string;
  sku: string;
  name: string;
}
interface ItemUnits {
  id: string;
  name: string;
  units: { unitId: string; name: string; factorToBase: number; isDefaultPurchase: boolean }[];
}
interface Line {
  key: string;
  item: ItemUnits;
  unitId: string;
  qty: string;
  bonus: string;
  batchNo: string;
  expiry: string;
  price: string;
}

const key = () => Math.random().toString(36).slice(2, 9);

/** An approved purchase order being received: its supplier and what is still outstanding. */
export interface ReceivePo {
  id: string;
  docNo: string;
  supplierId: string;
  lines: {
    itemId: string;
    itemName: string;
    unitId: string;
    factorToBase: number;
    remainingBase: number;
    unitPriceMicro: number;
  }[];
}

/** Goods receipt ("Add stock"): supplier, invoice details, one row per item with batch, expiry and cost. */
export function ReceiveForm({
  canAddSupplier,
  po,
  onClose,
  onSaved,
}: {
  canAddSupplier: boolean;
  /** Receive against this purchase order: supplier and quantities come from it. */
  po?: ReceivePo;
  onClose: () => void;
  onSaved: (docNo: string) => void;
}) {
  const suppliers = useAsync(() => api<{ suppliers: Supplier[] }>('/api/suppliers'));
  const [supplierId, setSupplierId] = useState(po?.supplierId ?? '');
  const [invNo, setInvNo] = useState('');
  const [invDate, setInvDate] = useState('');
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(() => {
    if (!po) return;
    let alive = true;
    Promise.all(
      po.lines
        .filter((l) => l.remainingBase > 0)
        .map(async (l): Promise<Line> => {
          const r = await api<{ item: ItemUnits }>(`/api/items/${l.itemId}`);
          return {
            key: key(),
            item: { id: r.item.id, name: r.item.name, units: r.item.units },
            unitId: l.unitId,
            qty: String(Math.ceil(l.remainingBase / l.factorToBase)),
            bonus: '0',
            batchNo: '',
            expiry: '',
            price: rate(l.unitPriceMicro),
          };
        }),
    )
      .then((rows) => alive && setLines(rows))
      .catch(
        (e: unknown) =>
          alive && setError(e instanceof Error ? e.message : 'Could not load the order'),
      );
    return () => {
      alive = false;
    };
  }, [po]);
  const [discount, setDiscount] = useState('');
  const [salesTax, setSalesTax] = useState('');
  const [advTax, setAdvTax] = useState('');
  const [wht, setWht] = useState('');
  const [freight, setFreight] = useState('');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Found[]>([]);
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

  async function addItem(f: Found) {
    try {
      const r = await api<{ item: ItemUnits & { units: ItemUnits['units'] } }>(
        `/api/items/${f.itemId}`,
      );
      const unit =
        r.item.units.find((u) => u.isDefaultPurchase) ?? r.item.units[r.item.units.length - 1];
      setLines((prev) => [
        ...prev,
        {
          key: key(),
          item: { id: r.item.id, name: r.item.name, units: r.item.units },
          unitId: unit?.unitId ?? '',
          qty: '1',
          bonus: '0',
          batchNo: '',
          expiry: '',
          price: '',
        },
      ]);
      setQ('');
      setFound([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the item');
    }
  }

  const patch = (k: string, p: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.key === k ? { ...l, ...p } : l)));

  const lineTotal = (l: Line): number | null => {
    const micro = tryMicro(l.price);
    const unit = l.item.units.find((u) => u.unitId === l.unitId);
    const qty = Number(l.qty);
    if (micro === null || !unit || !Number.isInteger(qty) || qty <= 0) return null;
    return lineAmountMinor(qty * unit.factorToBase, unitRateFromPack(micro, unit.factorToBase));
  };
  const subTotal = lines.reduce((s, l) => s + (lineTotal(l) ?? 0), 0);
  const m = (t: string) => tryMinor(t) ?? 0;
  const total = subTotal - m(discount) + m(salesTax) + m(advTax) + m(freight);
  const ready =
    supplierId &&
    lines.length > 0 &&
    lines.every(
      (l) => lineTotal(l) !== null && l.batchNo.trim() && /^\d{4}-\d{2}-\d{2}$/.test(l.expiry),
    );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ docNo: string }>('/api/grns', {
        body: {
          supplierId,
          poId: po?.id ?? null,
          supplierInvoiceNo: invNo || null,
          supplierInvoiceDate: invDate || null,
          discountMinor: m(discount),
          salesTaxMinor: m(salesTax),
          advanceTaxMinor: m(advTax),
          whtMinor: m(wht),
          freightMinor: m(freight),
          stockNote: note || null,
          lines: lines.map((l) => ({
            itemId: l.item.id,
            unitId: l.unitId,
            qty: Number(l.qty),
            bonusQty: Number(l.bonus) || 0,
            batchNo: l.batchNo.trim(),
            expiryDate: l.expiry,
            unitPriceMicro: tryMicro(l.price) as number,
          })),
        },
      });
      onSaved(r.docNo);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the receipt');
      setBusy(false);
    }
  }

  const [addingSupplier, setAddingSupplier] = useState(false);

  const cell = 'h-9 rounded-[6px] border border-slate-400 bg-white px-2 text-sm';
  return (
    <Modal title={po ? `Receive ${po.docNo}` : 'Add stock (goods receipt)'} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm sm:col-span-2">
            Supplier
            <span className="flex gap-1">
              <select
                aria-label="Supplier"
                className={`${inputClass} flex-1`}
                value={supplierId}
                disabled={Boolean(po)}
                onChange={(e) => setSupplierId(e.target.value)}
              >
                <option value="">Choose…</option>
                {suppliers.data?.suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {canAddSupplier && !po ? (
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-2"
                  onClick={() => setAddingSupplier(true)}
                >
                  +
                </Button>
              ) : null}
            </span>
          </label>
          <label className="text-sm">
            Supplier invoice no.
            <input
              className={inputClass}
              value={invNo}
              onChange={(e) => setInvNo(e.target.value)}
            />
          </label>
          <label className="text-sm">
            Invoice date
            <input
              type="date"
              className={inputClass}
              value={invDate}
              onChange={(e) => setInvDate(e.target.value)}
            />
          </label>
        </div>

        <div className="relative">
          <input
            aria-label="Add item"
            className={inputClass}
            placeholder="Type an item name to add a row"
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
                    <span className="font-mono text-xs text-muted">{f.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-2 py-2">Item</th>
                <th>Unit</th>
                <th>Qty</th>
                <th>Bonus</th>
                <th>Batch no.</th>
                <th>Expiry</th>
                <th>Price / unit</th>
                <th className="text-end">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className="border-t border-border">
                  <td className="px-2 py-1 font-medium">{l.item.name}</td>
                  <td>
                    <select
                      aria-label="Unit"
                      className={cell}
                      value={l.unitId}
                      onChange={(e) => patch(l.key, { unitId: e.target.value })}
                    >
                      {l.item.units.map((u) => (
                        <option key={u.unitId} value={u.unitId}>
                          {u.name}
                          {u.factorToBase > 1 ? ` (${u.factorToBase})` : ''}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label="Quantity"
                      className={`${cell} w-16`}
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => patch(l.key, { qty: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Bonus quantity"
                      className={`${cell} w-16`}
                      inputMode="numeric"
                      value={l.bonus}
                      onChange={(e) => patch(l.key, { bonus: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Batch number"
                      className={`${cell} w-28 font-mono`}
                      value={l.batchNo}
                      onChange={(e) => patch(l.key, { batchNo: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Expiry date"
                      type="date"
                      className={cell}
                      value={l.expiry}
                      onChange={(e) => patch(l.key, { expiry: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="Price per unit"
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
                      aria-label="Remove row"
                      onClick={() => setLines((p) => p.filter((x) => x.key !== l.key))}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-8 text-center text-muted">
                    Search for an item above to add it to this receipt.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="grid gap-3 sm:grid-cols-5">
          {(
            [
              ['Discount', discount, setDiscount],
              ['Sales tax', salesTax, setSalesTax],
              ['Advance tax', advTax, setAdvTax],
              ['WHT (withheld)', wht, setWht],
              ['Freight', freight, setFreight],
            ] as const
          ).map(([label, v, set]) => (
            <label key={label} className="text-sm">
              {label} (PKR)
              <input
                aria-label={label}
                className={inputClass}
                inputMode="decimal"
                value={v}
                onChange={(e) => set(e.target.value)}
              />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-64 flex-1 text-sm">
            Stock note
            <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="text-end">
            <p className="text-xs text-muted">Goods {pkr(subTotal)}</p>
            <p className="text-2xl font-bold tabular-nums" data-testid="grn-total">
              PKR {pkr(total)}
            </p>
          </div>
        </div>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy || !ready}>
            {busy ? 'Saving…' : 'Receive stock'}
          </Button>
        </div>
      </div>
      {addingSupplier ? (
        <NameDialog
          title="New supplier"
          label="Supplier name"
          onClose={() => setAddingSupplier(false)}
          onSubmit={async (name) => {
            const r = await api<{ id: string }>('/api/suppliers', { body: { name } });
            suppliers.reload();
            setSupplierId(r.id);
            setAddingSupplier(false);
          }}
        />
      ) : null}
    </Modal>
  );
}
