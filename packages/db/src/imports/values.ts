/** Cell parsers for the item import. Money goes through the core helpers; nothing here uses floats for amounts. */
import { parseMoneyToMinor, parseRateToMicro } from '@mediescare/core';

/** `value: null` means the cell was blank. `ok: false` means it could not be understood. */
export type Parsed<T> = { ok: true; value: T | null } | { ok: false };

const BLANK_MARKERS = new Set(['', '-', '--', 'n/a', 'na', 'null', 'none', 'nil']);

/** Round a decimal written as text to at most `max` places (half up), without floating point. */
function roundDecimalText(text: string, max: number): string {
  const m = /^(-?)([\d,]*)\.(\d+)$/.exec(text);
  if (!m) return text;
  const [, sign = '', whole = '', frac = ''] = m;
  if (frac.length <= max) return text;
  let scaled = BigInt((whole.replace(/,/g, '') || '0') + frac.slice(0, max));
  if (frac.charCodeAt(max) >= 53) scaled += 1n;
  const digits = scaled.toString().padStart(max + 1, '0');
  return `${sign}${digits.slice(0, -max)}.${digits.slice(-max)}`;
}

function cleanNumberText(raw: string, places: number): string {
  let text = raw
    .trim()
    .replace(/^(rs\.?|pkr)\s*/i, '')
    .replace(/\s+/g, '');
  if (/e/i.test(text) && Number.isFinite(Number(text))) text = Number(text).toFixed(places);
  return roundDecimalText(text, places);
}

/** A per-unit rate or price in micro-PKR (up to 6 decimals; more are rounded). Negative is returned as-is. */
export function parseMicro(raw: string): Parsed<number> {
  if (BLANK_MARKERS.has(raw.trim().toLowerCase())) return { ok: true, value: null };
  try {
    return { ok: true, value: parseRateToMicro(cleanNumberText(raw, 6)) };
  } catch {
    return { ok: false };
  }
}

/** A quantity in stocking units, converted to whole smallest units. Fractions must land on a whole unit. */
export function parseQuantityBase(raw: string, packSize: number): Parsed<number> {
  const micro = parseMicro(raw);
  if (!micro.ok) return micro;
  if (micro.value === null) return micro;
  const scaled = BigInt(micro.value) * BigInt(packSize);
  if (scaled % 1_000_000n !== 0n) return { ok: false };
  const value = scaled / 1_000_000n;
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER))
    return { ok: false };
  return { ok: true, value: Number(value) };
}

/** Tax percent with up to 2 decimals as basis points (18 is 1800). */
export function parsePercentBp(raw: string): Parsed<number> {
  if (BLANK_MARKERS.has(raw.trim().toLowerCase())) return { ok: true, value: null };
  try {
    const text = cleanNumberText(raw.replace(/%/g, ''), 2);
    return { ok: true, value: parseMoneyToMinor(text) };
  } catch {
    return { ok: false };
  }
}

/** Units per pack: "30", "30.0", "1 pack = 30 tablets" or "30 tablets". Blank means 1. */
export function parsePackSize(raw: string): Parsed<number> {
  const text = raw.trim();
  if (BLANK_MARKERS.has(text.toLowerCase())) return { ok: true, value: null };
  const plain = /^(\d+)(?:\.0+)?$/.exec(text);
  const equation = /=\s*(\d+)(?:\.0+)?\b/.exec(text);
  const leading = /^(\d+)\s*[a-z]/i.exec(text);
  const found = plain?.[1] ?? equation?.[1] ?? leading?.[1];
  if (found === undefined) return { ok: false };
  const n = Number(found);
  return Number.isSafeInteger(n) ? { ok: true, value: n } : { ok: false };
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', '1', 't']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '0', 'f']);

export function parseBool(raw: string): Parsed<boolean> {
  const text = raw.trim().toLowerCase();
  if (BLANK_MARKERS.has(text)) return { ok: true, value: null };
  if (TRUE_WORDS.has(text)) return { ok: true, value: true };
  if (FALSE_WORDS.has(text)) return { ok: true, value: false };
  return { ok: false };
}

/** Status column: "Active" and "Inactive" as well as true/false. Anything unknown counts as active. */
export function parseActive(raw: string): boolean {
  const text = raw.trim().toLowerCase();
  return !['inactive', 'disabled', 'deactivated', 'deactive', 'false', 'no', 'n', '0'].includes(
    text,
  );
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function validDate(y: number, m: number, d: number): string | null {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return null;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const fullYear = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));

/**
 * Expiry as 'YYYY-MM-DD'. Accepts 2027-03-31, 31/03/2027 (day first), 03/2027 and Mar-2027
 * (month only means the last day of that month, which is how it is printed on packs).
 */
export function parseExpiry(raw: string): Parsed<string> {
  const text = raw.trim();
  if (BLANK_MARKERS.has(text.toLowerCase())) return { ok: true, value: null };
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  let date: string | null = null;
  // A date cell read without its style arrives as an Excel serial day number (47208 is 2029-03-31).
  if (/^\d{5}(?:\.\d+)?$/.test(text) && Number(text) >= 36526 && Number(text) < 73051)
    date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86_400_000)
      .toISOString()
      .slice(0, 10);
  else if (m) date = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text)))
    date = validDate(fullYear(m[3] as string), Number(m[2]), Number(m[1]));
  else if ((m = /^(\d{1,2})[/.-](\d{4})$/.exec(text))) {
    const y = Number(m[2]);
    date = validDate(y, Number(m[1]), lastDay(y, Number(m[1])));
  } else if ((m = /^(\d{4})[/.-](\d{1,2})$/.exec(text))) {
    const y = Number(m[1]);
    date = validDate(y, Number(m[2]), lastDay(y, Number(m[2])));
  } else if ((m = /^([a-z]{3})[a-z]*[ /.-](\d{2}|\d{4})$/i.exec(text))) {
    const month = MONTHS.indexOf((m[1] as string).toLowerCase()) + 1;
    const y = fullYear(m[2] as string);
    if (month > 0) date = validDate(y, month, lastDay(y, month));
  }
  return date ? { ok: true, value: date } : { ok: false };
}
