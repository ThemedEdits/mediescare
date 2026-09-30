'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  createTranslator,
  DEFAULT_LOCALE,
  dirOf,
  type FlatMessages,
  type Locale,
  type Translator,
} from './core';

interface I18nValue {
  locale: Locale;
  messages: FlatMessages;
}

const I18nContext = createContext<I18nValue>({ locale: DEFAULT_LOCALE, messages: {} });

/** Mounted once in the root layout. `messages` already contains the English fallback. */
export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: FlatMessages;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/** Translator for client components: `const t = useT();` */
export function useT(): Translator {
  const { messages } = useContext(I18nContext);
  return useMemo(
    () => createTranslator(messages, process.env.NODE_ENV === 'production'),
    [messages],
  );
}

export function useLocale(): { locale: Locale; dir: 'ltr' | 'rtl' } {
  const { locale } = useContext(I18nContext);
  return { locale, dir: dirOf(locale) };
}
