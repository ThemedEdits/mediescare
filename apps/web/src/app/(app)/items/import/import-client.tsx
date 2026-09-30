'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api, ApiError, Badge, Button, ErrorText, useErrorText } from '@/components/ui';
import type { Translator } from '@/i18n/core';
import { useT } from '@/i18n/client';
import { ReviewStep } from './review-step';
import type { ImportView } from './types';

const MAX_BYTES = 25 * 1024 * 1024;

/** Multipart upload. api() sends JSON, so the file goes through fetch directly. */
async function upload(file: File, t: Translator): Promise<ImportView> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch('/api/imports/items/preview', { method: 'POST', body: form });
  const data = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string; issues?: { message: string }[] };
  };
  if (!res.ok) {
    if (res.status === 401) window.location.assign('/login');
    if (res.status === 428) window.location.assign('/change-password');
    throw new ApiError(
      data.error?.message ??
        data.error?.issues?.map((i) => i.message).join('. ') ??
        t('itemsImport.uploadFailedStatus', { status: res.status }),
      data.error?.code ?? 'ERROR',
      res.status,
    );
  }
  return data as unknown as ImportView;
}

function UploadStep({ onView }: { onView: (view: ImportView) => void }) {
  const t = useT();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/\.(xlsx|csv)$/i.test(file.name)) return setError(t('itemsImport.errType'));
    if (file.size > MAX_BYTES) return setError(t('itemsImport.errSize'));
    setBusy(true);
    try {
      onView(await upload(file, t));
    } catch (e) {
      setError(errorText(e, 'itemsImport.uploadFailed'));
      setBusy(false);
    }
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void pick(e.dataTransfer.files[0]);
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        className={`flex flex-col items-center gap-3 rounded-[10px] border-2 border-dashed p-10 text-center ${over ? 'border-primary-600 bg-primary-50' : 'border-border'}`}
      >
        <p className="font-medium">{busy ? t('itemsImport.reading') : t('itemsImport.drop')}</p>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          aria-label={t('itemsImport.chooseFile')}
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button onClick={() => input.current?.click()} disabled={busy}>
          {t('itemsImport.chooseFile')}
        </Button>
        <p className="text-xs text-muted">{t('itemsImport.fileHint')}</p>
      </div>
      <ErrorText message={error} />
      <p className="text-sm">
        {t('itemsImport.templateLead')}{' '}
        <a
          className="font-semibold text-primary-600 underline"
          href="/api/imports/items/template"
          download
        >
          {t('itemsImport.templateLink')}
        </a>
        {t('itemsImport.templateTail')}
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[10px] border border-border p-4">
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString('en')}</p>
    </div>
  );
}

/** Step 3: progress while the server imports, then the result. */
function ProgressStep({ view, onRestart }: { view: ImportView; onRestart: () => void }) {
  const t = useT();
  const p = view.progress;
  const pct = p.total === 0 ? 100 : Math.min(100, Math.round((p.done / p.total) * 100));
  const r = view.result;
  return (
    <div className="space-y-4">
      {view.status === 'failed' ? (
        <div role="alert" className="space-y-1 rounded-[10px] border border-danger p-4">
          <p className="font-semibold text-danger">{t('itemsImport.stopped')}</p>
          <p className="text-sm">{view.error}</p>
        </div>
      ) : view.status === 'done' ? (
        <div className="flex items-center gap-2">
          <Badge tone="success">{t('common.done')}</Badge>
          <p className="text-sm">
            {r
              ? t('itemsImport.doneLine', {
                  count: r.created.toLocaleString('en'),
                  seconds: (r.durationMs / 1000).toFixed(1),
                })
              : t('itemsImport.finished')}
          </p>
        </div>
      ) : (
        <p className="text-sm">{t('itemsImport.importing', { fileName: view.fileName })}</p>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-3 w-full overflow-hidden rounded-full bg-slate-100"
      >
        <div className="h-full bg-primary-600 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-sm text-muted tabular-nums">
        {t('itemsImport.progress', {
          done: p.done.toLocaleString('en'),
          total: p.total.toLocaleString('en'),
          pct,
        })}
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t('itemsImport.stat.created')} value={p.created} />
        <Stat label={t('itemsImport.stat.skipped')} value={p.skipped} />
        <Stat label={t('itemsImport.stat.errors')} value={p.errors} />
        <Stat label={t('itemsImport.stat.warnings')} value={p.warnings} />
      </div>
      {r ? (
        <ul className="list-inside list-disc text-sm text-muted">
          <li>
            {t('itemsImport.newRecords', {
              units: r.unitsCreated,
              categories: r.categoriesCreated,
              manufacturers: r.manufacturersCreated,
              racks: r.racksCreated,
            })}
          </li>
          {r.openingBatches > 0 || r.openingSkipped > 0 ? (
            <li>
              {t('itemsImport.openingResult', {
                batches: r.openingBatches.toLocaleString('en'),
                skipped: r.openingSkipped.toLocaleString('en'),
              })}
            </li>
          ) : null}
        </ul>
      ) : null}
      {view.status === 'done' || view.status === 'failed' ? (
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/items"
            className="inline-flex h-10 items-center rounded-[6px] bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"
          >
            {t('itemsImport.viewItems')}
          </Link>
          <a
            className="text-sm font-semibold text-primary-600 underline"
            href={`/api/imports/items/${view.importId}/report`}
            download
          >
            {t('itemsImport.downloadReport')}
          </a>
          <Button variant="outline" onClick={onRestart}>
            {t('itemsImport.importAnother')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ImportClient() {
  const t = useT();
  const errorText = useErrorText();
  const [view, setView] = useState<ImportView | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const active = view?.status === 'queued' || view?.status === 'running';
  const id = view?.importId;

  useEffect(() => {
    if (!active || !id) return;
    const timer = setInterval(() => {
      api<ImportView>(`/api/imports/items/${id}`)
        .then((v) => {
          setView(v);
          setPollError(null);
        })
        .catch((e: unknown) => setPollError(errorText(e, 'itemsImport.lostContact')));
    }, 500);
    return () => clearInterval(timer);
  }, [active, id]);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">{t('itemsImport.title')}</h1>
        <p className="text-sm text-muted">{t('itemsImport.subtitle')}</p>
        <p className="mt-1 text-sm">
          <Link href="/items" className="text-primary-600 underline">
            {t('itemsImport.backToItems')}
          </Link>
        </p>
      </div>
      {view === null ? <UploadStep onView={setView} /> : null}
      {view?.status === 'ready' ? (
        <ReviewStep view={view} onView={setView} onRestart={() => setView(null)} />
      ) : null}
      {view && view.status !== 'ready' ? (
        <ProgressStep view={view} onRestart={() => setView(null)} />
      ) : null}
      <ErrorText message={pollError} />
    </>
  );
}
