'use client';

import { useState, type FormEvent } from 'react';
import { Field, PrimaryButton } from '@/components/field';
import { JoinForm } from './join-form';

type Mode = 'create' | 'join';

export function SetupForm() {
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
      setErrors(['Passwords do not match']);
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
        body.error?.issues?.map((i) => i.message) ?? [body.error?.code ?? 'Setup failed'],
    );
    setBusy(false);
  }

  if (recoveryKey) return <RecoveryKeyScreen recoveryKey={recoveryKey} note={note} />;

  const tabs = (
    <div role="tablist" className="grid grid-cols-2 gap-2">
      {(
        [
          ['create', 'Create a new organisation'],
          ['join', 'Join an existing organisation'],
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
    <form onSubmit={onSubmit} className="space-y-4" aria-label="First-run setup">
      {tabs}
      <Field label="Organisation name" name="tenantName" required />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Branch code" name="branchCode" placeholder="KHI01" required maxLength={8} />
        <div className="col-span-2">
          <Field label="Branch name" name="branchName" required />
        </div>
      </div>
      <p className="text-sm text-muted">
        The first branch of a new organisation is Head Office (the main store). Other branches join
        it later.
      </p>
      <hr className="border-border" />
      <Field label="Your full name" name="fullName" required />
      <Field label="Username" name="username" autoComplete="username" required />
      <Field
        label="Password (10+ characters)"
        name="password"
        type="password"
        autoComplete="new-password"
        required
      />
      <Field
        label="Confirm password"
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
        {busy ? 'Creating…' : 'Create and continue'}
      </PrimaryButton>
    </form>
  );
}

function RecoveryKeyScreen({ recoveryKey, note }: { recoveryKey: string; note: string | null }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <section className="space-y-4" aria-label="Recovery key">
      <h2 className="text-xl font-semibold">Save your recovery key</h2>
      {note ? (
        <p role="status" className="rounded-[6px] bg-primary-50 px-4 py-2 text-sm text-primary-900">
          {note}
        </p>
      ) : null}
      <p className="text-sm text-muted">
        This key is the only way to open your backups on a new computer, or after this computer's
        Windows profile is lost. It is shown <strong>once</strong> and is not stored anywhere. Print
        it or write it down and keep it somewhere safe, away from this PC.
      </p>
      <p
        className="select-all rounded-[10px] border border-primary-600 bg-primary-50 p-4 text-center font-mono text-xl font-semibold tracking-wider"
        data-testid="recovery-key"
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
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button
          type="button"
          className="h-11 flex-1 rounded-[6px] border border-primary-600 font-medium text-primary-600 hover:bg-primary-50"
          onClick={() => window.print()}
        >
          Print
        </button>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4"
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
        />
        I have saved this recovery key in a safe place.
      </label>
      <PrimaryButton
        type="button"
        disabled={!saved}
        onClick={() => window.location.assign('/login')}
      >
        Continue to sign in
      </PrimaryButton>
    </section>
  );
}
