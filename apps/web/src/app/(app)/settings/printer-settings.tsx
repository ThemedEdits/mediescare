'use client';

import { useEffect, useState } from 'react';
import { Button, ErrorText, inputClass } from '@/components/ui';
import { useT } from '@/i18n/client';
import { kickDrawer, printTestPage } from '@/lib/receipt';

type Values = Record<string, string | number | boolean>;

/**
 * Receipt printer fields for the branch settings screen. The test buttons use the values as they are
 * typed (not yet saved). Printer names come from Windows when running in the desktop app.
 */
export function PrinterSettings({
  values,
  onChange,
}: {
  values: Values;
  onChange: (patch: Values) => void;
}) {
  const t = useT();
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const native = typeof window !== 'undefined' && Boolean(window.mediescare?.printRaw);

  useEffect(() => {
    let alive = true;
    window.mediescare
      ?.listPrinters?.()
      .then((list) => alive && setPrinters(list))
      .catch(() => alive && setPrinters([]));
    return () => {
      alive = false;
    };
  }, []);

  const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : '');
  const printerName = str('print.printer_name');
  const paper = String(values['print.paper_width']) === '58' ? '58' : '80';
  const pin = values['print.drawer_pin'] === 'pin5' ? 'pin5' : 'pin2';

  const run = async (label: string, job: () => Promise<{ ok: boolean; error?: string }>) => {
    setBusy(true);
    setError(null);
    setDone(null);
    const result = await job();
    setBusy(false);
    if (result.ok) setDone(label);
    else setError(result.error ?? t('settings.printer.failed'));
  };

  const known = printers?.some((p) => p.name === printerName) ?? false;

  return (
    <div className="space-y-4" data-testid="printer-settings">
      <label className="block text-sm">
        <span className="font-medium">{t('settings.receiptPrinter')}</span>
        {printers && printers.length > 0 ? (
          <select
            className={`${inputClass} mt-1`}
            value={printerName}
            onChange={(e) => onChange({ 'print.printer_name': e.target.value })}
          >
            <option value="">{t('settings.printer.systemDefault')}</option>
            {printerName && !known ? (
              <option value={printerName}>
                {t('settings.printer.notFound', { name: printerName })}
              </option>
            ) : null}
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.isDefault ? t('settings.printer.isDefault', { name: p.name }) : p.name}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={`${inputClass} mt-1`}
            value={printerName}
            maxLength={200}
            placeholder={t('settings.printer.placeholder')}
            onChange={(e) => onChange({ 'print.printer_name': e.target.value })}
          />
        )}
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-medium">{t('settings.printer.paperWidth')}</span>
          <select
            className={`${inputClass} mt-1`}
            value={paper}
            onChange={(e) => onChange({ 'print.paper_width': e.target.value })}
          >
            <option value="80">80 mm</option>
            <option value="58">58 mm</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t('settings.printer.copies')}</span>
          <select
            className={`${inputClass} mt-1`}
            value={Number(values['print.copies']) || 1}
            onChange={(e) => onChange({ 'print.copies': Number(e.target.value) })}
          >
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">{t('settings.printer.drawerConnector')}</span>
          <select
            className={`${inputClass} mt-1`}
            value={pin}
            onChange={(e) => onChange({ 'print.drawer_pin': e.target.value })}
          >
            <option value="pin2">{t('settings.printer.pin2')}</option>
            <option value="pin5">{t('settings.printer.pin5')}</option>
          </select>
        </label>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values['print.auto_print'] === true}
            onChange={(e) => onChange({ 'print.auto_print': e.target.checked })}
          />
          {t('settings.printer.autoPrint')}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values['print.open_drawer_on_cash'] !== false}
            onChange={(e) => onChange({ 'print.open_drawer_on_cash': e.target.checked })}
          />
          {t('settings.printer.openDrawer')}
        </label>
      </div>

      <label className="block text-sm">
        <span className="font-medium">{t('settings.printer.header')}</span>
        <textarea
          className={`${inputClass} mt-1 h-20 py-2`}
          value={str('print.receipt_header')}
          maxLength={300}
          placeholder={t('settings.printer.headerPlaceholder')}
          onChange={(e) => onChange({ 'print.receipt_header': e.target.value })}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">{t('settings.printer.footer')}</span>
        <textarea
          className={`${inputClass} mt-1 h-20 py-2`}
          value={str('print.receipt_footer')}
          maxLength={300}
          placeholder={t('settings.printer.footerPlaceholder')}
          onChange={(e) => onChange({ 'print.receipt_footer': e.target.value })}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || !native}
          onClick={() =>
            void run(t('settings.printer.testSent'), () => printTestPage(printerName, paper))
          }
        >
          {t('settings.printer.printTest')}
        </Button>
        <Button
          variant="outline"
          disabled={busy || !native}
          onClick={() =>
            void run(t('settings.printer.drawerSent'), () => kickDrawer(printerName, pin))
          }
        >
          {t('settings.printer.openCashDrawer')}
        </Button>
      </div>
      {!native ? <p className="text-xs text-muted">{t('settings.printer.desktopOnly')}</p> : null}
      {done ? (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      <ErrorText message={error} />
    </div>
  );
}
