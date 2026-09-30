import { flatEn, flatUr } from './catalog';
import { withFallback, type FlatMessages, type Locale } from './core';

/** Messages for a language with English filled in for anything not yet translated. */
export function messagesFor(locale: Locale): FlatMessages {
  return locale === 'ur' ? withFallback(flatUr, flatEn) : flatEn;
}
