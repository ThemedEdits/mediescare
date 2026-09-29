'use client';

import { useState, type FormEvent } from 'react';
import { Field, PrimaryButton } from '@/components/field';
import { api } from '@/components/ui';

export function ChangePasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (f.get('newPassword') !== f.get('confirm'))
      return setError('The new passwords do not match');
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/change-password', {
        body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') },
      });
      window.location.assign('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not change the password');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Change password">
      <Field
        label="Current (or temporary) password"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
      />
      <Field
        label="New password (10+ characters)"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
      />
      <Field
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
      />
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save new password'}
      </PrimaryButton>
    </form>
  );
}
