import type { InputHTMLAttributes } from 'react';

export function Field({ label, error, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-800">{label}</span>
      <input
        {...input}
        className="h-11 w-full rounded-[6px] border border-slate-400 bg-white px-3 text-base text-slate-900 focus:border-primary-600"
      />
      {error ? <span className="mt-1 block text-danger">{error}</span> : null}
    </label>
  );
}

export function PrimaryButton({ children, disabled, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled}
      className="h-11 w-full rounded-[6px] bg-primary-600 px-4 font-semibold text-white hover:bg-primary-700 active:bg-primary-800 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-500"
    >
      {children}
    </button>
  );
}
