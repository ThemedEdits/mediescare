'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { unitRateFromPack } from '@mediescare/core/money';
import {
  api,
  Badge,
  Button,
  ErrorText,
  inputClass,
  Modal,
  NameDialog,
  useAsync,
  useErrorText,
} from '@/components/ui';
import { useT } from '@/i18n/client';
import { bpToPercent, percentToBp } from '../settings/percent';
import { pkr, rate, tryMicro } from '@/lib/format';

interface StockRow {
  itemId: string;
  sku: string;
  name: string;
  genericName: string | null;
  onHandBase: number;
  expiredBase: number;
  sellableBase: number;
  reorderLevelBase: number;
  low: boolean;
  nearestExpiry: string | null;
  costValueMinor?: number;
}
interface Lookups {
  units: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  manufacturers: { id: string; name: string }[];
  racks: { id: string; code: string }[];
  settings?: Record<string, string | number | boolean>;
}
interface ItemDetail {
  id: string;
  sku: string;
  name: string;
  genericName: string | null;
  strength: string | null;
  dosageForm: string | null;
  categoryId: string | null;
  manufacturerId: string | null;
  rackId: string | null;
  baseUnitId: string;
  retailRateUnitMicro: number;
  taxBp: number;
  taxInclusive: boolean;
  reorderLevelBase: number;
  isPrescription: boolean;
  isNarcotic: boolean;
  isColdChain: boolean;
  allowNegativeStock: boolean;
  drapRegNo: string | null;
  isActive: boolean;
  version: number;
  units: {
    unitId: string;
    name: string;
    factorToBase: number;
    isDefaultSale: boolean;
    isDefaultPurchase: boolean;
  }[];
  barcodes: string[];
}

