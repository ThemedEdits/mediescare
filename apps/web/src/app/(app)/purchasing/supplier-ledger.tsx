'use client';

import { useState } from 'react';
import {
  api,
  Badge,
  Button,
  ErrorText,
  inputClass,
  Modal,
  useAsync,
  useErrorText,
} from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr, tryMinor } from '@/lib/format';

interface Entry {
  date: string;
  kind: 'opening' | 'bill' | 'payment';
  docNo: string;
  description: string;
  debitMinor: number;
  creditMinor: number;
  balanceMinor: number;
}
interface OpenBill {
  grnId: string;
  docNo: string;
  supplierInvoiceNo: string | null;
  dueDate: string;
  outstandingMinor: number;
}
interface LedgerResponse {
  ledger: {
    supplier: { id: string; name: string; termsDays: number };
    entries: Entry[];
    balanceMinor: number;
    aging: {
      notDue: number;
      days1to30: number;
      days31to60: number;
      days61to90: number;
      over90: number;
    };
  };
  openBills: OpenBill[];
}
interface Mode {
  id: string;
  name: string;
  kind: string;
}

const AGING: (keyof LedgerResponse['ledger']['aging'])[] = [
  'notDue',
  'days1to30',
  'days31to60',
  'days61to90',
  'over90',
];

