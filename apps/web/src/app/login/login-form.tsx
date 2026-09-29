'use client';

import { useState, type FormEvent } from 'react';
import { Field, PrimaryButton } from '@/components/field';

export function LoginForm() {
  const [mode, setMode] = useState<'password' | 'pin'>('password');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const res = await fetch(mode === 'pin' ? '/api/auth/pin-login' : '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        mode === 'pin'
          ? { username: form.get('username'), pin: form.get('pin') }
          : { username: form.get('username'), password: form.get('password') },
      ),
    });
    if (res.ok) {
      window.location.assign('/');
      return;
    }
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    setError(body.error?.message ?? 'Sign in failed');
    setBusy(false);
  }

  const tab = (id: 'password' | 'pin', label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === id}
      onClick={() => {
        setMode(id);
        setError(null);
      }}
      className={`h-10 flex-1 border-b-2 text-sm font-medium ${mode === id ? 'border-primary-500 text-primary-600' : 'border-transparent text-muted hover:text-slate-900'}`}
    >
      {label}
    </button>
  );

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Sign in">
      <div role="tablist" className="flex">
        {tab('password', 'Password')}
        {tab('pin', 'Quick PIN (counter)')}
      </div>
      <Field label="Username" name="username" autoComplete="username" required autoFocus />
      {mode === 'password' ? (
        <Field
          key="pw"
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      ) : (
        <Field
          key="pin"
          label="PIN"
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          required
        />
      )}
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
