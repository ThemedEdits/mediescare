'use client';

import { useState } from 'react';
import { api, Badge, Button, ErrorText, inputClass, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
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

const SEVERITY: Record<Issue['severity'], { tone: 'danger' | 'warning' | 'neutral' }> = {
  error: { tone: 'danger' },
  exists: { tone: 'neutral' },
  warning: { tone: 'warning' },
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
  const t = useT();
  const errorText = useErrorText();
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
      setError(errorText(e, 'itemsImport.couldNotCheck'));
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
      setError(errorText(e, 'itemsImport.couldNotStart'));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">
          {t('itemsImport.file')} <bdi className="font-medium">{view.fileName}</bdi>
        </p>
        <Button variant="ghost" className="ms-auto" onClick={onRestart} disabled={busy}>
          {t('itemsImport.chooseAnother')}
        </Button>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t('itemsImport.columns')}</h2>
        <p className="text-sm text-muted">{t('itemsImport.columnsHelp')}</p>
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">{t('itemsImport.col.itemField')}</th>
                <th className="px-4 py-3">{t('itemsImport.col.fileColumn')}</th>
                <th className="px-4 py-3">{t('common.notes')}</th>
              </tr>
            </thead>
            <tbody>
              {view.fields.map((f) => (
                <tr key={f.key} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">
                    {f.label}
                    {f.required ? (
                      <span className="text-danger" aria-label={t('itemsImport.required')}>
                        {' '}
                        *
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    <select
                      aria-label={t('itemsImport.columnFor', { label: f.label })}
                      className={`${inputClass} max-w-xs`}
                      disabled={busy}
                      value={mapping[f.key] === undefined ? NONE : String(mapping[f.key])}
                      onChange={(e) => choose(f.key, e.target.value)}
                    >
                      <option value={NONE}>
                        {f.required ? t('itemsImport.chooseColumn') : t('itemsImport.doNotImport')}
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
        <h2 className="text-lg font-semibold">{t('itemsImport.openingStock')}</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={importStock}
            disabled={busy || mapping.quantity === undefined}
            onChange={(e) => void revalidate(mapping, e.target.checked)}
          />
          {t('itemsImport.importStock')}
          {mapping.quantity === undefined ? (
            <span className="text-muted">{t('itemsImport.mapQuantityFirst')}</span>
          ) : null}
        </label>
        {importStock ? (
          <p className="text-sm text-muted">
            {t('itemsImport.stockNeeds')}
            {s.stockRows > 0
              ? ` ${t('itemsImport.stockRowsNote', { count: s.stockRows.toLocaleString('en') })}`
              : ''}
          </p>
        ) : null}
        {needsExpiry ? (
          <div className="max-w-xs space-y-1">
            <label className="text-sm font-medium" htmlFor="default-expiry">
              {t('itemsImport.defaultExpiry', { count: s.needsDefaultExpiry.toLocaleString('en') })}
            </label>
            <input
              id="default-expiry"
              type="date"
              className={inputClass}
              min={tomorrow()}
              value={defaultExpiry}
              onChange={(e) => setDefaultExpiry(e.target.value)}
            />
            {!expiryOk ? (
              <p className="text-xs text-danger">{t('itemsImport.futureDate')}</p>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-live="polite">
        <h2 className="text-lg font-semibold">
          {t('itemsImport.checkResult')}{' '}
          {busy ? (
            <span className="text-sm font-normal text-muted">{t('itemsImport.checking')}</span>
          ) : null}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Card label={t('itemsImport.card.rows')} value={s.totalRows} />
          <Card label={t('itemsImport.card.willImport')} value={s.willImport} tone="success" />
          <Card label={t('itemsImport.card.exist')} value={s.alreadyExist} />
          <Card
            label={t('itemsImport.stat.errors')}
            value={s.skippedWithErrors}
            tone={s.skippedWithErrors ? 'danger' : undefined}
          />
          <Card
            label={t('itemsImport.stat.warnings')}
            value={s.rowsWithWarnings}
            tone={s.rowsWithWarnings ? 'warning' : undefined}
          />
        </div>
        {s.rowsWithSuppliers > 0 ? (
          <p className="text-sm text-muted">
            {t('itemsImport.suppliersNote', { count: s.rowsWithSuppliers.toLocaleString('en') })}
          </p>
        ) : null}
        {mapping.name === undefined ? (
          <p className="text-sm text-danger">{t('itemsImport.chooseNameColumn')}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-medium">{t('itemsImport.issues')}</h3>
          <a
            className="ms-auto text-sm font-semibold text-primary-600 underline"
            href={`/api/imports/items/${view.importId}/report`}
            download
          >
            {t('itemsImport.downloadFullReport')}
          </a>
        </div>
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
              <tr>
                <th className="px-4 py-3">{t('itemsImport.col.row')}</th>
                <th className="px-4 py-3">{t('itemsImport.col.result')}</th>
                <th className="px-4 py-3">{t('common.item')}</th>
                <th className="px-4 py-3">{t('common.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {view.sampleIssues.map((i, n) => (
                <tr key={n} className="border-t border-border">
                  <td className="px-4 py-2 tabular-nums">{i.row}</td>
                  <td className="px-4 py-2">
                    <Badge tone={SEVERITY[i.severity].tone}>
                      {t('itemsImport.severity.' + i.severity)}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">{i.name}</td>
                  <td className="px-4 py-2 text-muted">{i.message}</td>
                </tr>
              ))}
              {view.sampleIssues.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    {t('itemsImport.noIssues')}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {view.sampleIssues.length < Object.values(s.issueCounts).reduce((a, b) => a + b, 0) ? (
          <p className="text-xs text-muted">
            {t('itemsImport.showingFirst', { count: view.sampleIssues.length })}
          </p>
        ) : null}
      </section>

      <ErrorText message={error} />
      <div className="flex justify-end">
        <Button onClick={() => void start()} disabled={!canStart}>
          {t('itemsImport.importCount', { count: s.willImport.toLocaleString('en') })}
        </Button>
      </div>
    </div>
  );
}
