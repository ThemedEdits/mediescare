/**
 * Pure i18n logic (no React, no Next): locale resolution, direction, flattening and translation.
 * Kept free of framework imports so it is unit-tested directly and shared by server and client.
 */

export const LOCALES = ['en', 'ur'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** Cookie that remembers the language on the login page and before anyone has signed in. */
export const LOCALE_COOKIE = 'mediescare_lang';
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export type Messages = { [key: string]: string | Messages };
export type FlatMessages = Record<string, string>;
export type Params = Record<string, string | number>;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function dirOf(locale: Locale): 'ltr' | 'rtl' {
  return locale === 'ur' ? 'rtl' : 'ltr';
}

/** The signed-in user's language wins, then the cookie (login page), then English. */
export function resolveLocale(input: {
  userLanguage?: string | null;
  cookie?: string | null;
}): Locale {
  if (isLocale(input.userLanguage)) return input.userLanguage;
  if (isLocale(input.cookie)) return input.cookie;
  return DEFAULT_LOCALE;
}

/** { nav: { pos: 'POS' } } becomes { 'nav.pos': 'POS' }. */
export function flatten(messages: Messages, prefix = ''): FlatMessages {
  const out: FlatMessages = {};
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

/** Urdu overlaid on English, so a missing Urdu key shows the English text instead of a raw key. */
export function withFallback(primary: FlatMessages, fallback: FlatMessages): FlatMessages {
  return { ...fallback, ...primary };
}

const PLACEHOLDER = /\{(\w+)\}/g;

export function placeholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string).sort();
}

export function interpolate(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/** Last part of a key as words, used instead of a raw key when nothing at all is found in production. */
function humanize(key: string): string {
  const last = key.split('.').pop() ?? key;
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export type Translator = ((key: string, params?: Params) => string) & {
  has: (key: string) => boolean;
};

/**
 * Build a translator over already merged messages (see withFallback). A key that exists in no
 * language returns the key itself in development and tests (so it is noticed) and readable words in
 * production (so users never see `dashboard.salesToday`).
 */
export function createTranslator(messages: FlatMessages, production: boolean): Translator {
  const t = (key: string, params?: Params): string => {
    const text = messages[key];
    if (text === undefined) return production ? humanize(key) : key;
    return interpolate(text, params);
  };
  t.has = (key: string) => key in messages;
  return t;
}

/** Message key for a menu entry: '/' is dashboard, '/stock-take' is nav.stockTake. */
export function navKey(href: string): string {
  const slug = href.replace(/^\/+/, '').split('/')[0] ?? '';
  if (!slug) return 'nav.dashboard';
  return `nav.${slug.replace(/-(\w)/g, (_, c: string) => c.toUpperCase())}`;
}
