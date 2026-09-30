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
  useErrorText,
} from '@/components/ui';
import { useT } from '@/i18n/client';
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

const REASONS = [
  'wrong_item',
  'damaged',
  'expired',
  'customer_changed_mind',
  'prescription_change',
  'other',
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
  const t = useT();
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
          <h1 className="text-2xl font-semibold">{t('sales.title')}</h1>
          <p className="text-sm text-muted">{t('sales.subtitle')}</p>
        </div>
        <input
          aria-label={t('sales.searchInvoices')}
          className={`${inputClass} ms-auto w-64`}
          placeholder={t('sales.invoicePlaceholder')}
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
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">{t('sales.col.invoice')}</th>
              <th>{t('common.date')}</th>
              <th className="text-end">{t('common.total')}</th>
              <th className="text-end">{t('sales.col.paid')}</th>
              <th className="text-end">{t('sales.col.due')}</th>
              <th className="px-4">{t('common.status')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono text-xs">
                  <bdi>{r.docNo}</bdi>
                </td>
                <td>
                  <bdi>{new Date(r.createdAt).toLocaleString()}</bdi>
                </td>
                <td className="text-end tabular-nums">{pkr(r.grandTotalMinor)}</td>
                <td className="text-end tabular-nums">{pkr(r.paidMinor)}</td>
                <td className="text-end tabular-nums">{r.dueMinor > 0 ? pkr(r.dueMinor) : '–'}</td>
                <td className="px-4">
                  <Badge tone={r.status === 'posted' ? 'success' : 'danger'}>
                    {r.status === 'posted' ? t('sales.status.posted') : t('sales.status.void')}
                  </Badge>
                </td>
                <td className="px-4 text-end">
                  <Button variant="ghost" className="h-8 px-2" onClick={() => setOpen(r.id)}>
                    {t('sales.open')}
                  </Button>
                </td>
              </tr>
            ))}
            {list.data && list.data.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  {t('sales.empty')}
                </td>
              </tr>
            ) : null}
            {!list.data && !list.error ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted">
                  {t('common.loading')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-sm text-muted">
        <span>{t('sales.count', { count: list.data?.total ?? 0 })}</span>
        <span className="flex items-center gap-2">
          <Button
            variant="outline"
            className="h-8 px-3"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('common.previous')}
          </Button>
          {t('sales.pageOf', { page, pages })}
          <Button
            variant="outline"
            className="h-8 px-3"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('common.next')}
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
  const t = useT();
  const errorText = useErrorText();
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
      setNotice(t('sales.voidedNotice'));
      setMode('view');
      d.reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OVERRIDE_REQUIRED')
        setNeed(e.details as OverrideNeed);
      else setError(errorText(e, 'sales.couldNotVoid'));
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
      setNotice(t('sales.returnNotice', { docNo: r.docNo, amount: pkr(r.refundMinor) }));
      setMode('view');
      setRetQty({});
      d.reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OVERRIDE_REQUIRED')
        setNeed(e.details as OverrideNeed);
      else setError(errorText(e, 'sales.couldNotReturn'));
    }
  }

  return (
    <Modal
      title={sale ? t('sales.invoiceTitle', { docNo: sale.docNo }) : t('sales.col.invoice')}
      onClose={onClose}
      wide
    >
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
              {sale.status === 'posted' ? t('sales.status.posted') : t('sales.status.void')}
            </Badge>
            <span className="text-muted">
              <bdi>{new Date(sale.createdAt).toLocaleString()}</bdi>
            </span>
            {sale.voidReason ? (
              <span className="text-danger">
                {t('sales.reasonLine', { reason: sale.voidReason })}
              </span>
            ) : null}
            <strong className="ms-auto text-lg">
              <bdi>{t('sales.totalPkr', { amount: pkr(sale.grandTotalMinor) })}</bdi>
            </strong>
            {canSeeProfit && sale.profitMinor !== undefined ? (
              <span className="text-muted">
                <bdi>{t('sales.profit', { amount: pkr(sale.profitMinor) })}</bdi>
              </span>
            ) : null}
          </div>
          <table className="w-full text-sm">
            <thead className="text-start text-xs uppercase text-muted">
              <tr>
                <th className="py-2">#</th>
                <th>{t('common.item')}</th>
                <th className="text-end">{t('sales.col.qtySmallest')}</th>
                <th className="text-end">{t('sales.col.amount')}</th>
                {mode === 'return' ? (
                  <th className="text-end">{t('sales.col.returnQty')}</th>
                ) : null}
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
                        aria-label={t('sales.returnQtyLine', { line: l.lineNo })}
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
              <p className="text-sm text-muted">{t('sales.voidHelp')}</p>
              <input
                aria-label={t('sales.voidReasonLabel')}
                className={inputClass}
                placeholder={t('sales.reasonRequired')}
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
                  {t('common.cancel')}
                </Button>
                <Button
                  variant="danger"
                  disabled={reason.trim().length < 3}
                  onClick={() => void doVoid()}
                >
                  {t('sales.voidInvoice')}
                </Button>
              </div>
            </div>
          ) : null}
          {mode === 'return' ? (
            <div className="space-y-2 rounded-[10px] bg-surface p-3">
              <p className="text-sm text-muted">{t('sales.returnHelp')}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <select
                  aria-label={t('sales.returnReasonLabel')}
                  className={inputClass}
                  value={retReason}
                  onChange={(e) => setRetReason(e.target.value)}
                >
                  {REASONS.map((v) => (
                    <option key={v} value={v}>
                      {t('sales.reason.' + v)}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={t('sales.refundMethod')}
                  className={inputClass}
                  value={refundMode}
                  onChange={(e) => setRefundMode(e.target.value)}
                >
                  <option value="">{t('common.cash')}</option>
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
                  {t('sales.putBack')}
                </label>
              </div>
              {retReason === 'other' ? (
                <input
                  aria-label={t('sales.describeReason')}
                  className={inputClass}
                  placeholder={t('sales.describeReason')}
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
                  {t('common.cancel')}
                </Button>
                <Button
                  disabled={!Object.values(retQty).some((v) => Number(v) > 0)}
                  onClick={() => void doReturn()}
                >
                  {t('sales.giveRefund')}
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
                  {t('sales.returnItems')}
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
                  {t('sales.status.void')}
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
