'use client';

import { useState } from 'react';
import { api, Button, ErrorText, inputClass, Modal, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { localDate } from '../reports/report-format';
import { parseExpenseAmount } from './accounts-format';

export interface CategoryOption {
  id: string;
  name: string;
  isActive: boolean;
}
export interface ModeOption {
  id: string;
  name: string;
  kind: string;
}

/** Add an expense. "From the till" lowers the expected cash of the user's open shift. */
export function AddExpenseDialog({
  categories,
  modes,
  canBackdate,
  onClose,
  onSaved,
}: {
  categories: CategoryOption[];
  modes: ModeOption[];
  canBackdate: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const cash = modes.find((m) => m.kind === 'cash');
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? '');
  const [modeId, setModeId] = useState(cash?.id ?? modes[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(localDate(new Date()));
  const [payee, setPayee] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [fromTill, setFromTill] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isCash = modes.find((m) => m.id === modeId)?.kind === 'cash';
  const minor = parseExpenseAmount(amount);

  return (
    <Modal title={t('accounts.dialog.addTitle')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (minor === null) return setError(t('accounts.dialog.amountInvalid'));
          setBusy(true);
          setError(null);
          try {
            await api('/api/expenses', {
              body: {
                categoryId,
                modeId,
                amountMinor: minor,
                expenseDate: canBackdate || date === localDate(new Date()) ? date : undefined,
                payee,
                reference,
                note,
                fromTill: isCash && fromTill,
              },
            });
            onSaved();
          } catch (err) {
            setError(errorText(err, 'common.couldNotSave'));
            setBusy(false);
          }
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            {t('accounts.dialog.category')}
            <select
              className={inputClass}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              required
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            {t('accounts.dialog.amount')}
            <input
              autoFocus
              dir="ltr"
              inputMode="decimal"
              className={`${inputClass} text-end tabular-nums`}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </label>
          <label className="block text-sm">
            {t('accounts.dialog.paidBy')}
            <select
              className={inputClass}
              value={modeId}
              onChange={(e) => setModeId(e.target.value)}
              required
            >
              {modes.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            {t('accounts.dialog.date')}
            <input
              type="date"
              dir="ltr"
              className={inputClass}
              value={date}
              max={localDate(new Date())}
              disabled={!canBackdate || (isCash && fromTill)}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </label>
        </div>
        <label className="block text-sm">
          {t('accounts.dialog.payee')}
          <input
            className={inputClass}
            value={payee}
            maxLength={120}
            onChange={(e) => setPayee(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('accounts.dialog.reference')}
          <input
            dir="ltr"
            className={inputClass}
            value={reference}
            maxLength={80}
            onChange={(e) => setReference(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('accounts.dialog.note')}
          <input
            className={inputClass}
            value={note}
            maxLength={300}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {isCash ? (
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={fromTill}
              onChange={(e) => {
                setFromTill(e.target.checked);
                if (e.target.checked) setDate(localDate(new Date()));
              }}
            />
            <span>
              {t('accounts.dialog.fromTill')}
              <span className="block text-xs text-muted">{t('accounts.dialog.fromTillHint')}</span>
            </span>
          </label>
        ) : null}
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy || !categoryId || !modeId}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Void an expense: a reason is required and the expense stays in the list as void. */
export function VoidExpenseDialog({
  expense,
  onClose,
  onDone,
}: {
  expense: { id: string; docNo: string };
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t('accounts.void.title', { docNo: expense.docNo })} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await api(`/api/expenses/${encodeURIComponent(expense.id)}/void`, {
              body: { reason },
            });
            onDone();
          } catch (err) {
            setError(errorText(err, 'common.couldNotSave'));
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted">{t('accounts.void.explain')}</p>
        <label className="block text-sm">
          {t('common.reason')}
          <input
            autoFocus
            className={inputClass}
            value={reason}
            minLength={3}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" disabled={busy || reason.trim().length < 3}>
            {t('accounts.void.confirm')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
