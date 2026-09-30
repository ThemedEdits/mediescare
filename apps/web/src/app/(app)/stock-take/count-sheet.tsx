'use client';

import { useState } from 'react';
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
import { pkr } from '@/lib/format';
import { statusText, type TakeSummary } from './stock-take-client';

interface Line {
  lineId: string;
  itemName: string;
  sku: string;
  batchNo: string;
  expiryDate: string;
  packName: string;
  packSize: number;
  baseUnitName: string;
  systemQtyBase: number;
  countedQtyBase: number | null;
  differenceBase: number | null;
  costValueMinor?: number | null;
}
interface PostResult {
  adjusted: number;
  unchanged: number;
  ignoredUncounted: number;
  clamped: number;
  gainMinor: number;
  lossMinor: number;
}

const PAGE = 50;

/** "12 strip + 3 tablet", or just the smallest unit when there is no pack. */
export function packsText(qty: number, size: number, pack: string, base: string): string {
  if (size <= 1) return `${qty} ${base}`;
  const packs = Math.trunc(qty / size);
  const loose = qty % size;
  return [packs > 0 ? `${packs} ${pack}` : '', loose > 0 || packs === 0 ? `${loose} ${base}` : '']
    .filter(Boolean)
    .join(' + ');
}

function CountCell({
  line,
  disabled,
  onSave,
}: {
  line: Line;
  disabled: boolean;
  onSave: (qty: number | null) => Promise<void>;
}) {
  const c = line.countedQtyBase;
  const [packs, setPacks] = useState(c === null ? '' : String(Math.trunc(c / line.packSize)));
  const [loose, setLoose] = useState(c === null ? '' : String(c % line.packSize));
  const hasPack = line.packSize > 1;

  async function commit() {
    if (packs.trim() === '' && loose.trim() === '') {
      if (c !== null) await onSave(null);
      return;
    }
    const p = Number(packs || 0);
    const l = Number(loose || 0);
    if (!Number.isInteger(p) || !Number.isInteger(l) || p < 0 || l < 0) return;
    const total = p * line.packSize + l;
    if (total !== c) await onSave(total);
  }

  const cell =
    'h-9 w-20 rounded-[6px] border border-slate-400 bg-white px-2 text-end text-sm disabled:bg-slate-100';
  return (
    <span className="flex items-center gap-1">
      {hasPack ? (
        <>
          <input
            aria-label={`${line.itemName} ${line.packName}`}
            className={cell}
            inputMode="numeric"
            disabled={disabled}
            value={packs}
            onChange={(e) => setPacks(e.target.value)}
            onBlur={() => void commit()}
          />
          <span className="text-xs text-muted">{line.packName}</span>
        </>
      ) : null}
      <input
        aria-label={`${line.itemName} ${line.baseUnitName}`}
        className={cell}
        inputMode="numeric"
        disabled={disabled}
        value={loose}
        onChange={(e) => setLoose(e.target.value)}
        onBlur={() => void commit()}
      />
      <span className="text-xs text-muted">{line.baseUnitName}</span>
    </span>
  );
}

