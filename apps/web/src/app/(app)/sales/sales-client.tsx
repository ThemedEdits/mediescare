'use client';

import { useState } from 'react';
import {
  api,
  ApiError,
  Badge,
  Button,
  ErrorText,
  inputClass,
  Modal,
  useAsync,
} from '@/components/ui';
import { pkr } from '@/lib/format';
import { OverrideDialog } from '../pos/pos-dialogs';
import type { OverrideNeed, PaymentMode } from '../pos/pos-types';

interface Row {
  id: string;
  docNo: string;
  status: string;
  grandTotalMinor: number;
  paidMinor: number;
  dueMinor: number;
  discountMinor: number;
  createdAt: string;
}
interface Line {
  id: string;
  lineNo: number;
  name: string;
  qtyUnits: number;
  qtyBase: number;
  netMinor: number;
  discountMinor: number;
  costMinor?: number;
}
interface Detail {
  id: string;
  docNo: string;
  status: string;
  createdAt: string;
  voidReason: string | null;
  grandTotalMinor: number;
  paidMinor: number;
  changeMinor: number;
  profitMinor?: number;
  lines: (Line & { itemId: string })[];
}

const REASONS: [string, string][] = [
  ['wrong_item', 'Wrong item'],
  ['damaged', 'Damaged'],
  ['expired', 'Expired'],
  ['customer_changed_mind', 'Customer changed mind'],
  ['prescription_change', 'Prescription changed'],
  ['other', 'Other (describe)'],
];

