'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_CLOUD_URL } from '@mediescare/config';
import { Field, PrimaryButton } from '@/components/field';
import { useT } from '@/i18n/client';

interface Progress {
  stage: 'enrolling' | 'preparing' | 'syncing' | 'checking' | 'saving' | 'done';
  received: number;
  applied: number;
  byType: Record<string, number>;
}

/**
 * "Join an existing organisation": this PC becomes a branch. It needs internet once, for the
 * enrollment code and the first copy of Head Office's catalogue (this can take a few minutes for
 * a large catalogue). Nothing is created on this PC unless everything worked, so a failed attempt
 * can simply be repeated.
 */
export function JoinForm({ onDone }: { onDone: (recoveryKey: string, summary: string) => void }) {
  const t = useT();
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  // While the join request is busy, ask how far it has got once a second.
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/setup', { cache: 'no-store' });
        const data = (await res.json()) as { join?: { progress: Progress | null } | null };
        if (data.join?.progress) setProgress(data.join.progress);
      } catch {
        // the next tick tries again
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [busy]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    if (f.get('password') !== f.get('confirm')) {
      setErrors([t('setupForm.mismatch')]);
      return;
    }
    setBusy(true);
    setErrors([]);
    setProgress(null);
    try {
      const res = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'join',
          cloudUrl: f.get('cloudUrl'),
          code: f.get('code'),
          admin: {
            username: f.get('username'),
            fullName: f.get('fullName'),
            password: f.get('password'),
          },
        }),
      });
      const body = (await res.json()) as {
        recoveryKey?: string;
        branchCode?: string;
        items?: number;
        seconds?: number;
        error?: {
          code?: string;
          message?: string;
          problems?: string[];
          issues?: { message: string }[];
        };
      };
      if (res.ok && body.recoveryKey) {
        onDone(
          body.recoveryKey,
          t('setupForm.joined', {
            code: body.branchCode ?? '',
            items: body.items ?? 0,
            seconds: body.seconds ?? 0,
          }),
        );
        return;
      }
      setErrors(
        body.error?.message
          ? [body.error.message]
          : (body.error?.problems ??
              body.error?.issues?.map((i) => i.message) ?? [
                body.error?.code ?? t('setupForm.joinFailed'),
              ]),
      );
    } catch {
      setErrors([t('setupForm.connectionLost')]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label={t('setupForm.tabJoin')}>
      <p className="text-sm text-muted">{t('setupForm.joinHelp')}</p>
      <Field
        label={t('setupForm.cloudAddress')}
        name="cloudUrl"
        defaultValue={DEFAULT_CLOUD_URL}
        dir="ltr"
        placeholder="https://mediescare.example.com"
        inputMode="url"
        required
      />
      <Field
        label={t('setupForm.enrollmentCode')}
        name="code"
        autoComplete="off"
        dir="ltr"
        required
      />
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
      {busy ? (
        <div
          role="status"
          className="space-y-1 rounded-[6px] bg-primary-50 px-4 py-3 text-sm text-primary-900"
        >
          <p className="font-medium">{t(`setupForm.stage.${progress?.stage ?? 'enrolling'}`)}</p>
          {progress && progress.stage === 'syncing' ? (
            <p>
              {t('setupForm.received', {
                items: (progress.byType.items ?? 0).toLocaleString(),
                records: progress.applied.toLocaleString(),
              })}
            </p>
          ) : null}
          <p className="text-muted">{t('setupForm.keepOpen')}</p>
        </div>
      ) : null}
      {errors.length > 0 ? (
        <ul role="alert" className="list-disc ps-5 text-sm text-danger">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      <PrimaryButton type="submit" disabled={busy}>
        {busy ? t('setupForm.joining') : t('setupForm.join')}
      </PrimaryButton>
    </form>
  );
}
