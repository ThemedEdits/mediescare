'use client';

import { useState } from 'react';
import { lineAmountMinor, unitRateFromPack } from '@mediescare/core/money';
import {
  api,
  Badge,
  Button,
  ErrorText,
  Modal,
  NameDialog,
  useAsync,
  useErrorText,
} from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr, rate } from '@/lib/format';
import type { EditablePo } from './po-form';
import type { ReceivePo } from '../stock/receive-form';

export interface PoLineView {
  lineNo: number;
  itemId: string;
  itemName: string;
  unitId: string;
  unitName: string;
  factorToBase: number;
  qtyUnits: number;
  orderedBase: number;
  receivedBase: number;
  remainingBase: number;
  unitPriceMicro: number;
}
export interface PoView {
  id: string;
  docNo: string;
  status: 'draft' | 'approved' | 'partial' | 'received' | 'cancelled';
  supplierId: string;
  supplierName: string;
  expectedDate: string | null;
  note: string | null;
  subTotalMinor: number;
  createdAt: string;
  approvedAt: string | null;
  cancelReason: string | null;
  version: number;
  lines: PoLineView[];
  receipts: { id: string; docNo: string; totalMinor: number; createdAt: string }[];
}

export const PO_TONE = {
  draft: 'neutral',
  approved: 'success',
  partial: 'warning',
  received: 'success',
  cancelled: 'danger',
} as const;

/** Status text for a purchase-order status value; unknown values show as they are. */
export function useStatusLabel(): (status: string) => string {
  const t = useT();
  return (status) =>
    t.has(`purchasing.status.${status}`) ? t(`purchasing.status.${status}`) : status;
}

export function PoDetail({
  id,
  branchName,
  canEdit,
  canApprove,
  canReceive,
  onClose,
  onChanged,
  onEdit,
  onReceive,
}: {
  id: string;
  branchName: string;
  canEdit: boolean;
  canApprove: boolean;
  canReceive: boolean;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (po: EditablePo) => void;
  onReceive: (po: ReceivePo) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const statusLabel = useStatusLabel();
  const {
    data,
    error: loadError,
    reload,
  } = useAsync(() => api<{ order: PoView }>(`/api/purchase-orders/${id}`), [id]);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const po = data?.order;

  async function approve() {
    setError(null);
    try {
      await api(`/api/purchase-orders/${id}/approve`, { method: 'POST', body: {} });
      reload();
      onChanged();
    } catch (e) {
      setError(errorText(e, 'purchasing.detail.couldNotApprove'));
    }
  }

  const amount = (l: PoLineView) =>
    lineAmountMinor(l.orderedBase, unitRateFromPack(l.unitPriceMicro, l.factorToBase));

  return (
    <Modal
      title={
        po
          ? t('purchasing.detail.title', { docNo: po.docNo })
          : t('purchasing.detail.titleFallback')
      }
      onClose={onClose}
      wide
    >
      <style>{'@media print { @page { size: A4; margin: 14mm; } }'}</style>
      <ErrorText message={loadError ?? error} />
      {po ? (
        <div className="space-y-4">
          <div id="doc-print" className="space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-lg font-semibold">
                  {t('purchasing.detail.heading', { branch: branchName })}
                </p>
                <p className="font-mono text-sm">
                  <bdi>{po.docNo}</bdi>
                </p>
              </div>
              <Badge tone={PO_TONE[po.status]}>{statusLabel(po.status)}</Badge>
            </div>
            <div className="grid gap-1 text-sm sm:grid-cols-2">
              <p>
                <span className="text-muted">{t('purchasing.detail.supplierLabel')} </span>
                <strong>{po.supplierName}</strong>
              </p>
              <p>
                <span className="text-muted">{t('purchasing.detail.dateLabel')} </span>
                {po.createdAt.slice(0, 10)}
              </p>
              <p>
                <span className="text-muted">{t('purchasing.detail.expectedLabel')} </span>
                {po.expectedDate ?? '–'}
              </p>
              {po.note ? (
                <p>
                  <span className="text-muted">{t('purchasing.detail.noteLabel')} </span>
                  {po.note}
                </p>
              ) : null}
              {po.cancelReason ? (
                <p className="text-danger">
                  {t('purchasing.detail.cancelled', { reason: po.cancelReason })}
                </p>
              ) : null}
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-border text-start text-xs uppercase text-muted">
                <tr>
                  <th className="py-1">#</th>
                  <th>{t('common.item')}</th>
                  <th>{t('purchasing.col.unit')}</th>
                  <th className="text-end">{t('purchasing.detail.ordered')}</th>
                  <th className="text-end">{t('purchasing.detail.received')}</th>
                  <th className="text-end">{t('common.price')}</th>
                  <th className="text-end">{t('purchasing.col.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => (
                  <tr key={l.lineNo} className="border-b border-border">
                    <td className="py-1">{l.lineNo}</td>
                    <td className="font-medium">{l.itemName}</td>
                    <td>{l.unitName}</td>
                    <td className="text-end tabular-nums">{l.qtyUnits}</td>
                    <td className="text-end tabular-nums">
                      {Math.floor(l.receivedBase / l.factorToBase)}
                    </td>
                    <td className="text-end tabular-nums">{rate(l.unitPriceMicro)}</td>
                    <td className="text-end tabular-nums">{pkr(amount(l))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6} className="pt-2 text-end font-semibold">
                    {t('common.total')}
                  </td>
                  <td className="pt-2 text-end font-bold tabular-nums">
                    <bdi>PKR {pkr(po.subTotalMinor)}</bdi>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {po.receipts.length > 0 ? (
            <p className="text-sm text-muted">
              {t('purchasing.detail.receivedOn')}{' '}
              <bdi>
                {po.receipts.map((r) => `${r.docNo} (${r.createdAt.slice(0, 10)})`).join(', ')}
              </bdi>
            </p>
          ) : null}

          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              {t('common.print')}
            </Button>
            {po.status === 'draft' && canEdit ? (
              <Button
                variant="outline"
                onClick={() =>
                  onEdit({
                    id: po.id,
                    version: po.version,
                    supplierId: po.supplierId,
                    expectedDate: po.expectedDate,
                    note: po.note,
                    lines: po.lines,
                  })
                }
              >
                {t('common.edit')}
              </Button>
            ) : null}
            {po.status === 'draft' && canApprove ? (
              <Button onClick={() => void approve()}>{t('purchasing.detail.approve')}</Button>
            ) : null}
            {(po.status === 'approved' || po.status === 'partial') && canReceive ? (
              <Button
                onClick={() =>
                  onReceive({
                    id: po.id,
                    docNo: po.docNo,
                    supplierId: po.supplierId,
                    lines: po.lines,
                  })
                }
              >
                {t('purchasing.detail.receiveGoods')}
              </Button>
            ) : null}
            {po.status !== 'cancelled' && po.status !== 'received' && canEdit ? (
              <Button variant="danger" onClick={() => setCancelling(true)}>
                {t('purchasing.detail.cancelOrder')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="py-8 text-center text-muted">{t('common.loading')}</p>
      )}
      {cancelling ? (
        <NameDialog
          title={t('purchasing.detail.cancelTitle')}
          label={t('common.reason')}
          submitLabel={t('purchasing.detail.cancelOrder')}
          onClose={() => setCancelling(false)}
          onSubmit={async (reason) => {
            await api(`/api/purchase-orders/${id}/cancel`, { body: { reason } });
            setCancelling(false);
            reload();
            onChanged();
          }}
        />
      ) : null}
    </Modal>
  );
}
