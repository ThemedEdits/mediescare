import Link from 'next/link';
import type { ReactNode } from 'react';
import { APP_NAME } from '@mediescare/config';
import { LanguageSwitcher } from '@/i18n/language-switcher';
import { navKey } from '@/i18n/core';
import { getT } from '@/i18n/server';
import { navFor, requirePage } from '@/server/page-auth';
import { SignOutButton } from '../sign-out-button';
import { NavLinks } from './nav-links';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const auth = await requirePage();
  const { t } = await getT();
  const nav = navFor(auth);
  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-40 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border bg-white px-6 py-2">
        <div className="flex items-center gap-2">
          <img src="/brand/mediescare-icon.svg" alt="" className="h-8" />
          <span className="text-lg font-semibold">{APP_NAME}</span>
        </div>
        <NavLinks
          label={t('nav.main')}
          items={nav.map((item) => ({
            href: item.href,
            text: t.has(navKey(item.href)) ? t(navKey(item.href)) : item.label,
          }))}
        />
        <div className="ms-auto flex items-center gap-3 text-sm text-muted">
          <span>
            {auth.branchName} · {auth.fullName}
            {auth.method === 'pin' ? ` (${t('topbar.quickPin')})` : ''}
          </span>
          <LanguageSwitcher persist />
          <Link href="/change-password" className="text-primary-600 hover:underline">
            {t('topbar.password')}
          </Link>
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
