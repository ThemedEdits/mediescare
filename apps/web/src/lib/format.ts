import { formatMinor, parseMoneyToMinor, parseRateToMicro } from '@mediescare/core/money';

/** "1,234.50" from paisa. Western digits in every language (ADR-0002). */
export const pkr = (minor: number): string => formatMinor(minor);

/** Per-unit rate in micro-PKR shown with 2 to 4 decimals, dropping needless zeros: 6.25, 4.1667. */
export function rate(micro: number): string {
  const s = (micro / 1_000_000).toFixed(4);
  return s.replace(/(\.\d{2})0+$/, '$1').replace(/\.(\d)0$/, '.$1');
}

/** Parse what a person typed into paisa, or null if it is not a valid amount. */
export function tryMinor(text: string): number | null {
  try {
    return text.trim() === '' ? null : parseMoneyToMinor(text.trim());
  } catch {
    return null;
  }
}

/** Parse a price typed per pack into micro-PKR, or null. */
export function tryMicro(text: string): number | null {
  try {
    return text.trim() === '' ? null : parseRateToMicro(text.trim());
  } catch {
    return null;
  }
}

export function newKey(): string {
  return `k-${crypto.randomUUID()}`;
}

export const today = (): string => new Date().toISOString().slice(0, 10);