export function SalesClient({
  canVoid,
  canReturn,
  canSeeProfit,
}: {
  canVoid: boolean;
  canReturn: boolean;
  canSeeProfit: boolean;
}) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useAsync(
    () =>
      api<{ rows: Row[]; total: number }>(
        `/api/sales?q=${encodeURIComponent(q)}&page=${page}&pageSize=25`,
      ),
    [q, page],
  );
  const [open, setOpen] = useState<string | null>(null);
  const pages = Math.max(1, Math.ceil((list.data?.total ?? 0) / 25));
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sales</h1>
          <p className="text-sm text-muted">
            Every invoice of this branch. Posted invoices are never edited: void or return them.
          </p>
        </div>
        <input
          aria-label="Search invoices"
          className={`${inputClass} ms-auto w-64`}
          placeholder="Invoice number…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
      </div>
      <ErrorText message={list.error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">Invoice</th>
              <th>Date</th>
              <th className="text-end">Total</th>
              <th className="text-end">Paid</th>
              <th className="text-end">Due</th>
              <th className="px-4">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs">{r.docNo}</td>
                <td>{new Date(r.createdAt).toLocaleString()}</td>
                <td className="text-end tabular-nums">{pkr(r.grandTotalMinor)}</td>
                <td className="text-end tabular-nums">{pkr(r.paidMinor)}</td>
                <td className="text-end tabular-nums">{r.dueMinor > 0 ? pkr(r.dueMinor) : '–'}</td>
                <td className="px-4">
                  <Badge tone={r.status === 'posted' ? 'success' : 'danger'}>
                    {r.status === 'posted' ? 'Posted' : 'Void'}
                  </Badge>
                </td>
                <td className="px-4 text-end">
                  <Button variant="ghost" className="h-8 px-2" onClick={() => setOpen(r.id)}>
                    Open
                  </Button>
                </td>
              </tr>
            ))}
            {list.data && list.data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  No invoices yet.
                </td>
              </tr>
            ) : null}
            {!list.data && !list.error ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{list.data?.total ?? 0} invoices</span>
        <span className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 px-3"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          Page {page} of {pages}
          <Button
            variant="outline"
            className="h-8 px-3"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </span>
      </div>
      {open ? (
        <SaleDialog
          id={open}
          canVoid={canVoid}
          canReturn={canReturn}
          canSeeProfit={canSeeProfit}
          onClose={() => {
            setOpen(null);
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

function SaleDialog({
  id,
  canVoid,
  canReturn,
  canSeeProfit,
  onClose,
}: {
  id: string;
  canVoid: boolean;
  canReturn: boolean;
  canSeeProfit: boolean;
  onClose: () => void;
}) {
  const d = useAsync(() => api<{ sale: Detail }>(`/api/sales/${id}`));
  const modes = useAsync(() => api<{ paymentModes: PaymentMode[] }>('/api/lookups'));
  const [mode, setMode] = useState<'view' | 'void' | 'return'>('view');
  const [reason, setReason] = useState('');
  const [retQty, setRetQty] = useState<Record<string, string>>({});
  const [retReason, setRetReason] = useState('wrong_item');
  const [restock, setRestock] = useState(true);
  const [refundMode, setRefundMode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [need, setNeed] = useState<OverrideNeed | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sale = d.data?.sale;

  async function doVoid(overrideId?: string) {
    try {
      await api(`/api/sales/${id}/void`, { body: { reason, overrideId } });
      setNotice('Invoice voided. Stock has been put back.');
      setMode('view');
      d.reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OVERRIDE_REQUIRED')
        setNeed(e.details as OverrideNeed);
      else setError(e instanceof Error ? e.message : 'Could not void');
    }
  }

  async function doReturn(overrideId?: string) {
    if (!sale) return;
    const lines = sale.lines.flatMap((l) => {
      const n = Number(retQty[l.lineNo] ?? 0);
      return n > 0 ? [{ saleLineId: l.id, qtyBase: n, restock, lineNo: l.lineNo }] : [];
    });
    try {
      const r = await api<{ docNo: string; refundMinor: number }>(`/api/sales/${id}/return`, {
        body: {
          lines: lines.map(({ lineNo: _l, ...rest }) => rest),
          reasonCode: retReason,
          reasonText: reason || undefined,
          refundModeId: refundMode || modes.data?.paymentModes.find((m) => m.kind === 'cash')?.id,
          overrideId,
        },
      });
      setNotice(`Return ${r.docNo}: refund PKR ${pkr(r.refundMinor)}`);
      setMode('view');
      setRetQty({});
      d.reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OVERRIDE_REQUIRED')
        setNeed(e.details as OverrideNeed);
      else setError(e instanceof Error ? e.message : 'Could not return');
    }
  }

  return (
    <Modal title={sale ? `Invoice ${sale.docNo}` : 'Invoice'} onClose={onClose} wide>
      <ErrorText message={d.error} />
      {notice ? (
        <p role="status" className="mb-2 rounded-[6px] bg-primary-50 px-3 py-2 text-sm">
          {notice}
        </p>
      ) : null}
      {sale ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Badge tone={sale.status === 'posted' ? 'success' : 'danger'}>
              {sale.status === 'posted' ? 'Posted' : 'Void'}
            </Badge>
            <span className="text-muted">{new Date(sale.createdAt).toLocaleString()}</span>
            {sale.voidReason ? (
              <span className="text-danger">Reason: {sale.voidReason}</span>
            ) : null}
            <strong className="ms-auto text-lg">PKR {pkr(sale.grandTotalMinor)}</strong>
            {canSeeProfit && sale.profitMinor !== undefined ? (
              <span className="text-muted">Profit {pkr(sale.profitMinor)}</span>
            ) : null}
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-muted">
              <tr>
                <th className="py-2">#</th>
                <th>Item</th>
                <th className="text-end">Qty (smallest unit)</th>
                <th className="text-end">Amount</th>
                {mode === 'return' ? <th className="text-end">Return qty</th> : null}
              </tr>
            </thead>
            <tbody>
              {sale.lines.map((l) => (
                <tr key={l.lineNo} className="border-t border-border">
                  <td className="py-2 text-muted">{l.lineNo}</td>
                  <td>{l.name}</td>
                  <td className="text-end tabular-nums">{l.qtyBase}</td>
                  <td className="text-end tabular-nums">{pkr(l.netMinor)}</td>
                  {mode === 'return' ? (
                    <td className="text-end">
                      <input
                        aria-label={`Return quantity line ${l.lineNo}`}
                        className="h-8 w-20 rounded-[6px] border border-slate-400 px-2 text-end"
                        inputMode="numeric"
                        value={retQty[l.lineNo] ?? ''}
                        onChange={(e) => setRetQty({ ...retQty, [l.lineNo]: e.target.value })}
                      />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>

          {mode === 'void' ? (
            <div className="space-y-2 rounded-[10px] bg-surface p-3">
              <p className="text-sm text-muted">
                Voiding keeps the invoice in the books and puts the stock back. Only for a sale in
                your still-open shift.
              </p>
              <input
                aria-label="Reason for voiding"
                className={inputClass}
                placeholder="Reason (required)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <ErrorText message={error} />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setMode('view');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  disabled={reason.trim().length < 3}
                  onClick={() => void doVoid()}
                >
                  Void invoice
                </Button>
              </div>
            </div>
          ) : null}
          {mode === 'return' ? (
            <div className="space-y-2 rounded-[10px] bg-surface p-3">
              <p className="text-sm text-muted">
                Enter how many of the smallest units come back for each line. The refund is worked
                out from what the customer paid.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  aria-label="Return reason"
                  className={inputClass}
                  value={retReason}
                  onChange={(e) => setRetReason(e.target.value)}
                >
                  {REASONS.map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Refund method"
                  className={inputClass}
                  value={refundMode}
                  onChange={(e) => setRefundMode(e.target.value)}
                >
                  <option value="">Cash</option>
                  {modes.data?.paymentModes
                    .filter((m) => m.kind !== 'credit' && m.kind !== 'cash')
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={restock}
                    onChange={(e) => setRestock(e.target.checked)}
                  />{' '}
                  Put back on the shelf
                </label>
              </div>
              {retReason === 'other' ? (
                <input
                  aria-label="Describe the reason"
                  className={inputClass}
                  placeholder="Describe the reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              ) : null}
              <ErrorText message={error} />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setMode('view');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  disabled={!Object.values(retQty).some((v) => Number(v) > 0)}
                  onClick={() => void doReturn()}
                >
                  Give refund
                </Button>
              </div>
            </div>
          ) : null}
          {mode === 'view' && sale.status === 'posted' ? (
            <div className="flex justify-end gap-2">
              {canReturn ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setMode('return');
                    setNotice(null);
                  }}
                >
                  Return items
                </Button>
              ) : null}
              {canVoid ? (
                <Button
                  variant="danger"
                  onClick={() => {
                    setMode('void');
                    setNotice(null);
                  }}
                >
                  Void
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {need ? (
        <OverrideDialog
          need={need}
          onClose={() => setNeed(null)}
          onGranted={(oid) => {
            setNeed(null);
            void (mode === 'void' ? doVoid(oid) : doReturn(oid));
          }}
        />
      ) : null}
    </Modal>
  );
}
