'use client';

import { useState } from 'react';
import { api, Badge, Button, ErrorText, inputClass, Modal, useAsync } from '@/components/ui';
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

const AGING: [keyof LedgerResponse['ledger']['aging'], string][] = [
  ['notDue', 'Not due'],
  ['days1to30', '1–30 days'],
  ['days31to60', '31–60 days'],
  ['days61to90', '61–90 days'],
  ['over90', 'Over 90'],
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
  const { data, error, reload } = useAsync(
    () => api<LedgerResponse>(`/api/suppliers/${supplierId}/ledger`),
    [supplierId],
  );
  const [paying, setPaying] = useState<{ bill?: OpenBill } | null>(null);
  const l = data?.ledger;

  return (
    <Modal title={l ? `${l.supplier.name} · account` : 'Supplier account'} onClose={onClose} wide>
      <style>{'@media print { @page { size: A4; margin: 14mm; } }'}</style>
      <ErrorText message={error} />
      {l && data ? (
        <div className="space-y-4">
          <div id="doc-print" className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-lg font-semibold">{branchName} · Supplier statement</p>
                <p className="text-sm text-muted">
                  {l.supplier.name} · terms {l.supplier.termsDays} days
                </p>
              </div>
              <div className="text-end">
                <p className="text-xs text-muted">We owe</p>
                <p className="text-2xl font-bold tabular-nums" data-testid="ledger-balance">
                  PKR {pkr(l.balanceMinor)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-2 text-center text-sm">
              {AGING.map(([k, label]) => (
                <div
                  key={k}
                  className={`rounded-[6px] border border-border p-2 ${k === 'over90' && l.aging[k] > 0 ? 'bg-[#FEE2E2]' : ''}`}
                >
                  <p className="text-xs text-muted">{label}</p>
                  <p className="font-semibold tabular-nums">{pkr(l.aging[k])}</p>
                </div>
              ))}
            </div>
            <div className="max-h-[40vh] overflow-auto rounded-[10px] border border-border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2 text-left text-xs uppercase text-muted">
                  <tr>
                    <th className="px-2 py-2">Date</th>
                    <th>Document</th>
                    <th>Details</th>
                    <th className="text-end">Bills</th>
                    <th className="text-end">Paid</th>
                    <th className="px-2 text-end">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {l.entries.map((e, i) => (
                    <tr key={`${e.docNo}-${i}`} className="border-t border-border">
                      <td className="px-2 py-1">{e.date}</td>
                      <td className="font-mono text-xs">{e.docNo}</td>
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
              <p className="text-sm font-medium">Unpaid bills</p>
              {data.openBills.map((b) => (
                <div
                  key={b.grnId}
                  className="flex items-center justify-between rounded-[6px] border border-border px-3 py-1.5 text-sm"
                >
                  <span>
                    <span className="font-mono text-xs">{b.docNo}</span>{' '}
                    {b.supplierInvoiceNo ? `· ${b.supplierInvoiceNo}` : ''} · due {b.dueDate}
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
                        Pay
                      </Button>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => window.print()}>
              Print
            </Button>
            {canPay ? <Button onClick={() => setPaying({})}>Record payment</Button> : null}
          </div>
        </div>
      ) : (
        <p className="py-8 text-center text-muted">Loading…</p>
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
      setError(e instanceof Error ? e.message : 'Could not save the payment');
      setBusy(false);
    }
  }

  return (
    <Modal title={bill ? `Pay bill ${bill.docNo}` : 'Payment on account'} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          Amount (PKR)
          <input
            aria-label="Payment amount"
            autoFocus
            className={inputClass}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Paid by
          <select
            aria-label="Payment method"
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
          Reference (cheque / transfer no.)
          <input
            aria-label="Reference"
            className={inputClass}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <ErrorText message={error ?? modes.error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={busy || !minor || minor <= 0 || usable.length === 0}
          >
            {busy ? 'Saving…' : 'Save payment'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
