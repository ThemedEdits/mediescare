'use client';

import { useState } from 'react';
import { api, Modal, useAsync } from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr } from '@/lib/format';

interface ReturnRow {
  id: string;
  docNo: string;
  supplierName: string;
  reason: string;
  creditNoteNo: string | null;
  totalMinor: number;
  createdAt: string;
}
interface ReturnDetail extends ReturnRow {
  note: string | null;
  lines: {
    lineNo: number;
    itemName: string;
    batchNo: string;
    expiryDate: string;
    qtyBase: number;
    lineTotalMinor: number;
  }[];
}

const plainReason = (reason: string) => reason.replace('_', ' ');

/** Short return-reason text; unknown reason codes show as plain words. */
function useReasonLabel(): (reason: string) => string {
  const t = useT();
  return (reason) =>
    t.has(`purchasing.returns.reasonShort.${reason}`)
      ? t(`purchasing.returns.reasonShort.${reason}`)
      : plainReason(reason);
}

export function ReturnsTab({ version }: { version: number }) {
  const t = useT();
  const label = useReasonLabel();
  const { data, error } = useAsync(
    () => api<{ rows: ReturnRow[] }>('/api/purchase-returns?pageSize=100'),
    [version],
  );
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">{t('purchasing.returns.return')}</th>
              <th>{t('common.date')}</th>
              <th>{t('common.supplier')}</th>
              <th>{t('common.reason')}</th>
              <th>{t('purchasing.returns.creditNote')}</th>
              <th className="px-3 text-end">{t('purchasing.col.credit')}</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-border hover:bg-primary-50"
                onClick={() => setOpen(r.id)}
              >
                <td className="px-3 py-2 font-mono text-xs">
                  <bdi>{r.docNo}</bdi>
                </td>
                <td>{r.createdAt.slice(0, 10)}</td>
                <td className="font-medium">{r.supplierName}</td>
                <td className="capitalize">{label(r.reason)}</td>
                <td>
                  <bdi>{r.creditNoteNo ?? '–'}</bdi>
                </td>
                <td className="px-3 text-end tabular-nums">{pkr(r.totalMinor)}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted">
                  {t('purchasing.returns.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {open ? <ReturnView id={open} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function ReturnView({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const label = useReasonLabel();
  const { data } = useAsync(
    () => api<{ return: ReturnDetail }>(`/api/purchase-returns/${id}`),
    [id],
  );
  const r = data?.return;
  return (
    <Modal
      title={
        r
          ? t('purchasing.returns.viewTitle', { docNo: r.docNo })
          : t('purchasing.returns.viewFallback')
      }
      onClose={onClose}
      wide
    >
      {r ? (
        <div className="space-y-3 text-sm">
          <p>
            {r.supplierName} · <span className="capitalize">{label(r.reason)}</span> ·{' '}
            {r.createdAt.slice(0, 10)}
            {r.creditNoteNo
              ? ` · ${t('purchasing.returns.creditNoteRef', { no: r.creditNoteNo })}`
              : ''}
          </p>
          {r.note ? <p className="text-muted">{r.note}</p> : null}
          <table className="w-full">
            <thead className="border-b border-border text-start text-xs uppercase text-muted">
              <tr>
                <th className="py-1">{t('common.item')}</th>
                <th>{t('purchasing.col.batch')}</th>
                <th>{t('purchasing.col.expiry')}</th>
                <th className="text-end">{t('purchasing.col.qty')}</th>
                <th className="text-end">{t('purchasing.col.credit')}</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.lineNo} className="border-b border-border">
                  <td className="py-1 font-medium">{l.itemName}</td>
                  <td className="font-mono text-xs">
                    <bdi>{l.batchNo}</bdi>
                  </td>
                  <td>{l.expiryDate}</td>
                  <td className="text-end tabular-nums">{l.qtyBase}</td>
                  <td className="text-end tabular-nums">{pkr(l.lineTotalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-end text-lg font-bold tabular-nums">
            <bdi>PKR {pkr(r.totalMinor)}</bdi>
          </p>
        </div>
      ) : (
        <p className="py-8 text-center text-muted">{t('common.loading')}</p>
      )}
    </Modal>
  );
}
