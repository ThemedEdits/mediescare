'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { useT } from '@/i18n/client';

const EYE = 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z';

/** Eye icon (lucide "eye" / "eye-off" shapes), inline so no icon package is needed. */
function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={EYE} />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M3 3l18 18" /> : null}
    </svg>
  );
}

/**
 * Password, PIN or secret input with a show/hide button. Takes the same props as <input> (the type is
 * managed here). `className` styles the input itself; room is kept on the end side for the button.
 */
export function PasswordInput({
  className = '',
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const label = shown ? t('common.hidePassword') : t('common.showPassword');
  return (
    <span className="relative block">
      <input {...input} type={shown ? 'text' : 'password'} className={`${className} pe-10`} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={label}
        aria-pressed={shown}
        title={label}
        tabIndex={-1}
        className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-slate-500 hover:text-primary-600"
      >
        <EyeIcon off={shown} />
      </button>
    </span>
  );
}
