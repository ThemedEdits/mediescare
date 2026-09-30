'use client';

import { useState } from 'react';
import { api, Badge, Button, ErrorText, inputClass } from '@/components/ui';
import type { ImportView, Issue } from './types';

const NONE = '';

function tomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function Card({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: 'success' | 'danger' | 'warning';
}) {
  const color =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'success'
          ? 'text-success'
          : '';
  return (
    <div className="rounded-[10px] border border-border p-4">
      <p className="text-xs uppercase text-muted">{label}</p>
      <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value.toLocaleString('en')}</p>
    </div>
  );
}

const SEVERITY: Record<
  Issue['severity'],
  { tone: 'danger' | 'warning' | 'neutral'; label: string }
> = {
  error: { tone: 'danger', label: 'Skipped' },
  exists: { tone: 'neutral', label: 'Already exists' },
  warning: { tone: 'warning', label: 'Warning' },
};

/** Step 2: check the column mapping and options, read the validation summary, then start the import. */
export function ReviewStep({
  view,
  onView,
  onRestart,
}: {
  view: ImportView;
  onView: (view: ImportView) => void;
  onRestart: () => void;
}) {
  const [mapping, setMapping] = useState<Record<string, number>>(view.mapping);
  const [importStock, setImportStock] = useState(false);
  const [defaultExpiry, setDefaultExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = view.summary;

  async function revalidate(nextMapping: Record<string, number>, nextStock: boolean) {
    setBusy(true);
    setError(null);
    try {
      const full = Object.fromEntries(view.fields.map((f) => [f.key, nextMapping[f.key] ?? null]));
      onView(
        await api<ImportView>(`/api/imports/items/${view.importId}`, {
          body: { action: 'remap', mapping: full, importStock: nextStock },
        }),
      );
      setMapping(nextMapping);
      setImportStock(nextStock);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not check the file');
    } finally {
      setBusy(false);
    }
  }

  function choose(field: string, value: string) {
    const next = { ...mapping };
    if (value === NONE) delete next[field];
    else next[field] = Number(value);
    void revalidate(next, importStock);
  }

  const needsExpiry = importStock && view.needsDefaultExpiry;
  const expiryOk = !needsExpiry || defaultExpiry >= tomorrow();
  const canStart = !busy && mapping.name !== undefined && s.willImport > 0 && expiryOk;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      onView(
        await api<ImportView>(`/api/imports/items/${view.importId}`, {
          body: {
            action: 'commit',
            importStock,
            defaultExpiry: needsExpiry ? defaultExpiry : null,
          },
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the import');
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">
          File <span className="font-medium">{view.fileName}</span>
        </p>
        <Button variant="ghost" className="ms-auto" onClick={onRestart} disabled={busy}>
          Choose another file
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Columns</h2>
        <p className="text-sm text-muted">
          Mediescare matched the columns below. Change any that are wrong.
        </p>
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Item field</th>
                <th className="px-4 py-3">Column in your file</th>
                <th className="px-4 py-3">Notes</th>
              </tr>
            </thead>
            <tbody>
              {view.fields.map((f) => (
                <tr key={f.key} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">
                    {f.label}
                    {f.required ? (
                      <span className="text-danger" aria-label="required">
                        {' '}
                        *
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      aria-label={`Column for ${f.label}`}
                      className={`${inputClass} max-w-xs`}
                      disabled={busy}
                      value={mapping[f.key] === undefined ? NONE : String(mapping[f.key])}
                      onChange={(e) => choose(f.key, e.target.value)}
                    >
                      <option value={NONE}>
                        {f.required ? 'Choose a column' : 'Do not import'}
                      </option>
                      {view.headers.map((h, i) => (
                        <option key={i} value={String(i)}>
                          {i + 1}. {h}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-2 text-muted">{f.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Opening stock</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={importStock}
            disabled={busy || mapping.quantity === undefined}
            onChange={(e) => void revalidate(mapping, e.target.checked)}
          />
          Import quantity on hand as opening stock
          {mapping.quantity === undefined ? (
            <span className="text-muted">(map a quantity column first)</span>
          ) : null}
        </label>
        {importStock ? (
          <p className="text-sm text-muted">
            Stock needs a cost and a future expiry date. Rows without a cost get no stock (cost is
            never guessed).
            {s.stockRows > 0 ? ` ${s.stockRows.toLocaleString('en')} rows have a quantity.` : ''}
          </p>
        ) : null}
        {needsExpiry ? (
          <div className="max-w-xs space-y-1">
            <label className="text-sm font-medium" htmlFor="default-expiry">
              Default expiry for rows without one ({s.needsDefaultExpiry.toLocaleString('en')} rows)
            </label>
            <input
              id="default-expiry"
              type="date"
              className={inputClass}
              min={tomorrow()}
              value={defaultExpiry}
              onChange={(e) => setDefaultExpiry(e.target.value)}
            />
            {!expiryOk ? <p className="text-xs text-danger">Enter a date in the future.</p> : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-live="polite">
        <h2 className="text-lg font-semibold">
          Check result{' '}
          {busy ? <span className="text-sm font-normal text-muted">checking...</span> : null}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Card label="Rows in file" value={s.totalRows} />
          <Card label="Will import" value={s.willImport} tone="success" />
          <Card label="Already exist" value={s.alreadyExist} />
          <Card
            label="Skipped (errors)"
            value={s.skippedWithErrors}
            tone={s.skippedWithErrors ? 'danger' : undefined}
          />
          <Card
            label="With warnings"
            value={s.rowsWithWarnings}
            tone={s.rowsWithWarnings ? 'warning' : undefined}
          />
        </div>
        {s.rowsWithSuppliers > 0 ? (
          <p className="text-sm text-muted">
            Supplier names in {s.rowsWithSuppliers.toLocaleString('en')} rows are not imported. Add
            suppliers separately.
          </p>
        ) : null}
        {mapping.name === undefined ? (
          <p className="text-sm text-danger">Choose the column that holds the item name.</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-medium">Issues</h3>
          <a
            className="ms-auto text-sm font-semibold text-primary-600 underline"
            href={`/api/imports/items/${view.importId}/report`}
            download
          >
            Download full issue report
          </a>
        </div>
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">Row</th>
                <th className="px-4 py-3">Result</th>
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Reason</th>
              </tr>
            </thead>
            <tbody>
              {view.sampleIssues.map((i, n) => (
                <tr key={n} className="border-t border-border">
                  <td className="px-4 py-2 tabular-nums">{i.row}</td>
                  <td className="px-4 py-2">
                    <Badge tone={SEVERITY[i.severity].tone}>{SEVERITY[i.severity].label}</Badge>
                  </td>
                  <td className="px-4 py-2">{i.name}</td>
                  <td className="px-4 py-2 text-muted">{i.message}</td>
                </tr>
              ))}
              {view.sampleIssues.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    No issues found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {view.sampleIssues.length < Object.values(s.issueCounts).reduce((a, b) => a + b, 0) ? (
          <p className="text-xs text-muted">
            Showing the first {view.sampleIssues.length} issues. The report file has more.
          </p>
        ) : null}
      </section>

      <ErrorText message={error} />
      <div className="flex justify-end">
        <Button onClick={() => void start()} disabled={!canStart}>
          Import {s.willImport.toLocaleString('en')} items
        </Button>
      </div>
    </div>
  );
}
