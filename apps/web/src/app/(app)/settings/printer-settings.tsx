'use client';

import { useEffect, useState } from 'react';
import { Button, ErrorText, inputClass } from '@/components/ui';
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
    else setError(result.error ?? 'Failed');
  };

  const known = printers?.some((p) => p.name === printerName) ?? false;

  return (
    <div className="space-y-4" data-testid="printer-settings">
      <label className="block text-sm">
        <span className="font-medium">Receipt printer</span>
        {printers && printers.length > 0 ? (
          <select
            className={`${inputClass} mt-1`}
            value={printerName}
            onChange={(e) => onChange({ 'print.printer_name': e.target.value })}
          >
            <option value="">System default printer</option>
            {printerName && !known ? (
              <option value={printerName}>{printerName} (not found)</option>
            ) : null}
            {printers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={`${inputClass} mt-1`}
            value={printerName}
            maxLength={200}
            placeholder="Empty means the system default printer"
            onChange={(e) => onChange({ 'print.printer_name': e.target.value })}
          />
        )}
      </label>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="font-medium">Paper width</span>
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
          <span className="font-medium">Copies</span>
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
          <span className="font-medium">Drawer connector</span>
          <select
            className={`${inputClass} mt-1`}
            value={pin}
            onChange={(e) => onChange({ 'print.drawer_pin': e.target.value })}
          >
            <option value="pin2">Pin 2 (most drawers)</option>
            <option value="pin5">Pin 5</option>
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
          Print the receipt automatically after each sale
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={values['print.open_drawer_on_cash'] !== false}
            onChange={(e) => onChange({ 'print.open_drawer_on_cash': e.target.checked })}
          />
          Open the cash drawer when a sale has a cash payment
        </label>
      </div>

      <label className="block text-sm">
        <span className="font-medium">Receipt header</span>
        <textarea
          className={`${inputClass} mt-1 h-20 py-2`}
          value={str('print.receipt_header')}
          maxLength={300}
          placeholder="Shown above the branch name, one line per row"
          onChange={(e) => onChange({ 'print.receipt_header': e.target.value })}
        />
      </label>
      <label className="block text-sm">
        <span className="font-medium">Receipt footer</span>
        <textarea
          className={`${inputClass} mt-1 h-20 py-2`}
          value={str('print.receipt_footer')}
          maxLength={300}
          placeholder="Shown at the bottom (empty prints Thank you)"
          onChange={(e) => onChange({ 'print.receipt_footer': e.target.value })}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || !native}
          onClick={() => void run('Test receipt sent', () => printTestPage(printerName, paper))}
        >
          Print test receipt
        </Button>
        <Button
          variant="outline"
          disabled={busy || !native}
          onClick={() => void run('Drawer signal sent', () => kickDrawer(printerName, pin))}
        >
          Open cash drawer
        </Button>
      </div>
      {!native ? (
        <p className="text-xs text-muted">
          Test buttons and the printer list work in the Mediescare desktop app only.
        </p>
      ) : null}
      {done ? (
        <p role="status" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      <ErrorText message={error} />
    </div>
  );
}
