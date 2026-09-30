'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api, Button, ErrorText, inputClass } from '@/components/ui';
import { PrinterSettings } from './printer-settings';
import { SyncPanel } from './sync-panel';
import { bpToPercent, percentToBp } from './percent';

type Values = Record<string, string | number | boolean>;

const TAX_FIELDS: [string, string, string][] = [
  [
    'tax.default_sales_tax_bp',
    'Sales tax',
    'Pre-fills the tax rate of new items and the sales tax on purchase bills.',
  ],
  ['tax.default_advance_tax_bp', 'Advance tax', 'Pre-fills advance tax on purchase bills.'],
  ['tax.default_wht_bp', 'Withholding tax (WHT)', 'Pre-fills WHT on purchase bills.'],
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
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load settings'));
  }, []);

  const patch = (p: Values) => setValues((v) => ({ ...v, ...p }));
  const badTax = TAX_FIELDS.filter(([k]) => percentToBp(taxText[k] ?? '') === null).map(
    ([, label]) => label,
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
      setDone('Settings saved.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the settings');
    } finally {
      setBusy(false);
    }
  }

  const taxChanged = saved
    ? TAX_FIELDS.some(([k]) => percentToBp(taxText[k] ?? '') !== Number(saved[k] ?? 0))
    : false;
  const dirty = changed.length > 0 || taxChanged;

  if (!saved) return <p className="py-10 text-center text-muted">{error ?? 'Loading…'}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-muted">
            {branchName ? `For ${branchName}` : 'For this branch'}
          </p>
        </div>
        {canEdit ? (
          <Button onClick={() => void save()} disabled={busy || !dirty || badTax.length > 0}>
            {busy ? 'Saving…' : 'Save settings'}
          </Button>
        ) : (
          <p className="text-sm text-muted">You can view but not change settings.</p>
        )}
      </div>
      {done ? (
        <p role="status" className="rounded-[6px] bg-[#E8F5E9] px-3 py-2 text-sm text-success">
          {done}
        </p>
      ) : null}
      <ErrorText message={error} />
      {badTax.length > 0 ? (
        <ErrorText message={`Enter ${badTax.join(', ')} as a percentage such as 17 or 0.5.`} />
      ) : null}

      <fieldset disabled={!canEdit} className="space-y-4">
        <Section
          title="Billing"
          hint="Applied by the server on every sale, so no terminal can differ."
        >
          <label className="block text-sm">
            Round the bill total to
            <select
              aria-label="Rounding"
              className={`${inputClass} max-w-xs`}
              value={String(values['pos.rounding'])}
              onChange={(e) => patch({ 'pos.rounding': e.target.value })}
            >
              <option value="rupee">Nearest whole rupee</option>
              <option value="half_rupee">Nearest 50 paisa</option>
              <option value="none">No rounding (exact paisa)</option>
            </select>
          </label>
          <label className="block text-sm">
            Note printed on invoices
            <input
              aria-label="Invoice note"
              className={inputClass}
              maxLength={500}
              value={String(values['pos.invoice_note'] ?? '')}
              onChange={(e) => patch({ 'pos.invoice_note': e.target.value })}
            />
          </label>
        </Section>

        <Section
          title="Tax rates"
          hint="Rates are yours to set; nothing is assumed. They only pre-fill forms and can be changed on each document."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {TAX_FIELDS.map(([k, label, hint]) => (
              <label key={k} className="block text-sm">
                {label} (%)
                <input
                  aria-label={label}
                  className={inputClass}
                  inputMode="decimal"
                  value={taxText[k] ?? ''}
                  onChange={(e) => setTaxText((t) => ({ ...t, [k]: e.target.value }))}
                />
                <span className="text-xs text-muted">{hint}</span>
              </label>
            ))}
          </div>
        </Section>

        <Section
          title="Receipt printer"
          hint="Thermal receipt printer and cash drawer (RJ11 through the printer)."
        >
          <PrinterSettings values={values} onChange={patch} />
        </Section>
      </fieldset>

      <Section
        title="Cloud sync and terminals"
        hint="Data always saves on this PC first; syncing happens in the background and never slows the counter."
      >
        <SyncPanel canSync={canSync} canPair={canPair} />
      </Section>
    </div>
  );
}