export function CountSheet({
  takeId,
  canCount,
  canPost,
  onBack,
}: {
  takeId: string;
  canCount: boolean;
  canPost: boolean;
  onBack: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [filter, setFilter] = useState<'all' | 'uncounted' | 'variance'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [result, setResult] = useState<PostResult | null>(null);

  const summary = useAsync(
    () => api<{ take: TakeSummary }>(`/api/stock-takes/${takeId}`),
    [takeId, tick],
  );
  const lines = useAsync(
    () =>
      api<{ rows: Line[]; total: number }>(
        `/api/stock-takes/${takeId}/lines?filter=${filter}&page=${page}&pageSize=${PAGE}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      ),
    [takeId, filter, q, page, tick],
  );
  const take = summary.data?.take;
  const open = take?.status === 'open';
  const pages = Math.max(1, Math.ceil((lines.data?.total ?? 0) / PAGE));

  async function save(lineId: string, countedQtyBase: number | null) {
    setError(null);
    try {
      await api(`/api/stock-takes/${takeId}/counts`, {
        body: { counts: [{ lineId, countedQtyBase }] },
      });
      setTick((n) => n + 1);
    } catch (e) {
      setError(errorText(e, 'stockTake.sheet.saveFailed'));
    }
  }

  const [summaryBefore, summaryAfter] = result
    ? t('stockTake.result.summary', {
        adjusted: '\u0001',
        unchanged: result.unchanged,
        ignored: result.ignoredUncounted,
      }).split('\u0001')
    : ['', ''];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <button className="text-sm text-primary-600 hover:underline" onClick={onBack}>
            <span className="inline-block rtl:rotate-180">←</span> {t('stockTake.sheet.allCounts')}
          </button>
          <h1 className="text-2xl font-semibold">
            {take ? (
              <>
                <bdi>{take.docNo}</bdi> · {take.title}
              </>
            ) : (
              t('stockTake.sheet.heading')
            )}{' '}
            {take ? (
              <Badge tone={open ? 'warning' : take.status === 'posted' ? 'success' : 'neutral'}>
                {statusText(t, take.status)}
              </Badge>
            ) : null}
          </h1>
        </div>
        {open ? (
          <div className="flex gap-2">
            {canCount ? (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                {t('stockTake.sheet.cancelCount')}
              </Button>
            ) : null}
            {canPost ? (
              <Button onClick={() => setPosting(true)}>
                {t('stockTake.sheet.postDifferences')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {take ? (
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <Stat
            label={t('stockTake.counted')}
            value={`${take.countedLines} / ${take.totalLines}`}
          />
          <Stat label={t('stockTake.sheet.withDifferences')} value={String(take.varianceLines)} />
          <Stat
            label={t('stockTake.sheet.shortageAtCost')}
            value={
              take.shortageCostValueMinor === undefined ? '–' : pkr(take.shortageCostValueMinor)
            }
          />
          <Stat
            label={t('stockTake.sheet.surplusAtCost')}
            value={take.surplusCostValueMinor === undefined ? '–' : pkr(take.surplusCostValueMinor)}
          />
        </div>
      ) : null}
      {take?.status === 'cancelled' ? (
        <p className="text-sm text-danger">
          {t('stockTake.sheet.cancelled', { reason: take.cancelReason ?? '' })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          aria-label={t('stockTake.sheet.searchLines')}
          className={`${inputClass} max-w-xs`}
          placeholder={t('stockTake.sheet.searchPlaceholder')}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        {(['all', 'uncounted', 'variance'] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? 'primary' : 'outline'}
            className="h-9"
            onClick={() => {
              setFilter(f);
              setPage(1);
            }}
          >
            {f === 'all'
              ? t('common.all')
              : f === 'uncounted'
                ? t('stockTake.sheet.notCounted')
                : t('stockTake.differences')}
          </Button>
        ))}
      </div>
      <ErrorText message={error ?? lines.error} />

      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">{t('common.item')}</th>
              <th>{t('stockTake.sheet.batch')}</th>
              <th>{t('stockTake.sheet.expiry')}</th>
              <th className="text-end">{t('stockTake.sheet.system')}</th>
              <th className="px-3">{t('stockTake.counted')}</th>
              <th className="text-end">{t('stockTake.sheet.difference')}</th>
              <th className="px-3 text-end">{t('stockTake.sheet.value')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.data?.rows.map((l) => (
              <tr key={`${l.lineId}:${l.countedQtyBase}`} className="border-t border-border">
                <td className="px-3 py-1">
                  <span className="font-medium">{l.itemName}</span>{' '}
                  <span dir="ltr" className="font-mono text-xs text-muted">
                    {l.sku}
                  </span>
                </td>
                <td className="font-mono text-xs">
                  <bdi>{l.batchNo}</bdi>
                </td>
                <td>
                  <bdi>{l.expiryDate}</bdi>
                </td>
                <td className="text-end tabular-nums">
                  <bdi>{packsText(l.systemQtyBase, l.packSize, l.packName, l.baseUnitName)}</bdi>
                </td>
                <td className="px-3">
                  <CountCell
                    line={l}
                    disabled={!open || !canCount}
                    onSave={(qty) => save(l.lineId, qty)}
                  />
                </td>
                <td
                  className={`text-end tabular-nums ${l.differenceBase && l.differenceBase < 0 ? 'text-danger' : ''}`}
                >
                  <bdi>
                    {l.differenceBase === null
                      ? ''
                      : l.differenceBase > 0
                        ? `+${l.differenceBase}`
                        : l.differenceBase}
                  </bdi>
                </td>
                <td className="px-3 text-end tabular-nums">
                  {l.costValueMinor === undefined ||
                  l.costValueMinor === null ||
                  l.costValueMinor === 0
                    ? ''
                    : pkr(l.costValueMinor)}
                </td>
              </tr>
            ))}
            {lines.data && lines.data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  {t('stockTake.sheet.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2 text-sm">
        <span className="text-muted">
          {t('stockTake.sheet.pageInfo', { page, pages, total: lines.data?.total ?? 0 })}
        </span>
        <Button
          variant="outline"
          className="h-8"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          {t('common.previous')}
        </Button>
        <Button
          variant="outline"
          className="h-8"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          {t('common.next')}
        </Button>
      </div>

      {posting && take ? (
        <PostDialog
          take={take}
          onClose={() => setPosting(false)}
          onPosted={(r) => {
            setPosting(false);
            setResult(r);
            setTick((n) => n + 1);
          }}
          takeId={takeId}
        />
      ) : null}
      {cancelling ? (
        <NameDialog
          title={t('stockTake.sheet.cancelTitle')}
          label={t('common.reason')}
          submitLabel={t('stockTake.sheet.cancelCount')}
          onClose={() => setCancelling(false)}
          onSubmit={async (reason) => {
            await api(`/api/stock-takes/${takeId}/cancel`, { body: { reason } });
            setCancelling(false);
            setTick((n) => n + 1);
          }}
        />
      ) : null}
      {result ? (
        <Modal title={t('stockTake.result.title')} onClose={() => setResult(null)}>
          <div className="space-y-2 text-sm">
            <p>
              {summaryBefore}
              <strong>{result.adjusted}</strong>
              {summaryAfter}
            </p>
            {result.clamped > 0 ? (
              <p className="text-warning">
                {t('stockTake.result.clamped', { count: result.clamped })}
              </p>
            ) : null}
            <Button className="w-full" onClick={() => setResult(null)}>
              {t('common.done')}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PostDialog({
  take,
  takeId,
  onClose,
  onPosted,
}: {
  take: TakeSummary;
  takeId: string;
  onClose: () => void;
  onPosted: (r: PostResult) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [uncounted, setUncounted] = useState<'ignore' | 'zero'>('ignore');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = take.totalLines - take.countedLines;

  async function post() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ result: PostResult }>(`/api/stock-takes/${takeId}/post`, {
        body: { uncounted },
      });
      onPosted(r.result);
    } catch (e) {
      setError(errorText(e, 'stockTake.post.failed'));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('stockTake.post.title')} onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p>{t('stockTake.post.body', { count: take.varianceLines })}</p>
        {left > 0 ? (
          <fieldset className="space-y-1 rounded-[6px] border border-border p-3">
            <legend className="px-1 text-xs text-muted">
              {t('stockTake.post.notCounted', { count: left })}
            </legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={uncounted === 'ignore'}
                onChange={() => setUncounted('ignore')}
              />{' '}
              {t('stockTake.post.leave')}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={uncounted === 'zero'}
                onChange={() => setUncounted('zero')}
              />{' '}
              {t('stockTake.post.zero')}
            </label>
          </fieldset>
        ) : null}
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('stockTake.post.keepCounting')}
          </Button>
          <Button onClick={() => void post()} disabled={busy}>
            {busy ? t('stockTake.post.posting') : t('stockTake.sheet.postDifferences')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
