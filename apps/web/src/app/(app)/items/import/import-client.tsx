'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { api, ApiError, Badge, Button, ErrorText } from '@/components/ui';
import { ReviewStep } from './review-step';
import type { ImportView } from './types';

const MAX_BYTES = 25 * 1024 * 1024;

/** Multipart upload. api() sends JSON, so the file goes through fetch directly. */
async function upload(file: File): Promise<ImportView> {
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
        `Upload failed (${res.status})`,
      data.error?.code ?? 'ERROR',
      res.status,
    );
  }
  return data as unknown as ImportView;
}

function UploadStep({ onView }: { onView: (view: ImportView) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!/\.(xlsx|csv)$/i.test(file.name))
      return setError('Only .xlsx and .csv files can be imported.');
    if (file.size > MAX_BYTES) return setError('The file is larger than 25 MB.');
    setBusy(true);
    try {
      onView(await upload(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
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
        <p className="font-medium">
          {busy ? 'Reading and checking the file...' : 'Drop an Excel or CSV file here'}
        </p>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.csv"
          className="hidden"
          aria-label="Choose file"
          onChange={(e) => {
            void pick(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button onClick={() => input.current?.click()} disabled={busy}>
          Choose file
        </Button>
        <p className="text-xs text-muted">
          .xlsx or .csv, up to 25 MB and 200,000 rows. The first row must hold the column names.
        </p>
      </div>
      <ErrorText message={error} />
      <p className="text-sm">
        Not sure how to lay out the file?{' '}
        <a
          className="font-semibold text-primary-600 underline"
          href="/api/imports/items/template"
          download
        >
          Download the template
        </a>
        . Files exported from your old system work too: the columns are matched by name.
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
  const p = view.progress;
  const pct = p.total === 0 ? 100 : Math.min(100, Math.round((p.done / p.total) * 100));
  const r = view.result;
  return (
    <div className="space-y-4">
      {view.status === 'failed' ? (
        <div role="alert" className="space-y-1 rounded-[10px] border border-danger p-4">
          <p className="font-semibold text-danger">The import stopped</p>
          <p className="text-sm">{view.error}</p>
        </div>
      ) : view.status === 'done' ? (
        <div className="flex items-center gap-2">
          <Badge tone="success">Done</Badge>
          <p className="text-sm">
            {r
              ? `${r.created.toLocaleString('en')} items imported in ${(r.durationMs / 1000).toFixed(1)} s.`
              : 'Import finished.'}
          </p>
        </div>
      ) : (
        <p className="text-sm">
          Importing {view.fileName}. You can keep working; do not close the app until it finishes.
        </p>
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
        {p.done.toLocaleString('en')} of {p.total.toLocaleString('en')} rows ({pct}%)
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Created" value={p.created} />
        <Stat label="Skipped" value={p.skipped} />
        <Stat label="Skipped (errors)" value={p.errors} />
        <Stat label="With warnings" value={p.warnings} />
      </div>
      {r ? (
        <ul className="list-inside list-disc text-sm text-muted">
          <li>
            New records: {r.unitsCreated} units, {r.categoriesCreated} categories,{' '}
            {r.manufacturersCreated} manufacturers, {r.racksCreated} racks.
          </li>
          {r.openingBatches > 0 || r.openingSkipped > 0 ? (
            <li>
              Opening stock: {r.openingBatches.toLocaleString('en')} batches added,{' '}
              {r.openingSkipped.toLocaleString('en')} rows left without stock (no cost or already
              expired).
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
            View items
          </Link>
          <a
            className="text-sm font-semibold text-primary-600 underline"
            href={`/api/imports/items/${view.importId}/report`}
            download
          >
            Download issue report
          </a>
          <Button variant="outline" onClick={onRestart}>
            Import another file
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function ImportClient() {
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
        .catch((e: unknown) =>
          setPollError(e instanceof Error ? e.message : 'Lost contact with the server'),
        );
    }, 500);
    return () => clearInterval(timer);
  }, [active, id]);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Import items from Excel</h1>
        <p className="text-sm text-muted">
          Upload a file, check the columns, review the problems, then import.
        </p>
        <p className="mt-1 text-sm">
          <Link href="/items" className="text-primary-600 underline">
            Back to items
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
