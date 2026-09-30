import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN_FILES, UR_FILES, flatEn, flatUr } from './catalog';
import {
  createTranslator,
  dirOf,
  interpolate,
  isLocale,
  navKey,
  placeholders,
  resolveLocale,
  withFallback,
} from './core';
import { messagesFor } from './messages';

describe('message files', () => {
  it('no top-level namespace is defined in two files of the same language', () => {
    for (const files of [EN_FILES, UR_FILES]) {
      const seen = new Set<string>();
      for (const f of files)
        for (const ns of Object.keys(f)) {
          expect(seen.has(ns), ns).toBe(false);
          seen.add(ns);
        }
    }
    expect(EN_FILES.map((f) => Object.keys(f).sort())).toHaveLength(UR_FILES.length);
  });

  it('ur.json and en.json have exactly the same keys', () => {
    const missingInUr = Object.keys(flatEn).filter((k) => !(k in flatUr));
    const missingInEn = Object.keys(flatUr).filter((k) => !(k in flatEn));
    expect({ missingInUr, missingInEn }).toEqual({ missingInUr: [], missingInEn: [] });
  });

  it('placeholders match in every language', () => {
    for (const [key, text] of Object.entries(flatEn)) {
      expect(placeholders(flatUr[key] ?? ''), key).toEqual(placeholders(text));
    }
  });

  it('has no empty messages', () => {
    for (const [key, text] of [...Object.entries(flatEn), ...Object.entries(flatUr)])
      expect(text.trim(), key).not.toBe('');
  });

  it('keeps Western digits: no Arabic-Indic or Persian digits in Urdu text', () => {
    for (const [key, text] of Object.entries(flatUr)) expect(text, key).not.toMatch(/[٠-٩۰-۹]/);
  });

  it('every menu entry from navFor has a translation', () => {
    const hrefs = [
      '/',
      '/pos',
      '/sales',
      '/items',
      '/stock',
      '/stock-take',
      '/purchasing',
      '/reports',
      '/users',
      '/roles',
      '/settings',
      '/backups',
    ];
    for (const href of hrefs) expect(flatUr[navKey(href)], href).toBeTruthy();
  });
});

describe('locale resolution', () => {
  it('the signed-in user wins over the cookie', () => {
    expect(resolveLocale({ userLanguage: 'ur', cookie: 'en' })).toBe('ur');
    expect(resolveLocale({ userLanguage: 'en', cookie: 'ur' })).toBe('en');
  });
  it('uses the cookie when nobody is signed in', () => {
    expect(resolveLocale({ userLanguage: null, cookie: 'ur' })).toBe('ur');
  });
  it('falls back to English for missing or unknown values', () => {
    expect(resolveLocale({})).toBe('en');
    expect(resolveLocale({ userLanguage: 'fr', cookie: 'de' })).toBe('en');
    expect(resolveLocale({ userLanguage: 'fr', cookie: 'ur' })).toBe('ur');
  });
  it('validates locales', () => {
    expect(isLocale('ur')).toBe(true);
    expect(isLocale('xx')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
  it('Urdu is right-to-left, English left-to-right', () => {
    expect(dirOf('ur')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
});

describe('translation', () => {
  it('interpolates parameters and leaves unknown ones visible', () => {
    expect(interpolate('{count} invoices', { count: 3 })).toBe('3 invoices');
    expect(interpolate('{a} and {b}', { a: 'x' })).toBe('x and {b}');
  });

  it('falls back to English for a key missing in Urdu', () => {
    const merged = withFallback({ 'a.one': 'ایک' }, { 'a.one': 'One', 'a.two': 'Two' });
    const t = createTranslator(merged, true);
    expect(t('a.one')).toBe('ایک');
    expect(t('a.two')).toBe('Two');
  });

  it('never shows a raw key in production, but does in development', () => {
    expect(createTranslator({}, true)('dashboard.salesToday')).toBe('Sales today');
    expect(createTranslator({}, false)('dashboard.salesToday')).toBe('dashboard.salesToday');
  });

  it('serves real messages per locale, with English filling gaps', () => {
    const tUr = createTranslator(messagesFor('ur'), true);
    const tEn = createTranslator(messagesFor('en'), true);
    expect(tEn('common.save')).toBe('Save');
    expect(tUr('common.save')).not.toBe('Save');
    expect(tUr('dashboard.invoices', { count: 5 })).toContain('5');
    expect(tUr.has('nav.pos')).toBe(true);
    expect(tUr.has('nope')).toBe(false);
  });

  it('derives menu keys from hrefs', () => {
    expect(navKey('/')).toBe('nav.dashboard');
    expect(navKey('/pos')).toBe('nav.pos');
    expect(navKey('/stock-take')).toBe('nav.stockTake');
  });
});

describe('Urdu font ships with the app', () => {
  it('the woff2 files and licence are in public/fonts', () => {
    for (const f of [
      'noto-nastaliq-urdu-arabic-400-normal.woff2',
      'noto-nastaliq-urdu-arabic-700-normal.woff2',
      'OFL-NotoNastaliqUrdu.txt',
    ])
      expect(readFileSync(join(__dirname, '../../public/fonts', f)).length).toBeGreaterThan(1000);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'api' ? [] : sourceFiles(p);
    return /\.tsx?$/.test(name) && !name.endsWith('.test.ts') ? [p] : [];
  });
}

describe('translation keys used in code', () => {
  it("every literal t('a.b') call refers to a key that exists in both languages", () => {
    const missing: string[] = [];
    for (const file of sourceFiles(join(__dirname, '..'))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/\bt\(\s*'([A-Za-z]\w*(?:\.\w+)+)'/g)) {
        const key = m[1] as string;
        if (!(key in flatEn) || !(key in flatUr)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
