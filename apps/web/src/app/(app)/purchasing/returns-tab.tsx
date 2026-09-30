'use client';

import { useState } from 'react';
import { api, Modal, useAsync } from '@/components/ui';
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

const label = (reason: string) => reason.replace('_', ' ');

export function ReturnsTab({ version }: { version: number }) {
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
          <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2">Return</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Reason</th>
              <th>Credit note</th>
              <th className="px-3 text-end">Credit</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-border hover:bg-primary-50"
                onClick={() => setOpen(r.id)}
              >
                <td className="px-3 py-2 font-mono text-xs">{r.docNo}</td>
                <td>{r.createdAt.slice(0, 10)}</td>
                <td className="font-medium">{r.supplierName}</td>
                <td className="capitalize">{label(r.reason)}</td>
                <td>{r.creditNoteNo ?? '–'}</td>
                <td className="px-3 text-end tabular-nums">{pkr(r.totalMinor)}</td>
              </tr>
            ))}
            {data && data.rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-muted">
                  No returns to suppliers yet.
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
  const { data } = useAsync(
    () => api<{ return: ReturnDetail }>(`/api/purchase-returns/${id}`),
    [id],
  );
  const r = data?.return;
  return (
    <Modal title={r ? `Return ${r.docNo}` : 'Return'} onClose={onClose} wide>
      {r ? (
        <div className="space-y-3 text-sm">
          <p>
            {r.supplierName} · <span className="capitalize">{label(r.reason)}</span> ·{' '}
            {r.createdAt.slice(0, 10)}
            {r.creditNoteNo ? ` · credit note ${r.creditNoteNo}` : ''}
          </p>
          {r.note ? <p className="text-muted">{r.note}</p> : null}
          <table className="w-full">
            <thead className="border-b border-border text-left text-xs uppercase text-muted">
              <tr>
                <th className="py-1">Item</th>
                <th>Batch</th>
                <th>Expiry</th>
                <th className="text-end">Qty</th>
                <th className="text-end">Credit</th>
              </tr>
            </thead>
            <tbody>
              {r.lines.map((l) => (
                <tr key={l.lineNo} className="border-b border-border">
                  <td className="py-1 font-medium">{l.itemName}</td>
                  <td className="font-mono text-xs">{l.batchNo}</td>
                  <td>{l.expiryDate}</td>
                  <td className="text-end tabular-nums">{l.qtyBase}</td>
                  <td className="text-end tabular-nums">{pkr(l.lineTotalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-end text-lg font-bold tabular-nums">PKR {pkr(r.totalMinor)}</p>
        </div>
      ) : (
        <p className="py-8 text-center text-muted">Loading…</p>
      )}
    </Modal>
  );
}
