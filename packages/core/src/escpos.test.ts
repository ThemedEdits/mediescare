import { describe, expect, it } from 'vitest';
import {
  COLUMNS,
  concatBytes,
  drawerKick,
  encodeReceipt,
  encodeTestReceipt,
  pair,
  sanitize,
  wrapText,
  type ReceiptData,
} from './escpos';

const decode = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');
/** Printable lines of a job (control bytes stripped), split on LF. */
const textLines = (bytes: Uint8Array) =>
  decode(bytes)
    .split('\n')
    // eslint-disable-next-line no-control-regex -- removing ESC/GS command bytes
    .map((l) => l.replace(/\x1b[@dEt\x61-\x7a].|\x1b[@]|\x1d[!V]./g, ''));

const sample: ReceiptData = {
  headerLines: ['Karachi Pharmacy'],
  branchName: 'Main Branch',
  docNo: 'KHI01-INV-000123',
  dateTime: '2026-09-30 10:15',
  cashier: 'Ali',
  lines: [
    {
      name: 'Panadol Extra 500mg Tablets Strip of Ten',
      qtyLabel: '2',
      unitLabel: 'Strip',
      amountMinor: 12050,
    },
    { name: 'Syrup', qtyLabel: '1', unitLabel: 'Btl', rateMinor: 5000, amountMinor: 5000 },
  ],
  subTotalMinor: 17050,
  discountMinor: 50,
  taxMinor: 0,
  roundingMinor: 0,
  grandTotalMinor: 17000,
  payments: [{ label: 'Cash', amountMinor: 20000 }],
  changeMinor: 3000,
  dueMinor: 0,
  footerLines: ['Thank you'],
};

describe('escpos commands', () => {
  it('drawer kick bytes for both pins', () => {
    expect([...drawerKick('pin2')]).toEqual([0x1b, 0x70, 0, 25, 250]);
    expect([...drawerKick('pin5')]).toEqual([0x1b, 0x70, 1, 25, 250]);
  });

  it('starts with init and code page, ends with feed and partial cut', () => {
    const out = encodeReceipt(sample, '80');
    expect([...out.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect([...out.slice(-6)]).toEqual([0x1b, 0x64, 4, 0x1d, 0x56, 0x01]);
  });

  it('uses bold and double height only around the total block', () => {
    const out = [...encodeReceipt(sample, '80')];
    const find = (seq: number[]) => out.findIndex((_, i) => seq.every((v, k) => out[i + k] === v));
    expect(find([0x1b, 0x45, 1, 0x1d, 0x21, 0x01])).toBeGreaterThan(0);
    expect(find([0x1d, 0x21, 0x00, 0x1b, 0x45, 0])).toBeGreaterThan(0);
  });

  it('concatenates jobs', () => {
    expect([...concatBytes(Uint8Array.of(1, 2), Uint8Array.of(3))]).toEqual([1, 2, 3]);
  });
});

describe('escpos layout', () => {
  it('has 48 and 32 columns', () => {
    expect(COLUMNS).toEqual({ '80': 48, '58': 32 });
  });

  it.each([
    ['80', 48],
    ['58', 32],
  ] as const)('never exceeds the width on %s mm', (paper, width) => {
    for (const l of textLines(encodeReceipt(sample, paper)))
      expect(l.length).toBeLessThanOrEqual(width);
  });

  it('right-aligns money at the last column', () => {
    const lines = textLines(encodeReceipt(sample, '80'));
    const sub = lines.find((l) => l.startsWith('Sub total'));
    expect(sub).toBe('Sub total' + ' '.repeat(48 - 9 - 8) + '170.50'.padStart(8));
    expect(sub?.length).toBe(48);
    const total = lines.find((l) => l.includes('TOTAL'));
    expect(total?.endsWith('170.00')).toBe(true);
    expect(total?.length).toBe(48);
  });

  it('formats money with formatMinor and no floating point artefacts', () => {
    const lines = textLines(encodeReceipt({ ...sample, grandTotalMinor: 100_000_007 }, '58'));
    expect(lines.some((l) => l.endsWith('1,000,000.07'))).toBe(true);
  });

  it('wraps long item names and puts the amount on the qty line', () => {
    const lines = textLines(encodeReceipt(sample, '58'));
    const at = lines.findIndex((l) => l.startsWith('Panadol Extra'));
    expect(lines[at]).toBe('Panadol Extra 500mg Tablets');
    expect(lines[at + 1]).toBe('Strip of Ten');
    expect(lines[at + 2]).toBe('  2 Strip' + ' '.repeat(32 - 9 - 6) + '120.50');
  });

  it('shows the rate only when given', () => {
    const lines = textLines(encodeReceipt(sample, '80'));
    expect(lines.some((l) => l.startsWith('  1 Btl x 50.00') && l.endsWith('50.00'))).toBe(true);
  });

  it('skips zero discount, tax and rounding rows and shows due', () => {
    const plain = textLines(
      encodeReceipt({ ...sample, discountMinor: 0, dueMinor: 500, changeMinor: 0 }, '80'),
    );
    expect(plain.some((l) => l.startsWith('Discount'))).toBe(false);
    expect(plain.some((l) => l.startsWith('Tax'))).toBe(false);
    expect(plain.some((l) => l.startsWith('Due'))).toBe(true);
    expect(plain.some((l) => l.startsWith('Change'))).toBe(false);
  });

  it('degrades Urdu to question marks and keeps Latin accents', () => {
    expect(sanitize('دوا')).toBe('???');
    const out = encodeReceipt({ ...sample, customer: 'Café' }, '80');
    expect(out.includes(0x82)).toBe(true);
    expect(sanitize('a\u0007b')).toBe('a?b');
  });

  it('wraps helpers', () => {
    expect(wrapText('', 10)).toEqual([]);
    expect(wrapText('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl']);
    expect(pair('abc', '12', 8)).toBe('abc   12');
    expect(pair('abcdefghij', '12', 8)).toBe('abcde 12');
  });

  it('prints a test page for both widths', () => {
    for (const p of ['58', '80'] as const) {
      const lines = textLines(encodeTestReceipt(p, 'POS-80'));
      expect(lines.some((l) => l.includes('Test print'))).toBe(true);
      for (const l of lines) expect(l.length).toBeLessThanOrEqual(COLUMNS[p]);
    }
  });
});
