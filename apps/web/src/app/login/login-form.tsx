'use client';

import { useState, type FormEvent } from 'react';
import { Field, PrimaryButton } from '@/components/field';

export function LoginForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
    });
    if (res.ok) {
      window.location.assign('/');
      return;
    }
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    setError(body.error?.message ?? 'Sign in failed');
    setBusy(false);
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Sign in">
      <Field label="Username" name="username" autoComplete="username" required autoFocus />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </PrimaryButton>
    </form>
  );
}
