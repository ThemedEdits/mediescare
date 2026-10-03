'use client';

import { useState } from 'react';
import {
  api,
  Badge,
  Button,
  ErrorText,
  inputClass,
  Modal,
  NameDialog,
  useAsync,
  useErrorText,
} from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr, tryMinor } from '@/lib/format';

interface Entry {
  id: string;
  docNo: string;
  entryDate: string;
  kind: 'opening' | 'adjustment';
  amountMinor: number;
  note: string;
  status: 'posted' | 'void';
  voidReason: string | null;
}

const th = 'px-3 py-2 text-start';

/** Cash book entries: the opening balance (once) and corrections. Shown under the cash book. */
export function CashEntries({
  canAdjust,
  onChanged,
}: {
  canAdjust: boolean;
  onChanged: () => void;
}) {
  const t = useT();
  const { data, error, reload } = useAsync(() =>
    api<{ entries: Entry[] }>('/api/expenses/cash-adjustments'),
  );
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<Entry | null>(null);
  const hasOpening =
    data?.entries.some((e) => e.kind === 'opening' && e.status === 'posted') ?? false;

  return (
    <section className="no-print space-y-2 rounded-[10px] border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{t('accounts.entries.title')}</h3>
          <p className="text-xs text-muted">{t('accounts.entries.hint')}</p>
        </div>
        {canAdjust ? (
          <Button variant="outline" onClick={() => setAdding(true)}>
            {t('accounts.entries.add')}
          </Button>
        ) : null}
      </div>
      <ErrorText message={error} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted">
            <tr>
              <th className={th}>{t('common.date')}</th>
              <th className={th}>{t('accounts.entries.number')}</th>
              <th className={th}>{t('accounts.entries.type')}</th>
              <th className="px-3 py-2 text-end">{t('accounts.entries.amount')}</th>
              <th className={th}>{t('accounts.entries.note')}</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr
                key={e.id}
                className={`border-t border-border ${e.status === 'void' ? 'opacity-60' : ''}`}
              >
                <td className="px-3 py-2">
                  <bdi dir="ltr">{e.entryDate}</bdi>
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <bdi dir="ltr">{e.docNo}</bdi>
                </td>
                <td className="px-3 py-2">{t(`accounts.entries.kind.${e.kind}`)}</td>
                <td className="px-3 py-2 text-end tabular-nums">
                  <bdi dir="ltr">
                    {e.amountMinor < 0 ? `-${pkr(-e.amountMinor)}` : pkr(e.amountMinor)}
                  </bdi>
                </td>
                <td className="px-3 py-2">
                  {e.note}
                  {e.status === 'void' ? (
                    <span className="ms-2">
                      <Badge tone="danger">{t('accounts.entries.void')}</Badge> {e.voidReason}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-end">
                  {canAdjust && e.status === 'posted' ? (
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-danger"
                      onClick={() => setVoiding(e)}
                    >
                      {t('accounts.entries.voidAction')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {data && data.entries.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-muted">
                  {t('accounts.entries.empty')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {adding ? (
        <EntryDialog
          hasOpening={hasOpening}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            reload();
            onChanged();
          }}
        />
      ) : null}
      {voiding ? (
        <NameDialog
          title={t('accounts.entries.voidTitle', { number: voiding.docNo })}
          label={t('accounts.entries.voidReason')}
          submitLabel={t('accounts.entries.voidAction')}
          onClose={() => setVoiding(null)}
          onSubmit={async (reason) => {
            await api(`/api/expenses/cash-adjustments/${voiding.id}/void`, { body: { reason } });
            setVoiding(null);
            reload();
            onChanged();
          }}
        />
      ) : null}
    </section>
  );
}

function EntryDialog({
  hasOpening,
  onClose,
  onSaved,
}: {
  hasOpening: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [kind, setKind] = useState<'opening' | 'adjustment'>(hasOpening ? 'adjustment' : 'opening');
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const minor = tryMinor(amount);
  const valid = minor !== null && minor > 0 && note.trim().length >= 3;

  async function save() {
    if (minor === null) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/expenses/cash-adjustments', {
        body: {
          kind,
          amountMinor: kind === 'adjustment' && direction === 'remove' ? -minor : minor,
          entryDate: date || undefined,
          note: note.trim(),
        },
      });
      onSaved();
    } catch (e) {
      setError(errorText(e, 'accounts.entries.saveFailed'));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('accounts.entries.add')} onClose={onClose}>
      <div className="space-y-3">
        <label className="block text-sm">
          {t('accounts.entries.type')}
          <select
            aria-label={t('accounts.entries.type')}
            className={inputClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as 'opening' | 'adjustment')}
          >
            <option value="opening" disabled={hasOpening}>
              {t('accounts.entries.kind.opening')}
            </option>
            <option value="adjustment">{t('accounts.entries.kind.adjustment')}</option>
          </select>
        </label>
        {kind === 'adjustment' ? (
          <label className="block text-sm">
            {t('accounts.entries.direction')}
            <select
              aria-label={t('accounts.entries.direction')}
              className={inputClass}
              value={direction}
              onChange={(e) => setDirection(e.target.value as 'add' | 'remove')}
            >
              <option value="add">{t('accounts.entries.addCash')}</option>
              <option value="remove">{t('accounts.entries.removeCash')}</option>
            </select>
          </label>
        ) : null}
        <label className="block text-sm">
          {t('accounts.entries.amount')}
          <input
            aria-label={t('accounts.entries.amount')}
            className={inputClass}
            inputMode="decimal"
            dir="ltr"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          {t('common.date')}
          <input
            aria-label={t('common.date')}
            type="date"
            className={inputClass}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <span className="text-xs text-muted">{t('accounts.entries.dateHint')}</span>
        </label>
        <label className="block text-sm">
          {t('accounts.entries.noteLabel')}
          <input
            aria-label={t('accounts.entries.noteLabel')}
            className={inputClass}
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={busy || !valid}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
