'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api, Button, ErrorText, inputClass, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { PrinterSettings } from './printer-settings';
import { SyncPanel } from './sync-panel';
import { bpToPercent, percentToBp } from './percent';

type Values = Record<string, string | number | boolean>;

/** Setting key, then the message keys (under settings.) of its label and hint. */
const TAX_FIELDS: [string, string, string][] = [
  ['tax.default_sales_tax_bp', 'salesTax', 'salesTaxHint'],
  ['tax.default_advance_tax_bp', 'advanceTax', 'advanceTaxHint'],
  ['tax.default_wht_bp', 'wht', 'whtHint'],
];

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-[10px] border border-border p-4">
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {hint ? <p className="text-sm text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** Branch settings: billing (rounding, note), tax defaults and the receipt printer. Saved together, audited. */
export function SettingsClient({
  branchName,
  canEdit,
  canSync,
  canPair,
}: {
  branchName: string;
  canEdit: boolean;
  canSync: boolean;
  canPair: boolean;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [saved, setSaved] = useState<Values | null>(null);
  const [values, setValues] = useState<Values>({});
  const [taxText, setTaxText] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function adopt(s: Values) {
    setSaved(s);
    setValues(s);
    setTaxText(Object.fromEntries(TAX_FIELDS.map(([k]) => [k, bpToPercent(Number(s[k] ?? 0))])));
  }

  useEffect(() => {
    api<{ settings: Values }>('/api/settings/pos')
      .then((r) => adopt(r.settings))
      .catch((e: unknown) => setError(errorText(e, 'settings.loadFailed')));
  }, []);

  const patch = (p: Values) => setValues((v) => ({ ...v, ...p }));
  const badTax = TAX_FIELDS.filter(([k]) => percentToBp(taxText[k] ?? '') === null).map(
    ([, label]) => t(`settings.${label}`),
  );
  const changed = saved ? Object.keys(values).filter((k) => values[k] !== saved[k]) : [];

  async function save() {
    if (!saved) return;
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const merged: Values = { ...values };
      for (const [k] of TAX_FIELDS) merged[k] = percentToBp(taxText[k] ?? '') ?? 0;
      const send = Object.fromEntries(
        Object.keys(merged)
          .filter((k) => merged[k] !== saved[k])
          .map((k) => [k, merged[k] as string | number | boolean]),
      );
      const r = await api<{ settings: Values }>('/api/settings/pos', {
        method: 'PUT',
        body: { settings: send },
      });
      adopt(r.settings);
      setDone(t('settings.saved'));
    } catch (e) {
      setError(errorText(e, 'settings.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const taxChanged = saved
    ? TAX_FIELDS.some(([k]) => percentToBp(taxText[k] ?? '') !== Number(saved[k] ?? 0))
    : false;
  const dirty = changed.length > 0 || taxChanged;

  if (!saved) return <p className="py-10 text-center text-muted">{error ?? t('common.loading')}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{t('settings.title')}</h1>
          <p className="text-sm text-muted">
            {branchName
              ? t('settings.forBranch', { name: branchName })
              : t('settings.forThisBranch')}
          </p>
        </div>
        {canEdit ? (
          <Button onClick={() => void save()} disabled={busy || !dirty || badTax.length > 0}>
            {busy ? t('common.saving') : t('settings.saveSettings')}
          </Button>
        ) : (
          <p className="text-sm text-muted">{t('settings.viewOnly')}</p>
        )}
      </div>
      {done ? (
        <p role="status" className="rounded-[6px] bg-[#E8F5E9] px-3 py-2 text-sm text-success">
          {done}
        </p>
      ) : null}
      <ErrorText message={error} />
      {badTax.length > 0 ? (
        <ErrorText message={t('settings.badTax', { fields: badTax.join(', ') })} />
      ) : null}

      <fieldset disabled={!canEdit} className="space-y-4">
        <Section title={t('settings.billing')} hint={t('settings.billingHint')}>
          <label className="block text-sm">
            {t('settings.roundLabel')}
            <select
              aria-label={t('settings.rounding')}
              className={`${inputClass} max-w-xs`}
              value={String(values['pos.rounding'])}
              onChange={(e) => patch({ 'pos.rounding': e.target.value })}
            >
              <option value="rupee">{t('settings.roundRupee')}</option>
              <option value="half_rupee">{t('settings.roundHalf')}</option>
              <option value="none">{t('settings.roundNone')}</option>
            </select>
          </label>
          <label className="block text-sm">
            {t('settings.invoiceNoteLabel')}
            <input
              aria-label={t('settings.invoiceNote')}
              className={inputClass}
              maxLength={500}
              value={String(values['pos.invoice_note'] ?? '')}
              onChange={(e) => patch({ 'pos.invoice_note': e.target.value })}
            />
          </label>
        </Section>

        <Section title={t('settings.taxRates')} hint={t('settings.taxHint')}>
          <div className="grid gap-3 sm:grid-cols-3">
            {TAX_FIELDS.map(([k, labelKey, hintKey]) => (
              <label key={k} className="block text-sm">
                {t('settings.taxLabel', { label: t(`settings.${labelKey}`) })}
                <input
                  aria-label={t(`settings.${labelKey}`)}
                  className={inputClass}
                  inputMode="decimal"
                  value={taxText[k] ?? ''}
                  onChange={(e) => setTaxText((t) => ({ ...t, [k]: e.target.value }))}
                />
                <span className="text-xs text-muted">{t(`settings.${hintKey}`)}</span>
              </label>
            ))}
          </div>
        </Section>

        <Section title={t('settings.receiptPrinter')} hint={t('settings.receiptPrinterHint')}>
          <PrinterSettings values={values} onChange={patch} />
        </Section>
      </fieldset>

      <Section title={t('settings.syncSection')} hint={t('settings.syncSectionHint')}>
        <SyncPanel canSync={canSync} canPair={canPair} />
      </Section>
    </div>
  );
}
