'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, Button, ErrorText, inputClass } from '@/components/ui';
import {
  PRESETS,
  localDate,
  presetRange,
  reportQuery,
  type Preset,
  type ReportFilterState,
} from './report-format';
import { KpiCards, ReportTable, type ReportData } from './report-table';

interface ReportInfo {
  id: string;
  title: string;
  group: string;
  filters: string[];
  canExport: boolean;
}

const GROUPS: [string, string][] = [
  ['sales', 'Sales'],
  ['stock', 'Stock'],
  ['expiry', 'Expiry'],
  ['profit', 'Profitability'],
  ['compliance', 'Compliance'],
];

const BUCKETS: [string, string][] = [
  ['', 'All up to 180 days'],
  ['expired', 'Expired'],
  ['0-30', '0-30 days'],
  ['31-60', '31-60 days'],
  ['61-90', '61-90 days'],
  ['91-180', '91-180 days'],
];

/** Save the open report as PDF through the desktop app, or the browser print dialog elsewhere. */
async function printReport(fileName: string): Promise<string | null> {
  const style = document.createElement('style');
  style.textContent = '@page { size: A4 landscape; margin: 10mm; }';
  document.head.appendChild(style);
  try {
    const save = window.mediescare?.printToPdf;
    if (!save) {
      window.print();
      return null;
    }
    const result = await save(fileName);
    if (!result.ok && result.error !== 'Cancelled')
      throw new Error(result.error ?? 'Could not save the PDF');
    return result.ok ? (result.path ?? null) : null;
  } finally {
    style.remove();
  }
}

