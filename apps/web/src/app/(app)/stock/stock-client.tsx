'use client';

import { useState } from 'react';
import { daysUntil } from '@mediescare/core/stock';
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
import { ReceiveForm } from './receive-form';

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
interface BatchRow {
  id: string;
  batchNo: string;
  expiryDate: string;
  available: number;
  costUnitMicro?: number;
  isBlocked: boolean;
}

const REASONS = [
  'count_correction',
  'damaged',
  'expired_writeoff',
  'consumed_internal',
  'sample',
  'lost',
  'found',
  'other',
] as const;

export function StockClient({
  canReceive,
  canAdjust,
  canSeeCost,
  canAddSupplier,
}: {
  canReceive: boolean;
  canAdjust: boolean;
  canSeeCost: boolean;
  canAddSupplier: boolean;
}) {
  const t = useT();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [flt, setFlt] = useState('');
  const list = useAsync(
    () =>
      api<{ rows: StockRow[]; total: number }>(
        `/api/stock?q=${encodeURIComponent(q)}&page=${page}&pageSize=25${flt === 'low' ? '&low=1' : flt === 'in' ? '&inStock=1' : ''}`,
      ),
    [q, page, flt],
  );
  const [receiving, setReceiving] = useState(false);
  const [batchesOf, setBatchesOf] = useState<StockRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('stock.title')}</h1>
          <p className="text-sm text-muted">{t('stock.subtitle')}</p>
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <input
            aria-label={t('stock.searchLabel')}
            className={`${inputClass} w-64`}
            placeholder={t('stock.searchPlaceholder')}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
          <select
            aria-label={t('stock.filterLabel')}
            className={`${inputClass} w-40`}
            value={flt}
            onChange={(e) => {
              setFlt(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('stock.filterAll')}</option>
            <option value="in">{t('stock.filterIn')}</option>
            <option value="low">{t('stock.filterLow')}</option>
          </select>
          {canReceive ? (
            <Button onClick={() => setReceiving(true)}>{t('stock.addStock')}</Button>
          ) : null}
        </div>
      </div>
      {notice ? (
        <p role="status" className="rounded-[6px] bg-primary-50 px-4 py-2 text-sm text-primary-900">
          {notice}
        </p>
      ) : null}
      <ErrorText message={list.error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">{t('common.item')}</th>
              <th className="px-4 py-3 text-end">{t('stock.onHand')}</th>
              <th className="px-4 py-3 text-end">{t('stock.sellable')}</th>
              <th className="px-4 py-3 text-end">{t('stock.expired')}</th>
              <th className="px-4 py-3 text-end">{t('stock.reorderAt')}</th>
              <th className="px-4 py-3">{t('stock.earliestExpiry')}</th>
              {canSeeCost ? <th className="px-4 py-3 text-end">{t('stock.value')}</th> : null}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.itemId} className="border-t border-border">
                <td className="px-4 py-3">
                  <span className="font-medium">{r.name}</span>{' '}
                  {r.low ? <Badge tone="warning">{t('stock.low')}</Badge> : null}
                  <span className="block text-xs text-muted">{r.genericName ?? ''}</span>
                </td>
                <td className="px-4 py-3 text-end tabular-nums">{r.onHandBase}</td>
                <td className="px-4 py-3 text-end font-semibold tabular-nums">{r.sellableBase}</td>
                <td className="px-4 py-3 text-end tabular-nums">
                  {r.expiredBase > 0 ? <Badge tone="danger">{r.expiredBase}</Badge> : 0}
                </td>
                <td className="px-4 py-3 text-end tabular-nums">{r.reorderLevelBase}</td>
                <td className="px-4 py-3">
                  {r.nearestExpiry ? <bdi>{r.nearestExpiry}</bdi> : '–'}
                </td>
                {canSeeCost ? (
                  <td className="px-4 py-3 text-end tabular-nums">{pkr(r.costValueMinor ?? 0)}</td>
                ) : null}
                <td className="px-4 py-3 text-end">
                  <Button variant="ghost" className="h-8 px-2" onClick={() => setBatchesOf(r)}>
                    {t('stock.batches')}
                  </Button>
                </td>
              </tr>
            ))}
            {list.data && list.data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-muted">
                  {t('stock.empty')}
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
        <span>{t('stock.itemsCount', { count: list.data?.total ?? 0 })}</span>
        <span className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 px-3"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('common.previous')}
          </Button>
          {t('stock.page', { page, pages })}
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
      {receiving ? (
        <ReceiveForm
          canAddSupplier={canAddSupplier}
          onClose={() => setReceiving(false)}
          onSaved={(docNo) => {
            setReceiving(false);
            setNotice(t('stock.received', { docNo }));
            list.reload();
          }}
        />
      ) : null}
      {batchesOf ? (
        <BatchesDialog
          item={batchesOf}
          canAdjust={canAdjust}
          canSeeCost={canSeeCost}
          onClose={() => {
            setBatchesOf(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function BatchesDialog({
  item,
  canAdjust,
  canSeeCost,
  onClose,
}: {
  item: StockRow;
  canAdjust: boolean;
  canSeeCost: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const batches = useAsync(() =>
    api<{ batches: BatchRow[] }>(`/api/stock/batches?itemId=${item.itemId}&all=1`),
  );
  const [adj, setAdj] = useState<BatchRow | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <Modal title={t('stock.batchesTitle', { name: item.name })} onClose={onClose} wide>
      <ErrorText message={batches.error} />
      <table className="w-full text-sm">
        <thead className="text-start text-xs uppercase text-muted">
          <tr>
            <th className="py-2">{t('stock.batch')}</th>
            <th>{t('stock.expiry')}</th>
            <th className="text-end">{t('stock.onHand')}</th>
            {canSeeCost ? <th className="text-end">{t('stock.costPerUnit')}</th> : null}
            <th />
          </tr>
        </thead>
        <tbody>
          {batches.data?.batches.map((b) => {
            const left = daysUntil(b.expiryDate, today);
            return (
              <tr key={b.id} className="border-t border-border">
                <td className="py-2 font-mono text-xs">
                  <bdi>{b.batchNo}</bdi>{' '}
                  {b.isBlocked ? <Badge tone="danger">{t('stock.blocked')}</Badge> : null}
                </td>
                <td>
                  <bdi>{b.expiryDate}</bdi>{' '}
                  {left < 0 ? (
                    <Badge tone="danger">{t('stock.expired')}</Badge>
                  ) : left <= 90 ? (
                    <Badge tone="warning">{t('stock.daysLeft', { days: left })}</Badge>
                  ) : null}
                </td>
                <td className="text-end tabular-nums">{b.available}</td>
                {canSeeCost ? (
                  <td className="text-end tabular-nums">{rate(b.costUnitMicro ?? 0)}</td>
                ) : null}
                <td className="text-end">
                  {canAdjust ? (
                    <Button variant="ghost" className="h-8 px-2" onClick={() => setAdj(b)}>
                      {t('stock.adjust')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {batches.data && batches.data.batches.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-6 text-center text-muted">
                {t('stock.noBatches')}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
      {adj ? (
        <AdjustDialog
          batch={adj}
          onClose={() => setAdj(null)}
          onDone={() => {
            setAdj(null);
            batches.reload();
          }}
        />
      ) : null}
    </Modal>
  );
}

function AdjustDialog({
  batch,
  onClose,
  onDone,
}: {
  batch: BatchRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('count_correction');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const n = Number(delta);
  const [helpBefore, helpAfter] = t('stock.adjustDialog.help', { qty: '' }).split('');
  return (
    <Modal title={t('stock.adjustDialog.title', { batchNo: batch.batchNo })} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api('/api/stock/adjust', {
              body: { batchId: batch.id, qtyDeltaBase: n, reason, note: note.trim() || undefined },
            });
            onDone();
          } catch (err) {
            setError(errorText(err, 'stock.adjustDialog.failed'));
          }
        }}
      >
        <p className="text-sm text-muted">
          {helpBefore}
          <strong dir="ltr">{batch.available}</strong>
          {helpAfter}
        </p>
        <label className="block text-sm">
          {t('stock.adjustDialog.change')}
          <input
            className={inputClass}
            inputMode="numeric"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="-5"
            dir="ltr"
            required
          />
        </label>
        <label className="block text-sm">
          {t('common.reason')}
          <select className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)}>
            {REASONS.map((v) => (
              <option key={v} value={v}>
                {t(`stock.reason.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {reason === 'other'
            ? t('stock.adjustDialog.noteRequired')
            : t('stock.adjustDialog.noteOptional')}
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!Number.isInteger(n) || n === 0}>
            {t('stock.adjustDialog.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
