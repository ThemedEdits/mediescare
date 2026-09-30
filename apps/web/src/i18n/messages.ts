import en from './en.json';
import ur from './ur.json';
import { flatten, withFallback, type FlatMessages, type Locale, type Messages } from './core';

const flatEn = flatten(en as Messages);
const flatUr = flatten(ur as Messages);

/** Messages for a language with English filled in for anything not yet translated. */
export function messagesFor(locale: Locale): FlatMessages {
  return locale === 'ur' ? withFallback(flatUr, flatEn) : flatEn;
}
