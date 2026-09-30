/**
 * ESC/POS receipt encoder for 58 mm and 80 mm thermal printers. Pure: no node imports, so the web app
 * can use it through the `@mediescare/core/escpos` subpath.
 *
 * Text is single-byte (code page CP858, which equals CP437/CP850 for the characters below). Anything the
 * code page cannot print (for example Urdu) is replaced by "?". Urdu on a thermal receipt needs RASTER
 * printing (the text drawn as a bitmap), which this encoder does NOT do.
 */
import { formatMinor } from './money';

export type PaperWidth = '58' | '80';
export type DrawerPin = 'pin2' | 'pin5';

/** Printable columns of the standard font A per paper width. */
export const COLUMNS: Record<PaperWidth, number> = { '80': 48, '58': 32 };

export interface ReceiptLine {
  name: string;
  /** Quantity as shown, for example "2". */
  qtyLabel: string;
  unitLabel: string;
  /** Rate per unit in paisa, shown only when given. */
  rateMinor?: number;
  amountMinor: number;
}

export interface ReceiptPayment {
  label: string;
  amountMinor: number;
}

export interface ReceiptData {
  headerLines: string[];
  branchName: string;
  docNo: string;
  /** Date and time already formatted for display. */
  dateTime: string;
  cashier: string;
  customer?: string;
  lines: ReceiptLine[];
  /** Sum of the line amounts (already after discount and with tax). Total = sub total + rounding. */
  subTotalMinor: number;
  /** Information only: discount already reflected in the line amounts. */
  discountMinor: number;
  /** Information only: tax already included in the line amounts. */
  taxMinor: number;
  roundingMinor: number;
  grandTotalMinor: number;
  payments: ReceiptPayment[];
  changeMinor: number;
  dueMinor: number;
  footerLines: string[];
  invoiceNote?: string;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** ESC @ : reset the printer. */
export const INIT = [ESC, 0x40];
/** ESC t 19 : select code page PC858 (Latin with euro). */
const CODE_PAGE_858 = [ESC, 0x74, 19];

/** Characters above 0x7F that CP858 (and CP437) print, mapped to their byte. */
const HIGH: Record<string, number> = {
  Ç: 0x80,
  ü: 0x81,
  é: 0x82,
  â: 0x83,
  ä: 0x84,
  à: 0x85,
  ç: 0x87,
  ê: 0x88,
  è: 0x8a,
  Ä: 0x8e,
  Ö: 0x99,
  Ü: 0x9a,
  '£': 0x9c,
  ñ: 0xa4,
  '°': 0xf8,
  '€': 0xd5,
  ß: 0xe1,
};

/** Keeps printable ASCII and the mapped Latin characters; everything else becomes "?". */
export function sanitize(text: string): string {
  let out = '';
  for (const ch of text.normalize('NFC')) {
    const code = ch.codePointAt(0) ?? 0;
    out += (code >= 0x20 && code <= 0x7e) || ch in HIGH ? ch : '?';
  }
  return out;
}

function toBytes(text: string): number[] {
  return Array.from(sanitize(text), (ch) => HIGH[ch] ?? ch.charCodeAt(0));
}

/** Word-wraps to `width` columns; words longer than a line are cut. Empty text gives no lines. */
export function wrapText(text: string, width: number): string[] {
  const words = sanitize(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (let word of words) {
    while (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!current) current = word;
    else if (current.length + 1 + word.length <= width) current += ` ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** `left` at the left edge and `right` at the right edge of `width` columns; `left` is cut if they collide. */
export function pair(left: string, right: string, width: number): string {
  const r = sanitize(right);
  const l = sanitize(left).slice(0, Math.max(0, width - r.length - 1));
  return l + ' '.repeat(Math.max(1, width - l.length - r.length)) + r;
}

export function money(amountMinor: number): string {
  return formatMinor(amountMinor);
}

class Builder {
  readonly bytes: number[] = [];
  constructor(readonly width: number) {}
  raw(...b: number[]): this {
    this.bytes.push(...b);
    return this;
  }
  align(a: 'left' | 'center' | 'right'): this {
    return this.raw(ESC, 0x61, a === 'left' ? 0 : a === 'center' ? 1 : 2);
  }
  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }
  /** GS ! : double height only, so the column count stays the same. */
  tall(on: boolean): this {
    return this.raw(GS, 0x21, on ? 0x01 : 0x00);
  }
  line(text = ''): this {
    return this.raw(...toBytes(text), LF);
  }
  wrapped(text: string): this {
    for (const l of wrapText(text, this.width)) this.line(l);
    return this;
  }
  centered(text: string): this {
    this.align('center');
    for (const l of wrapText(text, this.width)) this.line(l);
    return this.align('left');
  }
  rule(ch = '-'): this {
    return this.line(ch.repeat(this.width));
  }
  pair(left: string, right: string): this {
    return this.line(pair(left, right, this.width));
  }
}

/** Builds a complete receipt job: init, text, feed and partial cut. */
export function encodeReceipt(data: ReceiptData, paper: PaperWidth = '80'): Uint8Array {
  const b = new Builder(COLUMNS[paper]);
  b.raw(...INIT, ...CODE_PAGE_858);

  for (const h of data.headerLines) b.centered(h);
  b.bold(true).tall(true).centered(data.branchName);
  b.tall(false).bold(false);
  b.rule('=');
  b.pair('Bill', data.docNo);
  b.wrapped(data.dateTime);
  b.pair('Cashier', data.cashier);
  if (data.customer) b.pair('Customer', data.customer);
  b.rule();

  for (const l of data.lines) {
    b.wrapped(l.name);
    const rate = l.rateMinor === undefined ? '' : ` x ${money(l.rateMinor)}`;
    b.pair(`  ${l.qtyLabel} ${l.unitLabel}${rate}`.trimEnd(), money(l.amountMinor));
  }
  b.rule();

  b.pair('Sub total', money(data.subTotalMinor));
  if (data.discountMinor !== 0) b.pair('Discount given', money(data.discountMinor));
  if (data.taxMinor !== 0) b.pair('Tax included', money(data.taxMinor));
  if (data.roundingMinor !== 0) b.pair('Rounding', money(data.roundingMinor));
  b.bold(true).tall(true).pair('TOTAL', money(data.grandTotalMinor));
  b.tall(false).bold(false);
  for (const p of data.payments) b.pair(p.label, money(p.amountMinor));
  if (data.changeMinor > 0) b.pair('Change', money(data.changeMinor));
  if (data.dueMinor > 0) b.bold(true).pair('Due', money(data.dueMinor)).bold(false);
  b.rule();

  if (data.invoiceNote) b.wrapped(data.invoiceNote);
  for (const f of data.footerLines) b.centered(f);

  // Feed past the cutter, then partial cut (GS V 1).
  b.raw(ESC, 0x64, 4, GS, 0x56, 0x01);
  return Uint8Array.from(b.bytes);
}

/** ESC p m t1 t2 : pulse the drawer connector (pin2 or pin5) for 50 ms on, 500 ms off. */
export function drawerKick(pin: DrawerPin): Uint8Array {
  return Uint8Array.from([ESC, 0x70, pin === 'pin2' ? 0 : 1, 25, 250]);
}

/** Concatenates several print jobs into one byte stream. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A short test page that shows the paper width and prints the same characters a sale uses. */
export function encodeTestReceipt(paper: PaperWidth, printerName: string): Uint8Array {
  const b = new Builder(COLUMNS[paper]);
  b.raw(...INIT, ...CODE_PAGE_858);
  b.bold(true).tall(true).centered('Mediescare');
  b.tall(false).bold(false);
  b.centered('Test print');
  b.rule('=');
  b.pair('Printer', printerName || 'System default');
  b.pair('Paper', `${paper} mm`);
  b.pair('Columns', String(b.width));
  b.line('1234567890'.repeat(6).slice(0, b.width));
  b.pair('Sample item', money(123450));
  b.rule();
  b.centered('If you can read this, printing works.');
  b.raw(ESC, 0x64, 4, GS, 0x56, 0x01);
  return Uint8Array.from(b.bytes);
}
