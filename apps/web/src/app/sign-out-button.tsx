'use client';

export function SignOutButton() {
  return (
    <button
      type="button"
      className="rounded-[6px] border border-primary-600 px-3 py-1.5 text-sm font-medium text-primary-600 hover:bg-primary-50"
      onClick={async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.assign('/login');
      }}
    >
      Sign out
    </button>
  );
}
