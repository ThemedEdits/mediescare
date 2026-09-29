'use client';

import { useState, type FormEvent } from 'react';
import { Field, PrimaryButton } from '@/components/field';

export function SetupForm() {
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
        isHeadOffice: f.get('isHeadOffice') === 'on',
        admin: { username: f.get('username'), fullName: f.get('fullName'), password: f.get('password') },
      }),
    });
    if (res.ok) {
      window.location.assign('/login');
      return;
    }
    const body = (await res.json()) as {
      error?: { code?: string; problems?: string[]; issues?: { message: string }[] };
    };
    setErrors(body.error?.problems ?? body.error?.issues?.map((i) => i.message) ?? [body.error?.code ?? 'Setup failed']);
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="First-run setup">
      <Field label="Organisation name" name="tenantName" required />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Branch code" name="branchCode" placeholder="KHI01" required maxLength={8} />
        <div className="col-span-2">
          <Field label="Branch name" name="branchName" required />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isHeadOffice" defaultChecked className="h-4 w-4" />
        This is the Head Office (main store)
      </label>
      <hr className="border-border" />
      <Field label="Your full name" name="fullName" required />
      <Field label="Username" name="username" autoComplete="username" required />
      <Field label="Password (10+ characters)" name="password" type="password" autoComplete="new-password" required />
      <Field label="Confirm password" name="confirm" type="password" autoComplete="new-password" required />
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
