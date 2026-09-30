'use client';

import { useState, type FormEvent } from 'react';
import { Field, PrimaryButton } from '@/components/field';
import { useT } from '@/i18n/client';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, isLocale } from '@/i18n/core';

export function LoginForm() {
  const t = useT();
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
      // Remember the user's language for the next visit to this login page.
      const ok = (await res.json().catch(() => null)) as { user?: { language?: string } } | null;
      const lang = ok?.user?.language;
      if (isLocale(lang))
        document.cookie = `${LOCALE_COOKIE}=${lang}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
      window.location.assign('/');
      return;
    }
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    setError(body.error?.message ?? t('auth.signInFailed'));
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
    <form onSubmit={onSubmit} className="space-y-4" aria-label={t('auth.signIn')}>
      <div role="tablist" className="flex">
        {tab('password', t('auth.tabPassword'))}
        {tab('pin', t('auth.tabPin'))}
      </div>
      <Field
        label={t('auth.username')}
        name="username"
        dir="ltr"
        autoComplete="username"
        required
        autoFocus
      />
      {mode === 'password' ? (
        <Field
          key="pw"
          label={t('auth.password')}
          dir="ltr"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      ) : (
        <Field
          key="pin"
          label={t('auth.pin')}
          dir="ltr"
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
        {busy ? t('auth.signingIn') : t('auth.signIn')}
      </PrimaryButton>
    </form>
  );
}