export function ReportsClient({ branchName }: { branchName: string }) {
  const [reports, setReports] = useState<ReportInfo[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState('sales-daily');
  const [preset, setPreset] = useState<Preset>('today');
  const [filters, setFilters] = useState<ReportFilterState>(() => ({
    ...presetRange('today', new Date()),
    q: '',
    bucket: '',
    limit: '',
  }));
  const [appliedQ, setAppliedQ] = useState('');
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ reports: ReportInfo[] }>('/api/reports')
      .then((r) => {
        setReports(r.reports);
        setSelected((cur) =>
          r.reports.some((x) => x.id === cur) ? cur : (r.reports[0]?.id ?? cur),
        );
      })
      .catch((e: unknown) =>
        setListError(e instanceof Error ? e.message : 'Could not load reports'),
      );
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setAppliedQ(filters.q), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  const info = reports.find((r) => r.id === selected);
  const uses = info?.filters ?? [];
  const query = useMemo(
    () => reportQuery({ ...filters, q: appliedQ }, uses),
    [filters.from, filters.to, filters.bucket, filters.limit, appliedQ, uses.join(',')],
  );

  useEffect(() => {
    if (!info) return;
    let alive = true;
    setLoading(true);
    api<ReportData>(`/api/reports/${encodeURIComponent(info.id)}?${query}`)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
        setGeneratedAt(`${localDate(new Date())} ${new Date().toTimeString().slice(0, 5)}`);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setData(null);
        setError(e instanceof Error ? e.message : 'Could not run the report');
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [info?.id, query]);

  const choosePreset = (p: Preset) => {
    setPreset(p);
    if (p !== 'custom') setFilters((f) => ({ ...f, ...presetRange(p, new Date()) }));
  };
  const set = (patch: Partial<ReportFilterState>) => setFilters((f) => ({ ...f, ...patch }));

  const fileBase = info
    ? `mediescare-${info.id}-${filters.from}-${filters.to}`
    : 'mediescare-report';
  const filterText = [
    uses.includes('range') ? `${filters.from} to ${filters.to}` : null,
    uses.includes('q') && appliedQ.trim() ? `Search: ${appliedQ.trim()}` : null,
    uses.includes('bucket') && filters.bucket
      ? `Bucket: ${BUCKETS.find(([v]) => v === filters.bucket)?.[1] ?? filters.bucket}`
      : null,
  ]
    .filter(Boolean)
    .join(' | ');

  return (
    <div className="grid gap-6 md:grid-cols-[14rem_1fr]">
      <aside aria-label="Reports" className="no-print space-y-4">
        <h1 className="text-2xl font-semibold">Reports</h1>
        <ErrorText message={listError} />
        {GROUPS.map(([group, label]) => {
          const inGroup = reports.filter((r) => r.group === group);
          return inGroup.length === 0 ? null : (
            <div key={group}>
              <p className="mb-1 text-xs font-semibold uppercase text-muted">{label}</p>
              <ul className="space-y-0.5">
                {inGroup.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(r.id);
                        setNotice(null);
                      }}
                      aria-current={r.id === selected ? 'page' : undefined}
                      className={`w-full rounded-[6px] px-3 py-2 text-start text-sm ${
                        r.id === selected
                          ? 'bg-primary-50 font-semibold text-primary-700'
                          : 'text-slate-700 hover:bg-surface-2'
                      }`}
                    >
                      {r.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </aside>

      <section className="min-w-0 space-y-4">
        <div className="no-print space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            {uses.includes('range') ? (
              <>
                <div className="flex flex-wrap gap-1" role="group" aria-label="Date range">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={preset === p.id}
                      onClick={() => choosePreset(p.id)}
                      className={`h-10 rounded-[6px] border px-3 text-sm ${
                        preset === p.id
                          ? 'border-primary-600 bg-primary-50 font-semibold text-primary-700'
                          : 'border-border hover:bg-surface-2'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {preset === 'custom' ? (
                  <>
                    <label className="text-xs text-muted">
                      From
                      <input
                        type="date"
                        className={`${inputClass} w-40`}
                        value={filters.from}
                        max={filters.to}
                        onChange={(e) => e.target.value && set({ from: e.target.value })}
                      />
                    </label>
                    <label className="text-xs text-muted">
                      To
                      <input
                        type="date"
                        className={`${inputClass} w-40`}
                        value={filters.to}
                        min={filters.from}
                        onChange={(e) => e.target.value && set({ to: e.target.value })}
                      />
                    </label>
                  </>
                ) : null}
              </>
            ) : null}
            {uses.includes('q') ? (
              <input
                aria-label="Search"
                className={`${inputClass} w-56`}
                placeholder="Search…"
                value={filters.q}
                onChange={(e) => set({ q: e.target.value })}
              />
            ) : null}
            {uses.includes('bucket') ? (
              <select
                aria-label="Expiry bucket"
                className={`${inputClass} w-48`}
                value={filters.bucket}
                onChange={(e) => set({ bucket: e.target.value })}
              >
                {BUCKETS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            ) : null}
            {uses.includes('limit') ? (
              <label className="text-xs text-muted">
                Show first
                <input
                  type="number"
                  min={1}
                  max={100000}
                  className={`${inputClass} w-28`}
                  placeholder="Default"
                  value={filters.limit}
                  onChange={(e) => set({ limit: e.target.value })}
                />
              </label>
            ) : null}
            <div className="ms-auto flex gap-2">
              {info?.canExport ? (
                <a
                  href={`/api/reports/${encodeURIComponent(info.id)}/export?format=xlsx${query ? `&${query}` : ''}`}
                  download
                  className="inline-flex h-10 items-center rounded-[6px] border border-primary-600 px-4 text-sm font-semibold text-primary-600 hover:bg-primary-50"
                >
                  Export Excel
                </a>
              ) : null}
              <Button
                variant="outline"
                disabled={!data}
                onClick={() => {
                  setNotice(null);
                  printReport(fileBase)
                    .then((path) => path && setNotice(`Saved to ${path}`))
                    .catch((e: unknown) =>
                      setError(e instanceof Error ? e.message : 'Could not print'),
                    );
                }}
              >
                Print / Save as PDF
              </Button>
            </div>
          </div>
          {notice ? (
            <p
              role="status"
              className="rounded-[6px] bg-primary-50 px-4 py-2 text-sm text-primary-900"
            >
              {notice}
            </p>
          ) : null}
        </div>

        <ErrorText message={error} />

        <div id="report-print" className="space-y-4">
          <header>
            <h2 className="text-xl font-semibold">{data?.title ?? info?.title ?? 'Report'}</h2>
            <p className="text-sm text-muted">
              {[branchName, filterText, generatedAt ? `Generated ${generatedAt}` : '']
                .filter(Boolean)
                .join(' | ')}
            </p>
          </header>
          {loading && !data ? <p className="text-sm text-muted">Loading…</p> : null}
          {data ? (
            <div className={loading ? 'opacity-60' : undefined} aria-busy={loading}>
              <div className="space-y-4">
                {data.kpis && data.kpis.length > 0 ? <KpiCards kpis={data.kpis} /> : null}
                {data.rows.length === 0 ? (
                  <p className="rounded-[10px] border border-dashed border-border px-4 py-10 text-center text-sm text-muted">
                    Nothing to show for these filters.
                  </p>
                ) : (
                  <ReportTable data={data} />
                )}
                {data.truncated ? (
                  <p className="text-sm text-warning">
                    Only the first rows are shown. Narrow the dates or search, or raise the limit.
                  </p>
                ) : null}
                {data.note ? <p className="text-xs text-muted">{data.note}</p> : null}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
