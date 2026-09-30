'use client';

import { useEffect, useState, type ComponentProps, type ReactNode } from 'react';

/** fetch wrapper for the app's own API. Throws an Error with a message safe to show to the user. */
export async function api<T = unknown>(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as {
    error?: {
      code?: string;
      message?: string;
      details?: unknown;
      problems?: string[];
      issues?: { message: string }[];
    };
  };
  if (!res.ok) {
    if (res.status === 401 && data.error?.code === 'UNAUTHENTICATED')
      window.location.assign('/login');
    if (res.status === 428) window.location.assign('/change-password');
    const e = data.error;
    throw new ApiError(
      e?.message ??
        e?.problems?.join('. ') ??
        e?.issues?.map((i) => i.message).join('. ') ??
        `Something went wrong (${res.status})`,
      e?.code ?? 'ERROR',
      res.status,
      e?.details,
    );
  }
  return data as T;
}

/** Error from the app's own API. `code` and `details` let screens react, for example to ask for a manager PIN. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Variant = 'primary' | 'outline' | 'danger' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary-600 text-white hover:bg-primary-700 active:bg-primary-800 disabled:bg-slate-300 disabled:text-slate-500',
  outline:
    'border border-primary-600 text-primary-600 hover:bg-primary-50 disabled:border-slate-300 disabled:text-slate-400',
  danger: 'bg-danger text-white hover:opacity-90 disabled:bg-slate-300 disabled:text-slate-500',
  ghost: 'text-primary-600 hover:bg-primary-50 disabled:text-slate-400',
};

export function Button({
  variant = 'primary',
  className = '',
  ...rest
}: ComponentProps<'button'> & { variant?: Variant }) {
  return (
    <button
      {...rest}
      className={`h-10 rounded-[6px] px-4 text-sm font-semibold disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
    />
  );
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'success' | 'danger' | 'warning';
  children: ReactNode;
}) {
  const tones = {
    neutral: 'bg-slate-100 text-slate-700',
    success: 'bg-[#E8F5E9] text-success',
    danger: 'bg-[#FEE2E2] text-danger',
    warning: 'bg-[#FEF3C7] text-warning',
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`mt-10 w-full rounded-[10px] bg-white p-6 shadow-xl ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-sm text-danger">
      {message}
    </p>
  ) : null;
}

/** One-time secret (temporary password, recovery key) with copy button. */
export function SecretBox({ label, value, note }: { label: string; value: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-[10px] border border-primary-600 bg-primary-50 p-4">
      <p className="text-sm font-medium">{label}</p>
      <p
        className="select-all break-all text-center font-mono text-lg font-semibold tracking-wide"
        data-testid="secret-value"
      >
        {value}
      </p>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      <Button
        variant="outline"
        className="w-full"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

export function useAsync<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    load()
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      alive = false;
    };
  }, [tick, ...deps]);
  return { data, error, reload: () => setTick((t) => t + 1) };
}

export const inputClass =
  'h-10 w-full rounded-[6px] border border-slate-400 bg-white px-3 text-sm text-slate-900 focus:border-primary-600 disabled:bg-slate-100';

/** Small "type a name" dialog. Replaces window.prompt(), which Electron does not support. */
export function NameDialog({
  title,
  label,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await onSubmit(value.trim());
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save');
            setBusy(false);
          }
        }}
      >
        <label className="block text-sm">
          {label}
          <input
            autoFocus
            className={`${inputClass} mt-1`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            required
          />
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || value.trim().length < 1}>
            {busy ? 'Saving…' : 'Add'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
