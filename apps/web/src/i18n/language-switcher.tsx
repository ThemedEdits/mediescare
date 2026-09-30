'use client';

import { useState } from 'react';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from './core';
import { useLocale, useT } from './client';

/**
 * Switches between English and Urdu. When signed in (`persist`), the choice is saved on the user
 * through PATCH /api/me so it follows them to every terminal; otherwise only the cookie is set.
 */
export function LanguageSwitcher({ persist = false }: { persist?: boolean }) {
  const { locale } = useLocale();
  const t = useT();
  const [busy, setBusy] = useState(false);
  const target: Locale = locale === 'ur' ? 'en' : 'ur';

  async function switchTo() {
    setBusy(true);
    try {
      document.cookie = `${LOCALE_COOKIE}=${target}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
      if (persist) {
        const res = await fetch('/api/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: target }),
        });
        if (!res.ok) throw new Error('language not saved');
      }
      window.location.reload();
    } catch {
      setBusy(false);
      window.alert(t('common.error'));
    }
  }

  return (
    <button
      type="button"
      onClick={switchTo}
      disabled={busy}
      lang={target}
      aria-label={t('language.switchTo', { name: t(`language.${target}`) })}
      className="rounded-[6px] border border-border px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-primary-50 disabled:opacity-60"
    >
      {t(`language.${target}`)}
    </button>
  );
}
