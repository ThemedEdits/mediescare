'use client';

import { useState, type FormEvent } from 'react';
import { Field, PrimaryButton } from '@/components/field';
import { useT } from '@/i18n/client';
import { JoinForm } from './join-form';

type Mode = 'create' | 'join';

export function SetupForm() {
  const t = useT();
  const [mode, setMode] = useState<Mode>('create');
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErrors([]);
    const f = new FormData(event.currentTarget);
    if (f.get('password') !== f.get('confirm')) {
      setErrors([t('setupForm.mismatch')]);
      setBusy(false);
      return;
    }
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenantName: f.get('tenantName'),
        branchCode: String(f.get('branchCode') ?? '').toUpperCase(),
        branchName: f.get('branchName'),
        isHeadOffice: true,
        admin: {
          username: f.get('username'),
          fullName: f.get('fullName'),
          password: f.get('password'),
        },
      }),
    });
    if (res.ok) {
      const created = (await res.json()) as { recoveryKey: string };
      setRecoveryKey(created.recoveryKey);
      setBusy(false);
      return;
    }
    const body = (await res.json()) as {
      error?: { code?: string; problems?: string[]; issues?: { message: string }[] };
    };
    setErrors(
      body.error?.problems ??
        body.error?.issues?.map((i) => i.message) ?? [
          body.error?.code ?? t('setupForm.setupFailed'),
        ],
    );
    setBusy(false);
  }

  if (recoveryKey) return <RecoveryKeyScreen recoveryKey={recoveryKey} note={note} />;

  const tabs = (
    <div role="tablist" className="grid grid-cols-2 gap-2">
      {(
        [
          ['create', t('setupForm.tabCreate')],
          ['join', t('setupForm.tabJoin')],
        ] as const
      ).map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={mode === key}
          onClick={() => setMode(key)}
          className={`h-11 rounded-[6px] border px-2 text-sm font-medium ${mode === key ? 'border-primary-600 bg-primary-50 text-primary-900' : 'border-slate-300 text-slate-700 hover:bg-slate-50'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  if (mode === 'join')
    return (
      <div className="space-y-4">
        {tabs}
        <JoinForm
          onDone={(key, summary) => {
            setNote(summary);
            setRecoveryKey(key);
          }}
        />
      </div>
    );

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={t('setupForm.formLabel')}>
      {tabs}
      <Field label={t('setupForm.organisationName')} name="tenantName" required />
      <div className="grid grid-cols-3 gap-3">
        <Field
          label={t('setupForm.branchCode')}
          name="branchCode"
          placeholder="KHI01"
          required
          maxLength={8}
          dir="ltr"
        />
        <div className="col-span-2">
          <Field label={t('setupForm.branchName')} name="branchName" required />
        </div>
      </div>
      <p className="text-sm text-muted">{t('setupForm.headOfficeNote')}</p>
      <hr className="border-border" />
      <Field label={t('setupForm.fullName')} name="fullName" required />
      <Field
        label={t('setupForm.username')}
        name="username"
        autoComplete="username"
        dir="ltr"
        required
      />
      <Field
        label={t('setupForm.password')}
        name="password"
        type="password"
        autoComplete="new-password"
        required
      />
      <Field
        label={t('setupForm.confirm')}
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      {errors.length > 0 ? (
        <ul role="alert" className="list-disc ps-5 text-sm text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? t('setupForm.creating') : t('setupForm.create')}
      </PrimaryButton>
    </form>
  );
}

function RecoveryKeyScreen({ recoveryKey, note }: { recoveryKey: string; note: string | null }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <section className="space-y-4" aria-label={t('setupForm.recoveryLabel')}>
      <h2 className="text-xl font-semibold">{t('setupForm.recoveryTitle')}</h2>
      {note ? (
        <p role="status" className="rounded-[6px] bg-primary-50 px-4 py-2 text-sm text-primary-900">
          {note}
        </p>
      ) : null}
      <p className="text-sm text-muted">
        {t('setupForm.recoveryBefore')} <strong>{t('setupForm.recoveryOnce')}</strong>{' '}
        {t('setupForm.recoveryAfter')}
      </p>
      <p
        className="select-all rounded-[10px] border border-primary-600 bg-primary-50 p-4 text-center font-mono text-xl font-semibold tracking-wider"
        data-testid="recovery-key"
        dir="ltr"
      >
        {recoveryKey}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          className="h-11 flex-1 rounded-[6px] border border-primary-600 font-medium text-primary-600 hover:bg-primary-50"
          onClick={async () => {
            await navigator.clipboard.writeText(recoveryKey);
            setCopied(true);
          }}
        >
          {copied ? t('common.copied') : t('common.copy')}
        </button>
        <button
          type="button"
          className="h-11 flex-1 rounded-[6px] border border-primary-600 font-medium text-primary-600 hover:bg-primary-50"
          onClick={() => window.print()}
        >
          {t('common.print')}
        </button>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        {t('setupForm.savedCheck')}
      </label>
      <PrimaryButton
        type="button"
        disabled={!saved}
        onClick={() => window.location.assign('/login')}
      >
        {t('setupForm.continue')}
      </PrimaryButton>
    </section>
  );
}
