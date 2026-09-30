'use client';

import { useState } from 'react';
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
import { pkr } from '@/lib/format';
import { CountSheet } from './count-sheet';

export interface TakeSummary {
  id: string;
  docNo: string;
  title: string;
  status: 'open' | 'posted' | 'cancelled';
  note: string | null;
  createdAt: string;
  postedAt: string | null;
  cancelReason: string | null;
  totalLines: number;
  countedLines: number;
  varianceLines: number;
  shortageCostValueMinor?: number;
  surplusCostValueMinor?: number;
}

/** Translated status, falling back to the raw value. */
export function statusText(t: ReturnType<typeof useT>, status: string): string {
  return t.has(`stockTake.status.${status}`) ? t(`stockTake.status.${status}`) : status;
}

const TONE = { open: 'warning', posted: 'success', cancelled: 'neutral' } as const;

/** Physical counts: list of counts, start a new one, open one to enter counts or post the differences. */
export function StockTakeClient({ canCount, canPost }: { canCount: boolean; canPost: boolean }) {
  const t = useT();
  const { data, error, reload } = useAsync(() => api<{ takes: TakeSummary[] }>('/api/stock-takes'));
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const hasOpen = data?.takes.some((x) => x.status === 'open') ?? false;

  if (openId)
    return (
      <CountSheet
        takeId={openId}
        canCount={canCount}
        canPost={canPost}
        onBack={() => {
          setOpenId(null);
          reload();
        }}
      />
    );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('stockTake.title')}</h1>
        {canCount ? (
          <Button
            onClick={() => setStarting(true)}
            disabled={hasOpen}
            title={hasOpen ? t('stockTake.finishFirst') : undefined}
          >
            {t('stockTake.startCount')}
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted">{t('stockTake.intro')}</p>
      <ErrorText message={error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">{t('stockTake.colCount')}</th>
              <th>{t('common.name')}</th>
              <th>{t('stockTake.started')}</th>
              <th className="text-end">{t('stockTake.counted')}</th>
              <th className="text-end">{t('stockTake.differences')}</th>
              <th className="px-3 text-end">{t('stockTake.shortageValue')}</th>
              <th className="px-3">{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.takes.map((tk) => (
              <tr
                key={tk.id}
                className="cursor-pointer border-t border-border hover:bg-primary-50"
                onClick={() => setOpenId(tk.id)}
              >
                <td className="px-3 py-2 font-mono text-xs">
                  <bdi>{tk.docNo}</bdi>
                </td>
                <td className="font-medium">{tk.title}</td>
                <td>
                  <bdi>{tk.createdAt.slice(0, 10)}</bdi>
                </td>
                <td className="text-end tabular-nums">
                  <bdi>
                    {tk.countedLines} / {tk.totalLines}
                  </bdi>
                </td>
                <td className="text-end tabular-nums">{tk.varianceLines}</td>
                <td className="px-3 text-end tabular-nums">
                  {tk.shortageCostValueMinor === undefined ? '–' : pkr(tk.shortageCostValueMinor)}
                </td>
                <td className="px-3">
                  <Badge tone={TONE[tk.status]}>{statusText(t, tk.status)}</Badge>
                </td>
              </tr>
            ))}
            {data && data.takes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  {t('stockTake.noCounts')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {starting ? (
        <StartDialog
          onClose={() => setStarting(false)}
          onStarted={(id) => {
            setStarting(false);
            setOpenId(id);
          }}
        />
      ) : null}
    </div>
  );
}

interface Named {
  id: string;
  name: string;
}

function StartDialog({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (id: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const lookups = useAsync(() => api<{ categories: Named[]; racks: Named[] }>('/api/lookups'));
  const [title, setTitle] = useState('');
  const [by, setBy] = useState<'all' | 'category' | 'rack'>('all');
  const [refId, setRefId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options =
    by === 'category' ? lookups.data?.categories : by === 'rack' ? lookups.data?.racks : [];

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>('/api/stock-takes', {
        body: {
          title,
          scope:
            by === 'category'
              ? { categoryId: refId }
              : by === 'rack'
                ? { rackId: refId }
                : undefined,
        },
      });
      onStarted(r.id);
    } catch (e) {
      setError(errorText(e, 'stockTake.start.failed'));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('stockTake.start.title')} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          {t('common.name')}
          <input
            aria-label={t('stockTake.start.countName')}
            autoFocus
            className={inputClass}
            placeholder={t('stockTake.start.namePlaceholder')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('stockTake.start.whatToCount')}
          <select
            aria-label={t('stockTake.start.scope')}
            className={inputClass}
            value={by}
            onChange={(e) => {
              setBy(e.target.value as typeof by);
              setRefId('');
            }}
          >
            <option value="all">{t('stockTake.start.scopeAll')}</option>
            <option value="category">{t('stockTake.start.scopeCategory')}</option>
            <option value="rack">{t('stockTake.start.scopeRack')}</option>
          </select>
        </label>
        {by !== 'all' ? (
          <select
            aria-label={t('stockTake.start.chooseLabel')}
            className={inputClass}
            value={refId}
            onChange={(e) => setRefId(e.target.value)}
          >
            <option value="">{t('stockTake.start.chooseOption')}</option>
            {options?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        ) : null}
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void start()}
            disabled={busy || title.trim().length < 2 || (by !== 'all' && !refId)}
          >
            {busy ? t('stockTake.start.starting') : t('stockTake.start.submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
