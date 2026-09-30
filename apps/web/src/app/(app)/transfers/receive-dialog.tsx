'use client';

import { useState } from 'react';
import { api, Button, ErrorText, inputClass, Modal, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { qty, type TransferDetail } from './types';

/**
 * The receiving branch counts the goods. Every line starts as fully received. Enter what arrived
 * damaged and what is short; the short quantity is whatever did not arrive. Received and damaged
 * together cannot be more than what was sent. This can be done once.
 */
export function ReceiveDialog({
  transfer,
  onClose,
  onReceived,
}: {
  transfer: TransferDetail;
  onClose: () => void;
  onReceived: (message: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [received, setReceived] = useState<Record<string, string>>({});
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const num = (v: string | undefined, fallback: number) =>
    v === undefined || v.trim() === '' ? fallback : Number(v);
  const counts = transfer.lines.map((l) => {
    const r = num(received[l.id], l.qtyDispatched);
    const d = num(damaged[l.id], 0);
    const valid =
      Number.isInteger(r) && Number.isInteger(d) && r >= 0 && d >= 0 && r + d <= l.qtyDispatched;
    return { line: l, r, d, short: valid ? l.qtyDispatched - r - d : 0, valid };
  });
  const allValid = counts.every((c) => c.valid);
  const totalDamaged = counts.reduce((s, c) => s + (c.valid ? c.d : 0), 0);
  const totalShort = counts.reduce((s, c) => s + c.short, 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ receivedQty: number; damagedQty: number; shortQty: number }>(
        `/api/transfers/${transfer.id}/receive`,
        {
          body: {
            note: note || undefined,
            lines: counts.map((c) => ({
              lineId: c.line.id,
              qtyReceived: c.r,
              qtyDamaged: c.d,
            })),
          },
        },
      );
      onReceived(
        r.damagedQty + r.shortQty > 0
          ? t('transfers.receiveDialog.doneToastLoss', {
              docNo: transfer.docNo,
              received: r.receivedQty,
              damaged: r.damagedQty,
              short: r.shortQty,
            })
          : t('transfers.receiveDialog.doneToast', {
              docNo: transfer.docNo,
              received: r.receivedQty,
            }),
      );
    } catch (e) {
      setError(errorText(e, 'transfers.receiveDialog.failed'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={t('transfers.receiveDialog.title', { docNo: transfer.docNo })}
      onClose={onClose}
      wide
    >
      <div className="space-y-3">
        <p className="text-sm text-muted">
          {t('transfers.receiveDialog.intro', { from: transfer.fromBranchName })}
        </p>
        <div className="overflow-x-auto rounded-[10px] border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
              <tr>
                <th className="px-3 py-2">{t('common.item')}</th>
                <th>{t('transfers.batch')}</th>
                <th>{t('transfers.expiry')}</th>
                <th className="text-end">{t('transfers.sent')}</th>
                <th className="text-end">{t('transfers.received')}</th>
                <th className="text-end">{t('transfers.damaged')}</th>
                <th className="px-3 text-end">{t('transfers.short')}</th>
              </tr>
            </thead>
            <tbody>
              {counts.map(({ line: l, short, valid }) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{l.item.name}</td>
                  <td className="font-mono text-xs" dir="ltr">
                    {l.batchNo}
                  </td>
                  <td dir="ltr">{l.expiryDate}</td>
                  <td className="text-end tabular-nums">{qty(l.qtyDispatched, l.item.units)}</td>
                  <td className="text-end">
                    <input
                      aria-label={t('transfers.receiveDialog.receivedAria', { name: l.item.name })}
                      inputMode="numeric"
                      className={`${inputClass} w-24 text-end tabular-nums ${valid ? '' : 'border-danger'}`}
                      value={received[l.id] ?? String(l.qtyDispatched)}
                      onChange={(e) =>
                        setReceived((s) => ({ ...s, [l.id]: e.target.value.replace(/[^\d]/g, '') }))
                      }
                    />
                  </td>
                  <td className="text-end">
                    <input
                      aria-label={t('transfers.receiveDialog.damagedAria', { name: l.item.name })}
                      inputMode="numeric"
                      className={`${inputClass} w-24 text-end tabular-nums ${valid ? '' : 'border-danger'}`}
                      value={damaged[l.id] ?? '0'}
                      onChange={(e) =>
                        setDamaged((s) => ({ ...s, [l.id]: e.target.value.replace(/[^\d]/g, '') }))
                      }
                    />
                  </td>
                  <td
                    className={`px-3 text-end tabular-nums ${short > 0 ? 'font-semibold text-danger' : ''}`}
                  >
                    {short}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">{t('transfers.receiveDialog.smallestUnit')}</p>
        <label className="block text-sm">
          {t('transfers.receiveDialog.noteLabel')}
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {totalDamaged + totalShort > 0 ? (
          <p role="status" className="rounded-[6px] bg-[#FEF3C7] px-3 py-2 text-sm text-warning">
            {t('transfers.receiveDialog.lossNotice', { damaged: totalDamaged, short: totalShort })}
          </p>
        ) : null}
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button onClick={() => void submit()} disabled={busy || !allValid}>
            {busy ? t('transfers.receiveDialog.receiving') : t('transfers.receiveDialog.submit')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
