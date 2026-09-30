'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  computeBill,
  settlePayments,
  type BillTotals,
  type PaymentKind,
  type PricedLine,
} from '@mediescare/core/sales';
import { unitRateFromPack } from '@mediescare/core/money';
import { api, ApiError, Badge, Button, ErrorText, inputClass, useAsync } from '@/components/ui';
import { newKey, pkr, rate, tryMicro, tryMinor } from '@/lib/format';
import {
  CloseShiftDialog,
  CustomerDialog,
  MissedDialog,
  NarcoticDialog,
  OpenShiftPanel,
  OverrideDialog,
  ReceiptDialog,
  RecallDialog,
} from './pos-dialogs';
import type {
  CartLine,
  Customer,
  Hit,
  Narcotic,
  OverrideNeed,
  PayRow,
  PaymentMode,
  SaleResult,
  Shift,
} from './pos-types';

interface Lookups {
  units: { id: string; name: string }[];
  paymentModes: PaymentMode[];
  walkinCustomerId: string | null;
  rounding: 'none' | 'rupee' | 'half_rupee';
}

type Dialog =
  | null
  | 'customer'
  | 'recall'
  | 'missed'
  | 'close-shift'
  | { narcotic: string }
  | { override: OverrideNeed };

const lineKey = () => Math.random().toString(36).slice(2, 10);

function unitOf(line: CartLine) {
  return (
    line.hit.units.find((u) => u.unitId === line.unitId) ??
    (line.hit.units[0] as Hit['units'][number])
  );
}

/** Selling price per smallest unit: the typed per-unit price converted to micro-PKR per base unit, or the item's default. */
function rateBase(line: CartLine): number {
  if (line.rateText === undefined) return line.hit.retailRateUnitMicro;
  const packMicro = tryMicro(line.rateText);
  return packMicro === null
    ? line.hit.retailRateUnitMicro
    : unitRateFromPack(packMicro, unitOf(line).factorToBase);
}

