import Link from 'next/link';
import type { ReactNode } from 'react';
import { APP_NAME } from '@mediescare/config';
import { navFor, requirePage } from '@/server/page-auth';
import { SignOutButton } from '../sign-out-button';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = await requirePage();
  const nav = navFor(auth);
  return (
    <div className="min-h-screen bg-white">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-6 py-2">
        <div className="flex items-center gap-2">
          <img src="/brand/mediescare-icon.svg" alt="" className="h-8" />
          <span className="text-lg font-semibold">{APP_NAME}</span>
        </div>
        <nav aria-label="Main" className="flex gap-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[6px] px-3 py-2 text-sm font-medium text-slate-700 hover:bg-primary-50 hover:text-primary-600"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ms-auto flex items-center gap-3 text-sm text-muted">
          <span>
            {auth.branchName} · {auth.fullName}
            {auth.method === 'pin' ? ' (quick PIN)' : ''}
          </span>
          <Link href="/change-password" className="text-primary-600 hover:underline">
            Password
          </Link>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
