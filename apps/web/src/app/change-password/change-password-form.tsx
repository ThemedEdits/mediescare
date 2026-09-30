'use client';

import { useState, type FormEvent } from 'react';
import { Field, PrimaryButton } from '@/components/field';
import { api } from '@/components/ui';
import { useT } from '@/i18n/client';

export function ChangePasswordForm() {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (f.get('newPassword') !== f.get('confirm')) return setError(t('changePassword.mismatch'));
    setBusy(true);
    setError(null);
    try {
      await api('/api/auth/change-password', {
        body: { currentPassword: f.get('currentPassword'), newPassword: f.get('newPassword') },
      });
      window.location.assign('/');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('changePassword.failed'));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={t('changePassword.titleChange')}>
      <Field
        label={t('changePassword.current')}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
      />
      <Field
        label={t('changePassword.new')}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
      />
      <Field
        label={t('changePassword.confirm')}
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
        {busy ? t('changePassword.saving') : t('changePassword.save')}
      </PrimaryButton>
    </form>
  );
}