export function PosClient({
  branchName,
  cashier,
  canHold,
  canMissed,
}: {
  branchName: string;
  cashier: string;
  canHold: boolean;
  canMissed: boolean;
}) {
  const lookups = useAsync(() => api<Lookups>('/api/lookups'));
  const shiftState = useAsync(() => api<{ shift: Shift | null }>('/api/shifts/current'));
  const shift = shiftState.data?.shift ?? null;
  const modes = lookups.data?.paymentModes ?? [];
  const cashMode = modes.find((m) => m.kind === 'cash');

  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [searching, setSearching] = useState(false);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cursor, setCursor] = useState(0);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [billDiscPct, setBillDiscPct] = useState('');
  const [pays, setPays] = useState<PayRow[]>([]);
  const [note, setNote] = useState('');
  const [holdId, setHoldId] = useState<string | undefined>();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SaleResult | null>(null);
  const [overrides, setOverrides] = useState<{ discount?: string; price?: string }>({});
  const keyRef = useRef(newKey());
  const searchRef = useRef<HTMLInputElement>(null);
  const cashRef = useRef<HTMLInputElement>(null);
  const searchSeq = useRef(0);

  const focusSearch = useCallback(() => setTimeout(() => searchRef.current?.focus(), 0), []);

  // ---- search ----
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setHits([]);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const t = setTimeout(() => {
      api<{ hits: Hit[] }>(`/api/pos/search?q=${encodeURIComponent(q)}`)
        .then((r) => {
          if (seq === searchSeq.current) {
            setHits(r.hits);
            setSel(0);
            setError(null);
          }
        })
        .catch(
          (e: unknown) =>
            seq === searchSeq.current && setError(e instanceof Error ? e.message : 'Search failed'),
        )
        .finally(() => seq === searchSeq.current && setSearching(false));
    }, 110);
    return () => clearTimeout(t);
  }, [query]);

  function touchCart() {
    keyRef.current = newKey(); // the cart changed: the next save is a new attempt
    setOverrides({});
  }

  function addHit(hit: Hit) {
    const unit = hit.units.find((u) => u.isDefaultSale) ?? (hit.units[0] as Hit['units'][number]);
    touchCart();
    setLines((prev) => {
      const same = prev.findIndex(
        (l) =>
          l.hit.id === hit.id && l.unitId === unit.unitId && !l.batchId && l.rateText === undefined,
      );
      if (same >= 0) {
        setCursor(same);
        return prev.map((l, i) => (i === same ? { ...l, qty: l.qty + 1 } : l));
      }
      setCursor(prev.length);
      return [...prev, { key: lineKey(), hit, unitId: unit.unitId, qty: 1, discountPct: '' }];
    });
    setQuery('');
    setHits([]);
    focusSearch();
  }

  /** Enter in the search box: scanner or typed text. Resolves on the server so a fast scan never races the debounce. */
  async function resolveAndAdd() {
    const q = query.trim();
    if (!q) return;
    if (hits.length > 0 && !/^\d{6,}$/.test(q)) return addHit(hits[sel] ?? (hits[0] as Hit));
    try {
      const r = await api<{ hits: Hit[] }>(`/api/pos/search?q=${encodeURIComponent(q)}`);
      const pick = r.hits.find((h) => h.matchedByBarcode) ?? r.hits[0];
      if (pick) addHit(pick);
      else {
        setError(`Nothing found for "${q}". Press F8 to record a missed sale.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed');
    }
  }

  function patchLine(key: string, patch: Partial<CartLine>) {
    touchCart();
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function removeLine(key: string) {
    touchCart();
    setLines((prev) => prev.filter((l) => l.key !== key));
    setCursor((c) => Math.max(0, c - 1));
  }

  // ---- totals ----
  const calc = useMemo(():
    { bill: BillTotals; priced: PricedLine[] } | { error: string } | null => {
    if (lines.length === 0) return null;
    try {
      const priced: PricedLine[] = lines.map((l) => {
        const pct = l.discountPct.trim() === '' ? 0 : Number(l.discountPct);
        if (!Number.isFinite(pct) || pct < 0 || pct > 100)
          throw new Error('Line discount must be between 0 and 100 percent');
        return {
          qtyBase: l.qty * unitOf(l).factorToBase,
          rateUnitMicro: rateBase(l),
          discountBp: Math.floor(pct * 100 + 0.5),
          taxBp: l.hit.taxBp,
          taxInclusive: l.hit.taxInclusive,
        };
      });
      const bp = billDiscPct.trim() === '' ? 0 : Math.floor(Number(billDiscPct) * 100 + 0.5);
      if (!Number.isFinite(bp) || bp < 0 || bp > 10_000)
        throw new Error('Bill discount must be between 0 and 100 percent');
      return {
        bill: computeBill({
          lines: priced,
          billDiscount: bp > 0 ? { kind: 'percent', bp } : undefined,
          rounding: lookups.data?.rounding ?? 'rupee',
        }),
        priced,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Check the quantities and prices' };
    }
  }, [lines, billDiscPct, lookups.data?.rounding]);

  const grand = calc && 'bill' in calc ? calc.bill.grandTotalMinor : 0;
  const settlement = useMemo(() => {
    if (!calc || !('bill' in calc)) return null;
    const hasCredit = pays.some((p) => modes.find((m) => m.id === p.modeId)?.kind === 'credit');
    const tendered = pays.flatMap((p) => {
      const m = modes.find((x) => x.id === p.modeId);
      const amt = tryMinor(p.amount);
      return m && m.kind !== 'credit' && amt && amt > 0
        ? [{ kind: m.kind as PaymentKind, amountMinor: amt }]
        : [];
    });
    try {
      return { ok: true as const, ...settlePayments(grand, tendered, { allowDue: hasCredit }) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : 'Check the payment' };
    }
  }, [calc, pays, modes, grand]);

  const stockWarnings = useMemo(() => {
    const need = new Map<string, number>();
    for (const l of lines)
      need.set(l.hit.id, (need.get(l.hit.id) ?? 0) + l.qty * unitOf(l).factorToBase);
    return new Set(
      lines
        .filter((l) => !l.hit.allowNegativeStock && (need.get(l.hit.id) ?? 0) > l.hit.sellableBase)
        .map((l) => l.key),
    );
  }, [lines]);

  // ---- actions ----
  function clearCart() {
    setLines([]);
    setPays([]);
    setBillDiscPct('');
    setNote('');
    setHoldId(undefined);
    setCustomer(null);
    setError(null);
    setQuery('');
    keyRef.current = newKey();
    setOverrides({});
    focusSearch();
  }

  function setExactCash() {
    if (!cashMode || grand <= 0) return;
    setPays([{ key: lineKey(), modeId: cashMode.id, amount: (grand / 100).toFixed(2) }]);
    setTimeout(() => cashRef.current?.select(), 0);
  }

  async function holdCart() {
    if (!canHold || lines.length === 0) return;
    try {
      const r = await api<{ id: string }>('/api/holds', {
        body: {
          id: holdId,
          label: customer && !customer.isWalkin ? customer.name : lines[0]?.hit.name,
          payload: { lines, customer, billDiscPct, note },
        },
      });
      void r;
      clearCart();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not hold this cart');
    }
  }

  async function recall(id: string) {
    try {
      const r = await api<{
        hold: {
          id: string;
          payload: {
            lines: CartLine[];
            customer: Customer | null;
            billDiscPct: string;
            note: string;
          };
        };
      }>(`/api/holds/${id}`);
      touchCart();
      setLines(r.hold.payload.lines);
      setCustomer(r.hold.payload.customer);
      setBillDiscPct(r.hold.payload.billDiscPct ?? '');
      setNote(r.hold.payload.note ?? '');
      setHoldId(id);
      setPays([]);
      setDialog(null);
      focusSearch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that cart');
    }
  }

  async function save(withOverrides = overrides) {
    if (saving || !calc || !('bill' in calc)) return;
    setError(null);
    const missing = lines.find((l) => l.hit.isNarcotic && !l.narcotic);
    if (missing) {
      setDialog({ narcotic: missing.key });
      return;
    }
    if (!settlement || !settlement.ok) {
      setError(settlement && !settlement.ok ? settlement.message : 'Enter the payment');
      return;
    }
    setSaving(true);
    try {
      const payments = pays.flatMap((p) => {
        const amt = tryMinor(p.amount);
        const m = modes.find((x) => x.id === p.modeId);
        return m && (amt || m.kind === 'credit')
          ? [
              {
                modeId: p.modeId,
                amountMinor:
                  m.kind === 'credit' ? Math.max(1, settlement.dueMinor) : (amt as number),
                reference: p.reference,
              },
            ]
          : [];
      });
      const result = await api<SaleResult>('/api/sales', {
        body: {
          idempotencyKey: keyRef.current,
          customerId:
            customer && !customer.isWalkin
              ? customer.id
              : (lookups.data?.walkinCustomerId ?? undefined),
          lines: lines.map((l) => ({
            itemId: l.hit.id,
            unitId: l.unitId,
            qty: l.qty,
            batchId: l.batchId,
            rateUnitMicro: l.rateText === undefined ? undefined : rateBase(l),
            discountBp: l.discountPct.trim()
              ? Math.floor(Number(l.discountPct) * 100 + 0.5)
              : undefined,
            narcotic: l.narcotic,
          })),
          billDiscount:
            billDiscPct.trim() && Number(billDiscPct) > 0
              ? { kind: 'percent', bp: Math.floor(Number(billDiscPct) * 100 + 0.5) }
              : undefined,
          payments,
          note: note.trim() || undefined,
          discountOverrideId: withOverrides.discount,
          priceOverrideId: withOverrides.price,
        },
      });
      if (holdId) await api(`/api/holds/${holdId}`, { method: 'DELETE' }).catch(() => undefined);
      setSaved(result);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OVERRIDE_REQUIRED' && e.details) {
        // The server says which approval is needed (discount above limit, price change, below cost).
        setDialog({ override: e.details as OverrideNeed });
      } else {
        setError(e instanceof Error ? e.message : 'Could not save the sale');
      }
    } finally {
      setSaving(false);
    }
  }

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (saved || dialog) return;
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === 'F3') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F2') {
        e.preventDefault();
        setDialog('customer');
      } else if (e.key === 'F4') {
        e.preventDefault();
        void holdCart();
      } else if (e.key === 'F5') {
        e.preventDefault();
        setDialog('recall');
      } else if (e.key === 'F8' && canMissed) {
        e.preventDefault();
        setDialog('missed');
      } else if (e.key === 'F9') {
        e.preventDefault();
        setExactCash();
      } else if (e.key === 'F10') {
        e.preventDefault();
        void save();
      } else if (e.key === 'F12') {
        e.preventDefault();
        setDialog('close-shift');
      } else if (e.key === 'Escape') {
        setQuery('');
        setHits([]);
        setError(null);
      } else if (e.ctrlKey && e.key === 'ArrowUp' && lines[cursor]) {
        e.preventDefault();
        patchLine((lines[cursor] as CartLine).key, { qty: (lines[cursor] as CartLine).qty + 1 });
      } else if (e.ctrlKey && e.key === 'ArrowDown' && lines[cursor]) {
        e.preventDefault();
        const l = lines[cursor] as CartLine;
        if (l.qty > 1) patchLine(l.key, { qty: l.qty - 1 });
      } else if (e.ctrlKey && e.key === 'Delete' && lines[cursor]) {
        e.preventDefault();
        removeLine((lines[cursor] as CartLine).key);
      } else if (
        tag !== 'INPUT' &&
        tag !== 'SELECT' &&
        tag !== 'TEXTAREA' &&
        e.key.length === 1 &&
        !e.ctrlKey &&
        !e.altKey
      )
        searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const unitName = (unitId: string) => lookups.data?.units.find((u) => u.id === unitId)?.name ?? '';

  if (shiftState.data && !shift)
    return (
      <main className="p-6">
        <OpenShiftPanel
          onOpened={() => {
            shiftState.reload();
            focusSearch();
          }}
        />
      </main>
    );
  if (!shiftState.data)
    return <main className="p-6 text-muted">{shiftState.error ?? 'Loading…'}</main>;

  const due = settlement && settlement.ok ? settlement.dueMinor : grand;
  const change = settlement && settlement.ok ? settlement.changeMinor : 0;

  return (
    <main className="flex min-h-[calc(100vh-57px)] flex-col gap-3 p-3" aria-label="Point of sale">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Badge tone="success">Shift {shift?.docNo}</Badge>
        <button
          type="button"
          className="rounded-[6px] border border-border px-3 py-1.5 hover:bg-primary-50"
          onClick={() => setDialog('customer')}
        >
          <span className="text-muted">Customer </span>
          <strong>{customer?.name ?? 'Walk-in customer'}</strong>{' '}
          <kbd className="text-xs text-muted">F2</kbd>
        </button>
        <span className="ms-auto flex flex-wrap gap-1">
          {canHold ? (
            <Button
              variant="outline"
              className="h-9"
              onClick={() => void holdCart()}
              disabled={lines.length === 0}
            >
              Hold <kbd className="text-xs opacity-70">F4</kbd>
            </Button>
          ) : null}
          <Button variant="outline" className="h-9" onClick={() => setDialog('recall')}>
            Recall <kbd className="text-xs opacity-70">F5</kbd>
          </Button>
          {canMissed ? (
            <Button variant="outline" className="h-9" onClick={() => setDialog('missed')}>
              Missed sale <kbd className="text-xs opacity-70">F8</kbd>
            </Button>
          ) : null}
          <Button variant="outline" className="h-9" onClick={() => setDialog('close-shift')}>
            Close shift <kbd className="text-xs opacity-70">F12</kbd>
          </Button>
        </span>
      </div>

      <div className="relative">
        <input
          ref={searchRef}
          autoFocus
          aria-label="Search item or scan barcode"
          className={`${inputClass} h-12 text-lg`}
          placeholder="Scan barcode or type item name (F3)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void resolveAndAdd();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSel((s) => Math.min(s + 1, hits.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(s - 1, 0));
            }
          }}
          autoComplete="off"
        />
        {query.trim() && (hits.length > 0 || searching) ? (
          <ul
            className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-[10px] border border-border bg-white shadow-lg"
            role="listbox"
          >
            {hits.map((h, i) => (
              <li key={h.id} role="option" aria-selected={i === sel}>
                <button
                  type="button"
                  onMouseEnter={() => setSel(i)}
                  onClick={() => addHit(h)}
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-start ${i === sel ? 'bg-primary-50' : ''}`}
                >
                  <span className="flex-1">
                    <span className="font-medium">{h.name}</span>{' '}
                    <span className="text-xs text-muted">
                      {[h.genericName, h.strength, h.dosageForm].filter(Boolean).join(' · ')}
                    </span>
                    <span className="block text-xs text-muted">
                      {h.rackCode ? `Rack ${h.rackCode} · ` : ''}
                      {h.nearestExpiry ? `earliest expiry ${h.nearestExpiry}` : 'no sellable stock'}
                    </span>
                  </span>
                  {h.isNarcotic ? (
                    <Badge tone="danger">Controlled</Badge>
                  ) : h.isPrescription ? (
                    <Badge tone="warning">Rx</Badge>
                  ) : null}
                  <span className="text-end">
                    <span className="block font-semibold">
                      {rate(
                        h.retailRateUnitMicro *
                          (
                            h.units.find((u) => u.isDefaultSale) ??
                            (h.units[0] as Hit['units'][number])
                          ).factorToBase,
                      )}
                    </span>
                    <span
                      className={`block text-xs ${h.sellableBase > 0 ? 'text-success' : 'text-danger'}`}
                    >
                      {h.sellableBase > 0 ? `${h.sellableBase} in stock` : 'Out of stock'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
            {hits.length === 0 && searching ? (
              <li className="px-4 py-3 text-sm text-muted">Searching…</li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <ErrorText message={error} />

      <div className="grid flex-1 gap-3 lg:grid-cols-[1fr_20rem]">
        <section className="overflow-x-auto rounded-[10px] border border-border" aria-label="Cart">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2">Batch</th>
                <th className="px-3 py-2 text-end">Price</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Disc %</th>
                <th className="px-3 py-2 text-end">Amount</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const t = calc && 'bill' in calc ? calc.bill.lines[i] : undefined;
                const unit = unitOf(l);
                const sellable = l.hit.batches.filter((b) => b.expiry.state !== 'expired');
                return (
                  <tr
                    key={l.key}
                    className={`border-t border-border ${i === cursor ? 'bg-primary-50' : ''}`}
                    onClick={() => setCursor(i)}
                    style={{ height: 48 }}
                  >
                    <td className="px-3 text-muted">{i + 1}</td>
                    <td className="px-3">
                      <span className="font-medium">{l.hit.name}</span>
                      {l.hit.isNarcotic ? (
                        <span className="ms-2">
                          <Badge tone={l.narcotic ? 'success' : 'danger'}>
                            {l.narcotic ? 'Patient recorded' : 'Needs patient'}
                          </Badge>
                        </span>
                      ) : null}
                      {stockWarnings.has(l.key) ? (
                        <span className="ms-2">
                          <Badge tone="danger">Only {l.hit.sellableBase} in stock</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3">
                      <select
                        aria-label="Unit"
                        className="h-9 rounded-[6px] border border-slate-400 bg-white px-1"
                        value={l.unitId}
                        onChange={(e) =>
                          patchLine(l.key, { unitId: e.target.value, rateText: undefined })
                        }
                      >
                        {l.hit.units.map((u) => (
                          <option key={u.unitId} value={u.unitId}>
                            {u.name}
                            {u.factorToBase > 1 ? ` (${u.factorToBase})` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3">
                      <select
                        aria-label="Batch"
                        className="h-9 max-w-40 rounded-[6px] border border-slate-400 bg-white px-1"
                        value={l.batchId ?? ''}
                        onChange={(e) => patchLine(l.key, { batchId: e.target.value || undefined })}
                      >
                        <option value="">Auto (first expiry)</option>
                        {sellable.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.batchNo} [{b.available}] {b.expiryDate}
                            {b.expiry.state === 'near' ? ` ⚠ ${b.expiry.daysLeft}d` : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 text-end">
                      <input
                        aria-label="Price"
                        className="h-9 w-24 rounded-[6px] border border-slate-400 px-2 text-end"
                        inputMode="decimal"
                        value={l.rateText ?? rate(l.hit.retailRateUnitMicro * unit.factorToBase)}
                        onChange={(e) => patchLine(l.key, { rateText: e.target.value })}
                      />
                    </td>
                    <td className="px-3">
                      <input
                        aria-label="Quantity"
                        type="number"
                        min={1}
                        className="h-9 w-20 rounded-[6px] border border-slate-400 px-2 text-center font-semibold"
                        value={l.qty}
                        onChange={(e) =>
                          patchLine(l.key, {
                            qty: Math.max(1, Math.floor(Number(e.target.value) || 1)),
                          })
                        }
                      />
                    </td>
                    <td className="px-3">
                      <input
                        aria-label="Discount percent"
                        className="h-9 w-16 rounded-[6px] border border-slate-400 px-2 text-center"
                        inputMode="decimal"
                        value={l.discountPct}
                        onChange={(e) => patchLine(l.key, { discountPct: e.target.value })}
                      />
                    </td>
                    <td className="px-3 text-end font-semibold">{t ? pkr(t.netMinor) : '–'}</td>
                    <td className="px-2 text-end">
                      {l.hit.isNarcotic ? (
                        <Button
                          variant="ghost"
                          className="h-8 px-2"
                          onClick={() => setDialog({ narcotic: l.key })}
                        >
                          Patient
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        className="h-8 px-2 text-danger"
                        aria-label="Remove line"
                        onClick={() => removeLine(l.key)}
                      >
                        ✕
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-16 text-center text-muted">
                    Scan a barcode or type an item name to start a sale.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {calc && 'error' in calc ? (
            <p role="alert" className="px-3 py-2 text-sm text-danger">
              {calc.error}
            </p>
          ) : null}
        </section>

        <aside className="space-y-3" aria-label="Totals and payment">
          <div className="rounded-[10px] border border-border bg-surface p-4">
            <Line
              label="Sub-total"
              value={
                calc && 'bill' in calc
                  ? pkr(calc.bill.grossMinor - calc.bill.lineDiscountMinor)
                  : '0.00'
              }
            />
            <label className="my-1 flex items-center justify-between text-sm">
              <span className="text-muted">Bill discount %</span>
              <input
                aria-label="Bill discount percent"
                className="h-8 w-20 rounded-[6px] border border-slate-400 px-2 text-end"
                inputMode="decimal"
                value={billDiscPct}
                onChange={(e) => {
                  touchCart();
                  setBillDiscPct(e.target.value);
                }}
              />
            </label>
            {calc && 'bill' in calc && calc.bill.totalDiscountMinor > 0 ? (
              <Line label="Discount" value={`-${pkr(calc.bill.totalDiscountMinor)}`} />
            ) : null}
            {calc && 'bill' in calc && calc.bill.taxMinor > 0 ? (
              <Line label="Tax" value={pkr(calc.bill.taxMinor)} />
            ) : null}
            {calc && 'bill' in calc && calc.bill.roundingMinor !== 0 ? (
              <Line label="Rounding" value={pkr(calc.bill.roundingMinor)} />
            ) : null}
            <div className="mt-2 border-t border-border pt-2">
              <p className="text-xs uppercase text-muted">Grand total (PKR)</p>
              <p className="text-4xl font-bold tabular-nums" data-testid="grand-total">
                {pkr(grand)}
              </p>
            </div>
          </div>

          <div className="space-y-2 rounded-[10px] border border-border p-3">
            <div className="flex items-center justify-between text-sm">
              <strong>Payment</strong>
              <span className="text-xs text-muted">F9 = exact cash</span>
            </div>
            {pays.map((p, i) => (
              <div key={p.key} className="flex gap-1">
                <select
                  aria-label="Payment method"
                  className="h-10 flex-1 rounded-[6px] border border-slate-400 bg-white px-1 text-sm"
                  value={p.modeId}
                  onChange={(e) =>
                    setPays((prev) =>
                      prev.map((x) => (x.key === p.key ? { ...x, modeId: e.target.value } : x)),
                    )
                  }
                >
                  {modes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <input
                  ref={i === 0 ? cashRef : undefined}
                  aria-label="Amount received"
                  className="h-10 w-28 rounded-[6px] border border-slate-400 px-2 text-end text-lg"
                  inputMode="decimal"
                  value={p.amount}
                  onChange={(e) =>
                    setPays((prev) =>
                      prev.map((x) => (x.key === p.key ? { ...x, amount: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  variant="ghost"
                  className="h-10 px-2 text-danger"
                  aria-label="Remove payment"
                  onClick={() => setPays((prev) => prev.filter((x) => x.key !== p.key))}
                >
                  ✕
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-1">
              {pays.length === 0 && cashMode ? (
                <Button
                  variant="outline"
                  className="h-9"
                  onClick={setExactCash}
                  disabled={grand <= 0}
                >
                  Exact cash
                </Button>
              ) : null}
              <Button
                variant="outline"
                className="h-9"
                disabled={modes.length === 0}
                onClick={() =>
                  setPays((prev) => [
                    ...prev,
                    {
                      key: lineKey(),
                      modeId:
                        (prev.length === 0
                          ? cashMode
                          : (modes.find((m) => m.kind === 'wallet') ?? modes[0])
                        )?.id ?? '',
                      amount: '',
                    },
                  ])
                }
              >
                + Add payment
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2 pt-1 text-center">
              <div className="rounded-[6px] bg-surface p-2">
                <p className="text-xs text-muted">Due</p>
                <p
                  className={`text-xl font-bold ${due > 0 && pays.length > 0 ? 'text-danger' : ''}`}
                  data-testid="due"
                >
                  {pkr(Math.max(due, 0))}
                </p>
              </div>
              <div className="rounded-[6px] bg-surface p-2">
                <p className="text-xs text-muted">Change</p>
                <p className="text-xl font-bold text-success" data-testid="change">
                  {pkr(change)}
                </p>
              </div>
            </div>
            {settlement && !settlement.ok && pays.length > 0 ? (
              <p className="text-xs text-danger">{settlement.message}</p>
            ) : null}
          </div>

          <input
            aria-label="Invoice note"
            className={inputClass}
            placeholder="Invoice note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="h-12 flex-1"
              onClick={clearCart}
              disabled={lines.length === 0}
            >
              Clear
            </Button>
            <Button
              className="h-12 flex-[2] text-base"
              onClick={() => void save()}
              disabled={saving || lines.length === 0 || !calc || 'error' in calc}
            >
              {saving ? 'Saving…' : 'Save (F10)'}
            </Button>
          </div>
        </aside>
      </div>

      {dialog === 'customer' ? (
        <CustomerDialog
          onClose={() => {
            setDialog(null);
            focusSearch();
          }}
          onPick={(c) => {
            setCustomer(c.isWalkin ? null : c);
            setDialog(null);
            focusSearch();
          }}
        />
      ) : null}
      {dialog === 'recall' ? (
        <RecallDialog onClose={() => setDialog(null)} onPick={(id) => void recall(id)} />
      ) : null}
      {dialog === 'missed' ? (
        <MissedDialog
          initialText={query}
          onClose={() => {
            setDialog(null);
            focusSearch();
          }}
          onSaved={() => {
            setDialog(null);
            setQuery('');
            setError(null);
            focusSearch();
          }}
        />
      ) : null}
      {dialog === 'close-shift' && shift ? (
        <CloseShiftDialog
          shift={shift}
          onClose={() => setDialog(null)}
          onClosed={() => {
            setDialog(null);
            clearCart();
            shiftState.reload();
          }}
        />
      ) : null}
      {dialog && typeof dialog === 'object' && 'narcotic' in dialog ? (
        <NarcoticDialog
          itemName={lines.find((l) => l.key === dialog.narcotic)?.hit.name ?? ''}
          initial={lines.find((l) => l.key === dialog.narcotic)?.narcotic}
          onClose={() => setDialog(null)}
          onSave={(n: Narcotic) => {
            patchLine(dialog.narcotic, { narcotic: n });
            setDialog(null);
          }}
        />
      ) : null}
      {dialog && typeof dialog === 'object' && 'override' in dialog ? (
        <OverrideDialog
          need={dialog.override}
          onClose={() => setDialog(null)}
          onGranted={(id) => {
            const next =
              dialog.override.kind === 'discount'
                ? { ...overrides, discount: id }
                : { ...overrides, price: id };
            setOverrides(next);
            setDialog(null);
            void save(next);
          }}
        />
      ) : null}
      {saved ? (
        <ReceiptDialog
          sale={saved}
          branchName={branchName}
          cashier={cashier}
          lineUnit={unitName}
          onNew={() => {
            setSaved(null);
            clearCart();
          }}
        />
      ) : null}
    </main>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
