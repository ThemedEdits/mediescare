'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, Button, ErrorText, inputClass, Modal, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr, tryMinor } from '@/lib/format';
import {
  buildReceiptData,
  hasNativePrinting,
  printReceiptNative,
  type PrintSettings,
  type ReceiptPaymentInput,
} from '@/lib/receipt';
import type { Customer, Narcotic, OverrideNeed, SaleResult, Shift } from './pos-types';
import { PasswordInput } from '@/components/password-input';

function useAutoFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => ref.current?.focus(), []);
  return ref;
}

/** Manager PIN approval for one action (discount, price change, refund, void). The manager types their own PIN. */
export function OverrideDialog({
  need,
  onGranted,
  onClose,
}: {
  need: OverrideNeed;
  onGranted: (overrideId: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const ref = useAutoFocus<HTMLInputElement>();
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const what = {
    discount: t('pos.override.discount', { percent: ((need.percentBp ?? 0) / 100).toFixed(1) }),
    override_price: t('pos.override.overridePrice'),
    refund: t('pos.override.refund', { amount: pkr(need.amountMinor ?? 0) }),
    void: t('pos.override.void'),
  }[need.kind];
  const needsReason =
    need.kind === 'refund' ||
    need.kind === 'void' ||
    (need.kind === 'discount' && (need.percentBp ?? 0) >= 10_000);

  return (
    <Modal title={t('pos.override.title')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            const r = await api<{ overrideId: string }>('/api/overrides', {
              body: {
                approverUsername: username.trim(),
                approverPin: pin,
                kind: need.kind,
                percentBp: need.percentBp,
                amountMinor: need.amountMinor,
                reason: reason.trim() || undefined,
              },
            });
            onGranted(r.overrideId);
          } catch (err) {
            setError(errorText(err, 'pos.err.approvalRejected'));
            setPin('');
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted">{what}</p>
        <label className="block text-sm">
          {t('pos.override.username')}
          <input
            ref={ref}
            className={inputClass}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="off"
            required
          />
        </label>
        <label className="block text-sm">
          {t('pos.override.pin')}
          <PasswordInput
            className={`${inputClass} font-mono tracking-widest`}
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoComplete="off"
            required
          />
        </label>
        {needsReason ? (
          <label className="block text-sm">
            {t('common.reason')}
            <input
              className={inputClass}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </label>
        ) : null}
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={busy || !username || pin.length < 4 || (needsReason && !reason.trim())}
          >
            {busy ? t('pos.override.checking') : t('pos.override.approve')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Controlled items need the patient, CNIC and doctor (narcotic register). */
export function NarcoticDialog({
  itemName,
  initial,
  onSave,
  onClose,
}: {
  itemName: string;
  initial?: Narcotic;
  onSave: (n: Narcotic) => void;
  onClose: () => void;
}) {
  const t = useT();
  const ref = useAutoFocus<HTMLInputElement>();
  const [v, setV] = useState<Narcotic>(
    initial ?? { patientName: '', patientCnic: '', doctorName: '', prescriptionRef: '' },
  );
  const cnicOk = /^\d{5}-?\d{7}-?\d$/.test(v.patientCnic.trim());
  const ok = v.patientName.trim().length >= 2 && cnicOk && v.doctorName.trim().length >= 2;
  return (
    <Modal title={t('pos.narcotic.title')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onSave(v);
        }}
      >
        <p className="text-sm text-muted">
          <strong>{itemName}</strong> {t('pos.narcotic.introRest')}
        </p>
        <label className="block text-sm">
          {t('pos.narcotic.patientName')}
          <input
            ref={ref}
            className={inputClass}
            value={v.patientName}
            onChange={(e) => setV({ ...v, patientName: e.target.value })}
            required
          />
        </label>
        <label className="block text-sm">
          {t('pos.narcotic.patientCnic')}
          <input
            className={`${inputClass} font-mono`}
            placeholder="42101-1234567-1"
            value={v.patientCnic}
            onChange={(e) => setV({ ...v, patientCnic: e.target.value })}
            required
          />
          {v.patientCnic && !cnicOk ? (
            <span className="text-xs text-danger">{t('pos.narcotic.cnicHint')}</span>
          ) : null}
        </label>
        <label className="block text-sm">
          {t('pos.narcotic.doctorName')}
          <input
            className={inputClass}
            value={v.doctorName}
            onChange={(e) => setV({ ...v, doctorName: e.target.value })}
            required
          />
        </label>
        <label className="block text-sm">
          {t('pos.narcotic.prescriptionRef')}
          <input
            className={inputClass}
            value={v.prescriptionRef ?? ''}
            onChange={(e) => setV({ ...v, prescriptionRef: e.target.value })}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!ok}>
            {t('pos.narcotic.saveDetails')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function CustomerDialog({
  onPick,
  onClose,
}: {
  onPick: (c: Customer) => void;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const ref = useAutoFocus<HTMLInputElement>();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Customer[]>([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ customers: Customer[] }>(`/api/customers?q=${encodeURIComponent(q)}`)
        .then((r) => setList(r.customers))
        .catch((e: unknown) => setError(errorText(e, 'pos.err.searchFailed')));
    }, 150);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <Modal title={t('common.customer')} onClose={onClose}>
      <div className="space-y-3">
        <input
          ref={ref}
          className={inputClass}
          placeholder={t('pos.customer.searchPlaceholder')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-[6px] border border-border">
          {list.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-start hover:bg-primary-50"
                onClick={() => onPick(c)}
              >
                <span>
                  {c.name} <span className="text-xs text-muted">{c.phone ?? ''}</span>
                </span>
                <span className="font-mono text-xs text-muted">
                  {c.mrNo}
                  {c.isWalkin ? ` · ${t('pos.customer.walkin')}` : ''}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 ? (
            <li className="px-3 py-4 text-center text-sm text-muted">{t('pos.customer.none')}</li>
          ) : null}
        </ul>
        <ErrorText message={error} />
        {adding ? (
          <form
            className="space-y-2 rounded-[6px] bg-surface p-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              try {
                const r = await api<{ id: string; mrNo: string }>('/api/customers', {
                  body: {
                    name: f.get('name'),
                    phone: f.get('phone') || null,
                    creditLimitMinor: tryMinor(String(f.get('credit') ?? '')) ?? 0,
                  },
                });
                onPick({
                  id: r.id,
                  mrNo: r.mrNo,
                  name: String(f.get('name')),
                  phone: String(f.get('phone') ?? '') || null,
                  isWalkin: false,
                  creditLimitMinor: tryMinor(String(f.get('credit') ?? '')) ?? 0,
                });
              } catch (err) {
                setError(errorText(err, 'pos.err.couldNotAddCustomer'));
              }
            }}
          >
            <input
              name="name"
              className={inputClass}
              placeholder={t('pos.customer.fullName')}
              required
            />
            <input name="phone" className={inputClass} placeholder={t('pos.customer.phone')} />
            <input
              name="credit"
              className={inputClass}
              placeholder={t('pos.customer.creditLimit')}
              inputMode="decimal"
            />
            <Button type="submit" className="w-full">
              {t('pos.customer.add')}
            </Button>
          </form>
        ) : (
          <Button variant="outline" className="w-full" onClick={() => setAdding(true)}>
            {t('pos.customer.new')}
          </Button>
        )}
      </div>
    </Modal>
  );
}

export interface HoldRow {
  id: string;
  label: string | null;
  createdAt: string;
}

export function RecallDialog({
  onPick,
  onClose,
}: {
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [holds, setHolds] = useState<HoldRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () =>
    api<{ holds: HoldRow[] }>('/api/holds')
      .then((r) => setHolds(r.holds))
      .catch((e: unknown) => setError(errorText(e, 'pos.err.failed')));
  useEffect(() => {
    void load();
  }, []);
  return (
    <Modal title={t('pos.held.title')} onClose={onClose}>
      <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-[6px] border border-border">
        {holds?.map((h) => (
          <li key={h.id} className="flex items-center justify-between px-3 py-2">
            <button
              type="button"
              className="text-start hover:underline"
              onClick={() => onPick(h.id)}
            >
              {h.label || t('pos.held.heldCart')}{' '}
              <span className="text-xs text-muted">
                {new Date(h.createdAt).toLocaleTimeString()}
              </span>
            </button>
            <Button
              variant="ghost"
              className="h-8 px-2 text-danger"
              onClick={async () => {
                await api(`/api/holds/${h.id}`, { method: 'DELETE' }).catch((e: unknown) =>
                  setError(errorText(e, 'pos.err.failed')),
                );
                void load();
              }}
            >
              {t('common.delete')}
            </Button>
          </li>
        ))}
        {holds && holds.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-muted">{t('pos.held.empty')}</li>
        ) : null}
        {!holds ? (
          <li className="px-3 py-6 text-center text-sm text-muted">{t('common.loading')}</li>
        ) : null}
      </ul>
      <ErrorText message={error} />
    </Modal>
  );
}

export function MissedDialog({
  initialText,
  onClose,
  onSaved,
}: {
  initialText: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const ref = useAutoFocus<HTMLInputElement>();
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t('pos.missedSale')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          try {
            await api('/api/missed-sales', {
              body: {
                itemText: String(f.get('item')),
                qty: Number(f.get('qty')),
                customerPhone: String(f.get('phone') ?? '') || undefined,
              },
            });
            onSaved();
          } catch (err) {
            setError(errorText(err, 'common.couldNotSave'));
          }
        }}
      >
        <p className="text-sm text-muted">{t('pos.missed.intro')}</p>
        <label className="block text-sm">
          {t('common.item')}
          <input ref={ref} name="item" className={inputClass} defaultValue={initialText} required />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            {t('common.quantity')}
            <input
              name="qty"
              type="number"
              min={1}
              defaultValue={1}
              className={inputClass}
              required
            />
          </label>
          <label className="text-sm">
            {t('pos.missed.customerPhone')}
            <input name="phone" className={inputClass} />
          </label>
        </div>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit">{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function OpenShiftPanel({ onOpened }: { onOpened: () => void }) {
  const t = useT();
  const errorText = useErrorText();
  const ref = useAutoFocus<HTMLInputElement>();
  const [amount, setAmount] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const minor = tryMinor(amount);
  return (
    <div className="mx-auto mt-16 max-w-sm space-y-4 rounded-[10px] border border-border bg-surface p-6">
      <h1 className="text-xl font-semibold">{t('pos.openShift.title')}</h1>
      <p className="text-sm text-muted">{t('pos.openShift.intro')}</p>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (minor === null) return;
          try {
            await api('/api/shifts/open', { body: { floatMinor: minor } });
            onOpened();
          } catch (err) {
            setError(errorText(err, 'pos.err.couldNotOpenShift'));
          }
        }}
      >
        <label className="block text-sm">
          {t('pos.openShift.openingCash')}
          <input
            ref={ref}
            className={`${inputClass} text-lg`}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <ErrorText message={error} />
        <Button type="submit" className="w-full" disabled={minor === null}>
          {t('pos.openShift.open')}
        </Button>
      </form>
    </div>
  );
}

export function CloseShiftDialog({
  shift,
  onClosed,
  onClose,
}: {
  shift: Shift;
  onClosed: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const ref = useAutoFocus<HTMLInputElement>();
  const [counted, setCounted] = useState('');
  const [result, setResult] = useState<{
    expectedCashMinor: number;
    countedCashMinor: number;
    varianceMinor: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const minor = tryMinor(counted);
  if (result) {
    const v = result.varianceMinor;
    return (
      <Modal title={t('pos.closeShiftDlg.closedTitle')} onClose={onClosed}>
        <div className="space-y-2 text-sm">
          <Row
            label={t('pos.closeShiftDlg.expected')}
            value={`PKR ${pkr(result.expectedCashMinor)}`}
          />
          <Row
            label={t('pos.closeShiftDlg.youCounted')}
            value={`PKR ${pkr(result.countedCashMinor)}`}
          />
          <Row
            label={t('pos.closeShiftDlg.difference')}
            value={`${v > 0 ? '+' : ''}${pkr(v)}`}
            tone={v === 0 ? 'ok' : 'bad'}
          />
          <p className="text-muted">
            {v === 0
              ? t('pos.closeShiftDlg.matches')
              : v > 0
                ? t('pos.closeShiftDlg.over')
                : t('pos.closeShiftDlg.short')}
          </p>
        </div>
        <Button className="mt-4 w-full" onClick={onClosed}>
          {t('common.done')}
        </Button>
      </Modal>
    );
  }
  return (
    <Modal title={t('pos.closeShiftDlg.title', { docNo: shift.docNo })} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (minor === null) return;
          try {
            setResult(
              await api('/api/shifts/close', {
                body: { shiftId: shift.id, countedCashMinor: minor },
              }),
            );
          } catch (err) {
            setError(errorText(err, 'pos.err.couldNotCloseShift'));
          }
        }}
      >
        <p className="text-sm text-muted">{t('pos.closeShiftDlg.intro')}</p>
        <label className="block text-sm">
          {t('pos.closeShiftDlg.counted')}
          <input
            ref={ref}
            className={`${inputClass} text-lg`}
            inputMode="decimal"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
          />
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={minor === null}>
            {t('pos.closeShift')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <strong
        dir="ltr"
        className={tone === 'bad' ? 'text-danger' : tone === 'ok' ? 'text-success' : ''}
      >
        {value}
      </strong>
    </div>
  );
}

/**
 * After saving: the change to give back (big) and the receipt. In the desktop app the receipt goes to
 * the thermal printer (ESC/POS) and opens the drawer on cash; in a plain browser, or when native
 * printing fails, it falls back to the browser print dialog. The sale is already saved either way.
 */
export function ReceiptDialog({
  sale,
  branchName,
  cashier,
  lineUnit,
  payments,
  customerName,
  settings,
  onNew,
}: {
  sale: SaleResult;
  branchName: string;
  cashier: string;
  lineUnit: (unitId: string) => string;
  payments: ReceiptPaymentInput[];
  customerName?: string;
  settings: PrintSettings;
  onNew: () => void;
}) {
  const t = useT();
  const ref = useAutoFocus<HTMLButtonElement>();
  const [printError, setPrintError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [when] = useState(() => new Date().toLocaleString());
  const autoDone = useRef(false);

  /** Returns false when the native attempt failed (the message is shown). */
  const printNative = async (): Promise<boolean> => {
    setPrinting(true);
    const data = buildReceiptData(
      sale,
      { branchName, cashier, customer: customerName, dateTime: when, lineUnit, payments },
      settings,
    );
    const result = await printReceiptNative(data, settings, {
      openDrawer: payments.some((p) => p.cash),
    });
    setPrinting(false);
    setPrintError(result.ok ? null : (result.error ?? t('pos.err.printingFailed')));
    return result.ok;
  };
  const printClick = async () => {
    if (hasNativePrinting() && (await printNative())) return;
    window.print();
  };
  useEffect(() => {
    if (autoDone.current || !settings.autoPrint || !hasNativePrinting()) return;
    autoDone.current = true;
    void printNative();
  }, []);
  return (
    <Modal title={t('pos.saved.title', { docNo: sale.docNo })} onClose={onNew}>
      <div className="space-y-3">
        {sale.changeMinor > 0 ? (
          <div className="rounded-[10px] bg-[#E8F5E9] p-4 text-center">
            <p className="text-sm text-success">{t('pos.saved.giveBack')}</p>
            <p className="text-4xl font-bold text-success" data-testid="change-due">
              {pkr(sale.changeMinor)}
            </p>
          </div>
        ) : null}
        <div className="flex justify-between text-sm">
          <span className="text-muted">{t('common.total')}</span>
          <strong dir="ltr">PKR {pkr(sale.grandTotalMinor)}</strong>
        </div>
        {sale.dueMinor > 0 ? (
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t('pos.saved.onAccount')}</span>
            <strong dir="ltr">PKR {pkr(sale.dueMinor)}</strong>
          </div>
        ) : null}
        {sale.profitMinor !== undefined ? (
          <div className="flex justify-between text-sm">
            <span className="text-muted">{t('pos.saved.profit')}</span>
            <strong dir="ltr">PKR {pkr(sale.profitMinor)}</strong>
          </div>
        ) : null}
        <ErrorText message={printError} />
        <div id="receipt" className="hidden print:block">
          <Receipt sale={sale} branchName={branchName} cashier={cashier} lineUnit={lineUnit} />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            disabled={printing}
            onClick={() => void printClick()}
          >
            {printing ? t('pos.saved.printing') : t('pos.saved.printReceipt')}
          </Button>
          <Button ref={ref} className="flex-1" onClick={onNew}>
            {t('pos.saved.newSale')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Receipt({
  sale,
  branchName,
  cashier,
  lineUnit,
}: {
  sale: SaleResult;
  branchName: string;
  cashier: string;
  lineUnit: (unitId: string) => string;
}): ReactNode {
  return (
    <div style={{ width: '72mm', fontFamily: 'monospace', fontSize: '12px', color: '#000' }}>
      <div style={{ textAlign: 'center', fontWeight: 700 }}>Mediescare</div>
      <div style={{ textAlign: 'center' }}>{branchName}</div>
      <div>{sale.docNo}</div>
      <div>
        {new Date().toLocaleString()} · {cashier}
      </div>
      <hr />
      {sale.lines.map((l) => (
        <div key={l.lineNo} style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>
            {l.name} x{l.qtyUnits} {lineUnit(l.unitId)}
          </span>
          <span>{pkr(l.netMinor)}</span>
        </div>
      ))}
      <hr />
      {sale.discountMinor > 0 ? (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Discount</span>
          <span>-{pkr(sale.discountMinor)}</span>
        </div>
      ) : null}
      {sale.taxMinor > 0 ? (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Tax</span>
          <span>{pkr(sale.taxMinor)}</span>
        </div>
      ) : null}
      {sale.roundingMinor !== 0 ? (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Rounding</span>
          <span>{pkr(sale.roundingMinor)}</span>
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span>TOTAL</span>
        <span>{pkr(sale.grandTotalMinor)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Paid</span>
        <span>{pkr(sale.paidMinor)}</span>
      </div>
      {sale.changeMinor > 0 ? (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Change</span>
          <span>{pkr(sale.changeMinor)}</span>
        </div>
      ) : null}
      {sale.dueMinor > 0 ? (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Due</span>
          <span>{pkr(sale.dueMinor)}</span>
        </div>
      ) : null}
      <hr />
      <div style={{ textAlign: 'center' }}>Thank you</div>
    </div>
  );
}
