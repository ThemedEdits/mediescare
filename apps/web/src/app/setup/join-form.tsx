'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Field, PrimaryButton } from '@/components/field';

interface Progress {
  stage: 'enrolling' | 'preparing' | 'syncing' | 'checking' | 'saving' | 'done';
  received: number;
  applied: number;
  byType: Record<string, number>;
}

const STAGE_TEXT: Record<Progress['stage'], string> = {
  enrolling: 'Contacting the cloud…',
  preparing: 'Preparing this PC…',
  syncing: 'Receiving items and other data from Head Office…',
  checking: 'Checking the data…',
  saving: 'Saving…',
  done: 'Done',
};

/**
 * "Join an existing organisation": this PC becomes a branch. It needs internet once, for the
 * enrollment code and the first copy of Head Office's catalogue (this can take a few minutes for
 * a large catalogue). Nothing is created on this PC unless everything worked, so a failed attempt
 * can simply be repeated.
 */
export function JoinForm({ onDone }: { onDone: (recoveryKey: string, summary: string) => void }) {
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
      setErrors(['Passwords do not match']);
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
          `This PC is now branch ${body.branchCode ?? ''}. It received ${body.items ?? 0} items from Head Office in ${body.seconds ?? 0} s.`,
        );
        return;
      }
      setErrors(
        body.error?.message
          ? [body.error.message]
          : (body.error?.problems ??
              body.error?.issues?.map((i) => i.message) ?? [body.error?.code ?? 'Could not join']),
      );
    } catch {
      setErrors([
        'The connection was lost. Nothing was changed on this PC: check the internet and try again',
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" aria-label="Join an existing organisation">
      <p className="text-sm text-muted">
        Ask Head Office for an enrollment code (Head Office menu: Branches). You need the internet
        for this step only.
      </p>
      <Field
        label="Cloud address"
        name="cloudUrl"
        placeholder="https://mediescare.example.com"
        inputMode="url"
        required
      />
      <Field label="Enrollment code" name="code" autoComplete="off" required />
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
      {busy ? (
        <div
          role="status"
          className="space-y-1 rounded-[6px] bg-primary-50 px-4 py-3 text-sm text-primary-900"
        >
          <p className="font-medium">{STAGE_TEXT[progress?.stage ?? 'enrolling']}</p>
          {progress && progress.stage === 'syncing' ? (
            <p>
              {(progress.byType.items ?? 0).toLocaleString()} items,{' '}
              {progress.applied.toLocaleString()} records received
            </p>
          ) : null}
          <p className="text-muted">Keep this window open. This can take a few minutes.</p>
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
        {busy ? 'Joining…' : 'Join and continue'}
      </PrimaryButton>
    </form>
  );
}
