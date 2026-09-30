'use client';

import { useState } from 'react';
import { api, Badge, Button, ErrorText, inputClass, Modal, useAsync } from '@/components/ui';
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

const TONE = { open: 'warning', posted: 'success', cancelled: 'neutral' } as const;

/** Physical counts: list of counts, start a new one, open one to enter counts or post the differences. */
export function StockTakeClient({ canCount, canPost }: { canCount: boolean; canPost: boolean }) {
  const { data, error, reload } = useAsync(() => api<{ takes: TakeSummary[] }>('/api/stock-takes'));
  const [starting, setStarting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const hasOpen = data?.takes.some((t) => t.status === 'open') ?? false;

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
        <h1 className="text-2xl font-semibold">Stock take</h1>
        {canCount ? (
          <Button
            onClick={() => setStarting(true)}
            disabled={hasOpen}
            title={hasOpen ? 'Finish or cancel the open count first' : undefined}
          >
            Start a count
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted">
        Starting a count freezes what the system says. Enter what you find on the shelf, then post:
        only the differences are written to the stock ledger, and sales made while counting are
        kept.
      </p>
      <ErrorText message={error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Count</th>
              <th>Name</th>
              <th>Started</th>
              <th className="text-end">Counted</th>
              <th className="text-end">Differences</th>
              <th className="px-3 text-end">Shortage value</th>
              <th className="px-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.takes.map((t) => (
              <tr
                key={t.id}
                className="cursor-pointer border-t border-border hover:bg-primary-50"
                onClick={() => setOpenId(t.id)}
              >
                <td className="px-3 py-2 font-mono text-xs">{t.docNo}</td>
                <td className="font-medium">{t.title}</td>
                <td>{t.createdAt.slice(0, 10)}</td>
                <td className="text-end tabular-nums">
                  {t.countedLines} / {t.totalLines}
                </td>
                <td className="text-end tabular-nums">{t.varianceLines}</td>
                <td className="px-3 text-end tabular-nums">
                  {t.shortageCostValueMinor === undefined ? '–' : pkr(t.shortageCostValueMinor)}
                </td>
                <td className="px-3">
                  <Badge tone={TONE[t.status]}>{t.status}</Badge>
                </td>
              </tr>
            ))}
            {data && data.takes.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-10 text-center text-muted">
                  No counts yet.
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
      setError(e instanceof Error ? e.message : 'Could not start the count');
      setBusy(false);
    }
  }

  return (
    <Modal title="Start a stock count" onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          Name
          <input
            aria-label="Count name"
            autoFocus
            className={inputClass}
            placeholder="Full count, Rack A…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          What to count
          <select
            aria-label="Scope"
            className={inputClass}
            value={by}
            onChange={(e) => {
              setBy(e.target.value as typeof by);
              setRefId('');
            }}
          >
            <option value="all">Everything in stock</option>
            <option value="category">One category</option>
            <option value="rack">One rack</option>
          </select>
        </label>
        {by !== 'all' ? (
          <select
            aria-label="Choose"
            className={inputClass}
            value={refId}
            onChange={(e) => setRefId(e.target.value)}
          >
            <option value="">Choose…</option>
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
            Cancel
          </Button>
          <Button
            onClick={() => void start()}
            disabled={busy || title.trim().length < 2 || (by !== 'all' && !refId)}
          >
            {busy ? 'Starting…' : 'Start count'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