export function ItemsClient({
  canCreate,
  canImport,
  canEdit,
  canSeeCost,
  pricesSetByHeadOffice = false,
}: {
  canCreate: boolean;
  canImport: boolean;
  canEdit: boolean;
  canSeeCost: boolean;
  /** True on a branch: Head Office creates items and sets prices and tax rates, they are read-only here. */
  pricesSetByHeadOffice?: boolean;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [flt, setFlt] = useState('');
  const list = useAsync(
    () =>
      api<{ rows: StockRow[]; total: number }>(
        `/api/items?q=${encodeURIComponent(q)}&page=${page}&pageSize=25${flt === 'low' ? '&low=1' : flt === 'in' ? '&inStock=1' : ''}`,
      ),
    [q, page, flt],
  );
  const lookups = useAsync(() => api<Lookups>('/api/lookups'));
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('items.title')}</h1>
          <p className="text-sm text-muted">{t('items.subtitle')}</p>
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <input
            aria-label={t('items.searchItems')}
            className={`${inputClass} w-64`}
            placeholder={t('items.searchPlaceholder')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label={t('items.filter')}
            className={`${inputClass} w-40`}
            value={flt}
            onChange={(e) => {
              setFlt(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('items.filterAll')}</option>
            <option value="in">{t('items.filterIn')}</option>
            <option value="low">{t('items.filterLow')}</option>
          </select>
          {canImport && !pricesSetByHeadOffice ? (
            <Link
              href="/items/import"
              className="inline-flex h-10 items-center rounded-[6px] border border-primary-600 px-4 text-sm font-semibold text-primary-600 hover:bg-primary-50"
            >
              {t('items.importExcel')}
            </Link>
          ) : null}
          {canCreate && !pricesSetByHeadOffice ? (
            <Button onClick={() => setEditing('new')}>{t('items.addItem')}</Button>
          ) : null}
        </div>
      </div>
      <ErrorText message={list.error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">{t('items.col.code')}</th>
              <th className="px-4 py-3">{t('common.name')}</th>
              <th className="px-4 py-3">{t('items.col.generic')}</th>
              <th className="px-4 py-3 text-end">{t('items.col.onHand')}</th>
              <th className="px-4 py-3 text-end">{t('items.col.expired')}</th>
              <th className="px-4 py-3">{t('items.col.earliestExpiry')}</th>
              {canSeeCost ? (
                <th className="px-4 py-3 text-end">{t('items.col.stockValue')}</th>
              ) : null}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.itemId} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs">
                  <bdi>{r.sku}</bdi>
                </td>
                <td className="px-4 py-3 font-medium">
                  {r.name} {r.low ? <Badge tone="warning">{t('items.low')}</Badge> : null}
                </td>
                <td className="px-4 py-3 text-muted">{r.genericName ?? ''}</td>
                <td className="px-4 py-3 text-end tabular-nums">{r.onHandBase}</td>
                <td className="px-4 py-3 text-end tabular-nums">
                  {r.expiredBase > 0 ? <Badge tone="danger">{r.expiredBase}</Badge> : 0}
                </td>
                <td className="px-4 py-3">
                  <bdi>{r.nearestExpiry ?? '–'}</bdi>
                </td>
                {canSeeCost ? (
                  <td className="px-4 py-3 text-end tabular-nums">{pkr(r.costValueMinor ?? 0)}</td>
                ) : null}
                <td className="px-4 py-3 text-end">
                  <Button variant="ghost" className="h-8 px-2" onClick={() => setEditing(r.itemId)}>
                    {canEdit ? t('common.edit') : t('items.view')}
                  </Button>
                </td>
              </tr>
            ))}
            {list.data && list.data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  {t('items.empty')} {canCreate ? t('items.emptyHint') : ''}
                </td>
              </tr>
            ) : null}
            {!list.data && !list.error ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  {t('common.loading')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{t('items.count', { count: list.data?.total ?? 0 })}</span>
        <span className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 px-3"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('common.previous')}
          </Button>
          {t('items.pageOf', { page, pages })}
          <Button
            variant="outline"
            className="h-8 px-3"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('common.next')}
          </Button>
        </span>
      </div>
      {editing && lookups.data ? (
        <ItemForm
          id={editing === 'new' ? null : editing}
          lookups={lookups.data}
          readOnly={!(editing === 'new' ? canCreate && !pricesSetByHeadOffice : canEdit)}
          priceLocked={pricesSetByHeadOffice}
          onReloadLookups={lookups.reload}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function ItemForm({
  id,
  lookups,
  readOnly,
  priceLocked,
  onReloadLookups,
  onClose,
  onSaved,
}: {
  id: string | null;
  lookups: Lookups;
  readOnly: boolean;
  priceLocked: boolean;
  onReloadLookups: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const detail = useAsync(
    () => (id ? api<{ item: ItemDetail }>(`/api/items/${id}`) : Promise.resolve(null)),
    [id],
  );
  if (id && !detail.data)
    return (
      <Modal title={t('items.modalTitle')} onClose={onClose}>
        <p className="text-sm text-muted">{detail.error ?? t('common.loading')}</p>
      </Modal>
    );
  return (
    <ItemFormBody
      key={id ?? 'new'}
      item={detail.data?.item ?? null}
      lookups={lookups}
      readOnly={readOnly}
      priceLocked={priceLocked}
      onReloadLookups={onReloadLookups}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

interface UnitRow {
  unitId: string;
  factor: string;
  sale: boolean;
  purchase: boolean;
}

function ItemFormBody({
  item,
  lookups,
  readOnly,
  priceLocked,
  onReloadLookups,
  onClose,
  onSaved,
}: {
  item: ItemDetail | null;
  lookups: Lookups;
  readOnly: boolean;
  priceLocked: boolean;
  onReloadLookups: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const tablet = lookups.units.find((u) => u.name === 'Tablet')?.id ?? lookups.units[0]?.id ?? '';
  const strip = lookups.units.find((u) => u.name === 'Strip')?.id;
  const [f, setF] = useState(() => ({
    name: item?.name ?? '',
    genericName: item?.genericName ?? '',
    strength: item?.strength ?? '',
    dosageForm: item?.dosageForm ?? '',
    categoryId: item?.categoryId ?? '',
    manufacturerId: item?.manufacturerId ?? '',
    rackId: item?.rackId ?? '',
    baseUnitId: item?.baseUnitId ?? tablet,
    taxPct: item
      ? bpToPercent(item.taxBp)
      : bpToPercent(Number(lookups.settings?.['tax.default_sales_tax_bp'] ?? 0)),
    taxInclusive: item?.taxInclusive ?? false,
    reorder: String(item?.reorderLevelBase ?? 0),
    isPrescription: item?.isPrescription ?? false,
    isNarcotic: item?.isNarcotic ?? false,
    isColdChain: item?.isColdChain ?? false,
    allowNegativeStock: item?.allowNegativeStock ?? false,
    drapRegNo: item?.drapRegNo ?? '',
    isActive: item?.isActive ?? true,
    barcodes: (item?.barcodes ?? []).join(', '),
  }));
  const [unitRows, setUnitRows] = useState<UnitRow[]>(() =>
    item
      ? item.units.map((u) => ({
          unitId: u.unitId,
          factor: String(u.factorToBase),
          sale: u.isDefaultSale,
          purchase: u.isDefaultPurchase,
        }))
      : [
          { unitId: tablet, factor: '1', sale: !strip, purchase: false },
          ...(strip ? [{ unitId: strip, factor: '10', sale: true, purchase: true }] : []),
        ],
  );
  const saleRow = unitRows.find((u) => u.sale) ?? unitRows[0];
  const saleFactor = Number(saleRow?.factor) || 1;
  const [price, setPrice] = useState(() =>
    item
      ? rate(
          item.retailRateUnitMicro * (item.units.find((u) => u.isDefaultSale)?.factorToBase ?? 1),
        )
      : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const [adding, setAdding] = useState<{
    kind: 'categories' | 'manufacturers' | 'racks';
    label: 'category' | 'manufacturer' | 'rack';
    key: 'categoryId' | 'manufacturerId' | 'rackId';
  } | null>(null);
  const quickAdd = (
    kind: 'categories' | 'manufacturers' | 'racks',
    label: 'category' | 'manufacturer' | 'rack',
    key: 'categoryId' | 'manufacturerId' | 'rackId',
  ) => setAdding({ kind, label, key });

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const packMicro = tryMicro(price);
    if (packMicro === null) return setError(t('items.errPrice'));
    const factors = unitRows.map((u) => Number(u.factor));
    if (factors.some((n) => !Number.isInteger(n) || n < 1)) return setError(t('items.errUnits'));
    setBusy(true);
    const body = {
      name: f.name,
      genericName: f.genericName || null,
      strength: f.strength || null,
      dosageForm: f.dosageForm || null,
      categoryId: f.categoryId || null,
      manufacturerId: f.manufacturerId || null,
      rackId: f.rackId || null,
      baseUnitId: f.baseUnitId,
      units: unitRows.map((u, i) => ({
        unitId: u.unitId,
        factorToBase: factors[i] as number,
        isDefaultSale: u.sale,
        isDefaultPurchase: u.purchase,
      })),
      barcodes: f.barcodes
        .split(/[,\s]+/)
        .map((b) => b.trim())
        .filter(Boolean),
      // On a branch the stored values go back unchanged (what is shown may be rounded for display).
      retailRateUnitMicro:
        priceLocked && item ? item.retailRateUnitMicro : unitRateFromPack(packMicro, saleFactor),
      taxBp: priceLocked && item ? item.taxBp : (percentToBp(f.taxPct) ?? 0),
      taxInclusive: priceLocked && item ? item.taxInclusive : f.taxInclusive,
      reorderLevelBase: Math.max(0, Math.floor(Number(f.reorder) || 0)),
      isPrescription: f.isPrescription,
      isNarcotic: f.isNarcotic,
      isColdChain: f.isColdChain,
      allowNegativeStock: f.allowNegativeStock,
      drapRegNo: f.drapRegNo || null,
      isActive: f.isActive,
    };
    try {
      if (item)
        await api(`/api/items/${item.id}`, {
          method: 'PUT',
          body: { ...body, expectedVersion: item.version },
        });
      else await api('/api/items', { body });
      onSaved();
    } catch (err) {
      setError(errorText(err, 'common.couldNotSave'));
      setBusy(false);
    }
  }

  const sel =
    'h-10 w-full rounded-[6px] border border-slate-400 bg-white px-2 text-sm disabled:bg-slate-100';
  const unitName = (id: string) => lookups.units.find((u) => u.id === id)?.name ?? '';
  return (
    <Modal
      title={
        item
          ? readOnly
            ? item.name
            : t('items.editTitle', { name: item.name })
          : t('items.addItem')
      }
      onClose={onClose}
      wide
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <fieldset disabled={readOnly || busy} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm sm:col-span-2">
              {t('common.name')}
              <input
                className={inputClass}
                value={f.name}
                onChange={(e) => set('name', e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              {t('items.genericName')}
              <input
                className={inputClass}
                value={f.genericName}
                onChange={(e) => set('genericName', e.target.value)}
              />
            </label>
            <label className="text-sm">
              {t('items.strength')}
              <input
                className={inputClass}
                placeholder="500mg"
                value={f.strength}
                onChange={(e) => set('strength', e.target.value)}
              />
            </label>
            <label className="text-sm">
              {t('items.form')}
              <input
                className={inputClass}
                placeholder={t('items.formPlaceholder')}
                value={f.dosageForm}
                onChange={(e) => set('dosageForm', e.target.value)}
              />
            </label>
            <label className="text-sm">
              {t('items.barcodes')}
              <input
                className={`${inputClass} font-mono`}
                value={f.barcodes}
                onChange={(e) => set('barcodes', e.target.value)}
              />
            </label>
            <label className="text-sm">
              {t('items.category')}
              <span className="flex gap-1">
                <select
                  className={sel}
                  value={f.categoryId}
                  onChange={(e) => set('categoryId', e.target.value)}
                >
                  <option value="">{t('items.none')}</option>
                  {lookups.categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-2"
                  onClick={() => void quickAdd('categories', 'category', 'categoryId')}
                >
                  +
                </Button>
              </span>
            </label>
            <label className="text-sm">
              {t('items.manufacturer')}
              <span className="flex gap-1">
                <select
                  className={sel}
                  value={f.manufacturerId}
                  onChange={(e) => set('manufacturerId', e.target.value)}
                >
                  <option value="">{t('items.none')}</option>
                  {lookups.manufacturers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-2"
                  onClick={() => void quickAdd('manufacturers', 'manufacturer', 'manufacturerId')}
                >
                  +
                </Button>
              </span>
            </label>
            <label className="text-sm">
              {t('items.rack')}
              <span className="flex gap-1">
                <select
                  className={sel}
                  value={f.rackId}
                  onChange={(e) => set('rackId', e.target.value)}
                >
                  <option value="">{t('items.none')}</option>
                  {lookups.racks.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-2"
                  onClick={() => void quickAdd('racks', 'rack', 'rackId')}
                >
                  +
                </Button>
              </span>
            </label>
          </div>

          <div className="rounded-[10px] border border-border p-3">
            <p className="mb-2 text-sm font-medium">{t('items.unitsTitle')}</p>
            <p className="mb-2 text-xs text-muted">
              {t('items.unitsHelp', { unit: unitName(f.baseUnitId) })}
            </p>
            {unitRows.map((u, i) => (
              <div
                key={u.unitId}
                className="mb-1 grid grid-cols-[1fr_6rem_auto_auto] items-center gap-2 text-sm"
              >
                <span>
                  {unitName(u.unitId)}
                  {u.unitId === f.baseUnitId ? ` ${t('items.smallest')}` : ''}
                </span>
                <input
                  aria-label={t('items.unitHolds', { unit: unitName(u.unitId) })}
                  className={inputClass}
                  inputMode="numeric"
                  value={u.factor}
                  disabled={u.unitId === f.baseUnitId || !!item}
                  onChange={(e) =>
                    setUnitRows((r) =>
                      r.map((x, j) => (j === i ? { ...x, factor: e.target.value } : x)),
                    )
                  }
                />
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="saleUnit"
                    checked={u.sale}
                    onChange={() => setUnitRows((r) => r.map((x, j) => ({ ...x, sale: j === i })))}
                  />{' '}
                  {t('items.sell')}
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="buyUnit"
                    checked={u.purchase}
                    onChange={() =>
                      setUnitRows((r) => r.map((x, j) => ({ ...x, purchase: j === i })))
                    }
                  />{' '}
                  {t('items.buy')}
                </label>
              </div>
            ))}
            {!item ? (
              <select
                aria-label={t('items.addUnit')}
                className={`${sel} mt-2 max-w-xs`}
                value=""
                onChange={(e) =>
                  e.target.value &&
                  setUnitRows((r) => [
                    ...r,
                    { unitId: e.target.value, factor: '10', sale: false, purchase: false },
                  ])
                }
              >
                <option value="">{t('items.addPackUnit')}</option>
                {lookups.units
                  .filter((u) => !unitRows.some((x) => x.unitId === u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            ) : (
              <p className="mt-2 text-xs text-muted">{t('items.unitsLocked')}</p>
            )}
          </div>

          {priceLocked ? (
            <p className="rounded-[6px] bg-primary-50 px-3 py-2 text-sm text-primary-900">
              {t('items.priceLocked')}
            </p>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-sm">
              {t('items.sellingPricePer', { unit: unitName(saleRow?.unitId ?? '') })}
              <input
                aria-label={t('items.sellingPrice')}
                className={inputClass}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                readOnly={priceLocked}
                required
              />
            </label>
            <label className="text-sm">
              {t('items.salesTax')}
              <input
                className={inputClass}
                inputMode="decimal"
                value={f.taxPct}
                onChange={(e) => set('taxPct', e.target.value)}
                readOnly={priceLocked}
              />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                checked={f.taxInclusive}
                onChange={(e) => set('taxInclusive', e.target.checked)}
                disabled={priceLocked}
              />{' '}
              {t('items.priceIncludesTax')}
            </label>
            <label className="text-sm">
              {t('items.reorderLevel', { unit: unitName(f.baseUnitId) })}
              <input
                className={inputClass}
                inputMode="numeric"
                value={f.reorder}
                onChange={(e) => set('reorder', e.target.value)}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.isPrescription}
                onChange={(e) => set('isPrescription', e.target.checked)}
              />{' '}
              {t('items.prescription')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.isNarcotic}
                onChange={(e) => set('isNarcotic', e.target.checked)}
              />{' '}
              {t('items.narcotic')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.isColdChain}
                onChange={(e) => set('isColdChain', e.target.checked)}
              />{' '}
              {t('items.coldChain')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.allowNegativeStock}
                onChange={(e) => set('allowNegativeStock', e.target.checked)}
              />{' '}
              {t('items.allowNegative')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={f.isActive}
                onChange={(e) => set('isActive', e.target.checked)}
              />{' '}
              {t('common.active')}
            </label>
          </div>
        </fieldset>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {readOnly ? t('common.close') : t('common.cancel')}
          </Button>
          {!readOnly ? (
            <Button type="submit" disabled={busy || f.name.trim().length < 2}>
              {busy ? t('common.saving') : t('items.saveItem')}
            </Button>
          ) : null}
        </div>
      </form>
      {adding ? (
        <NameDialog
          title={t('items.new.' + adding.label)}
          label={t('common.name')}
          onClose={() => setAdding(null)}
          onSubmit={async (name) => {
            const r = await api<{ id: string }>(`/api/lookups/${adding.kind}`, { body: { name } });
            onReloadLookups();
            set(adding.key, r.id);
            setAdding(null);
          }}
        />
      ) : null}
    </Modal>
  );
}