/** Statement of account for one supplier, with ageing and a payment dialog. */
export function SupplierLedger({
  supplierId,
  branchName,
  canPay,
  onClose,
  onChanged,
}: {
  supplierId: string;
  branchName: string;
  canPay: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useT();
  const { data, error, reload } = useAsync(
    () => api<LedgerResponse>(`/api/suppliers/${supplierId}/ledger`),
    [supplierId],
  );
  const [paying, setPaying] = useState<{ bill?: OpenBill } | null>(null);
  const l = data?.ledger;

  return (
    <Modal
      title={
        l
          ? t('purchasing.ledger.accountTitle', { name: l.supplier.name })
          : t('purchasing.ledger.accountFallback')
      }
      onClose={onClose}
      wide
    >
      <style>{'@media print { @page { size: A4; margin: 14mm; } }'}</style>
      <ErrorText message={error} />
      {l && data ? (
        <div className="space-y-4">
          <div id="doc-print" className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-lg font-semibold">
                  {t('purchasing.ledger.statement', { branch: branchName })}
                </p>
                <p className="text-sm text-muted">
                  {t('purchasing.ledger.terms', {
                    name: l.supplier.name,
                    days: l.supplier.termsDays,
                  })}
                </p>
              </div>
              <div className="text-end">
                <p className="text-xs text-muted">{t('purchasing.suppliers.weOwe')}</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="ledger-balance">
                  <bdi>PKR {pkr(l.balanceMinor)}</bdi>
                </p>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2 text-center text-sm">
              {AGING.map((k) => (
                <div
                  key={k}
                  className={`rounded-[6px] border border-border p-2 ${k === 'over90' && l.aging[k] > 0 ? 'bg-[#FEE2E2]' : ''}`}
                >
                  <p className="text-xs text-muted">{t(`purchasing.ledger.aging.${k}`)}</p>
                  <p className="font-semibold tabular-nums">{pkr(l.aging[k])}</p>
                </div>
              ))}
            </div>
            <div className="max-h-[40vh] overflow-auto rounded-[10px] border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-start text-xs uppercase text-muted">
                  <tr>
                    <th className="px-2 py-2">{t('common.date')}</th>
                    <th>{t('purchasing.ledger.document')}</th>
                    <th>{t('purchasing.ledger.details')}</th>
                    <th className="text-end">{t('purchasing.ledger.bills')}</th>
                    <th className="text-end">{t('purchasing.bills.paid')}</th>
                    <th className="px-2 text-end">{t('purchasing.ledger.balance')}</th>
                  </tr>
                </thead>
                <tbody>
                  {l.entries.map((e, i) => (
                    <tr key={`${e.docNo}-${i}`} className="border-t border-border">
                      <td className="px-2 py-1">{e.date}</td>
                      <td className="font-mono text-xs">
                        <bdi>{e.docNo}</bdi>
                      </td>
                      <td>{e.description}</td>
                      <td className="text-end tabular-nums">
                        {e.debitMinor ? pkr(e.debitMinor) : ''}
                      </td>
                      <td className="text-end tabular-nums">
                        {e.creditMinor ? pkr(e.creditMinor) : ''}
                      </td>
                      <td className="px-2 text-end font-medium tabular-nums">
                        {pkr(e.balanceMinor)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.openBills.length > 0 ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('purchasing.ledger.unpaidBills')}</p>
              {data.openBills.map((b) => (
                <div
                  key={b.grnId}
                  className="flex items-center justify-between rounded-[6px] border border-border px-3 py-1.5 text-sm"
                >
                  <span>
                    <bdi className="font-mono text-xs">{b.docNo}</bdi>{' '}
                    {b.supplierInvoiceNo ? `· ${b.supplierInvoiceNo}` : ''} ·{' '}
                    {t('purchasing.ledger.due', { date: b.dueDate })}
                  </span>
                  <span className="flex items-center gap-2">
                    <Badge
                      tone={
                        b.dueDate < new Date().toISOString().slice(0, 10) ? 'danger' : 'neutral'
                      }
                    >
                      {pkr(b.outstandingMinor)}
                    </Badge>
                    {canPay ? (
                      <Button
                        variant="outline"
                        className="h-8 px-3"
                        onClick={() => setPaying({ bill: b })}
                      >
                        {t('purchasing.ledger.pay')}
                      </Button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              {t('common.print')}
            </Button>
            {canPay ? (
              <Button onClick={() => setPaying({})}>{t('purchasing.ledger.recordPayment')}</Button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="py-8 text-center text-muted">{t('common.loading')}</p>
      )}
      {paying ? (
        <PaymentDialog
          supplierId={supplierId}
          bill={paying.bill}
          defaultAmount={paying.bill?.outstandingMinor}
          onClose={() => setPaying(null)}
          onPaid={() => {
            setPaying(null);
            reload();
            onChanged();
          }}
        />
      ) : null}
    </Modal>
  );
}

function PaymentDialog({
  supplierId,
  bill,
  defaultAmount,
  onClose,
  onPaid,
}: {
  supplierId: string;
  bill?: OpenBill;
  defaultAmount?: number;
  onClose: () => void;
  onPaid: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const modes = useAsync(() => api<{ paymentModes: Mode[] }>('/api/lookups'));
  const [amount, setAmount] = useState(
    defaultAmount
      ? `${Math.trunc(defaultAmount / 100)}.${String(defaultAmount % 100).padStart(2, '0')}`
      : '',
  );
  const [modeId, setModeId] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usable = modes.data?.paymentModes.filter((m) => m.kind !== 'credit') ?? [];
  const minor = tryMinor(amount);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api('/api/supplier-payments', {
        body: {
          supplierId,
          grnId: bill?.grnId ?? null,
          amountMinor: minor,
          modeId: modeId || usable[0]?.id,
          reference: reference || undefined,
        },
      });
      onPaid();
    } catch (e) {
      setError(errorText(e, 'purchasing.ledger.couldNotSavePayment'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        bill
          ? t('purchasing.ledger.payBillTitle', { docNo: bill.docNo })
          : t('purchasing.ledger.payOnAccount')
      }
      onClose={onClose}
    >
      <div className="space-y-3">
        <label className="block text-sm">
          {t('purchasing.ledger.amountPkr')}
          <input
            aria-label={t('purchasing.ledger.amountAria')}
            autoFocus
            className={inputClass}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('purchasing.ledger.paidBy')}
          <select
            aria-label={t('purchasing.ledger.methodAria')}
            className={inputClass}
            value={modeId || usable[0]?.id || ''}
            onChange={(e) => setModeId(e.target.value)}
          >
            {usable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          {t('purchasing.ledger.reference')}
          <input
            aria-label={t('purchasing.ledger.referenceAria')}
            className={inputClass}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <ErrorText message={error ?? modes.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || !minor || minor <= 0 || usable.length === 0}
          >
            {busy ? t('common.saving') : t('purchasing.ledger.savePayment')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
