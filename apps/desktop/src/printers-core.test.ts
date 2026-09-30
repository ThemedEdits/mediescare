import { describe, expect, it } from 'vitest';
import {
  MAX_PRINT_BYTES,
  RAW_PRINT_SCRIPT,
  buildPowerShellArgs,
  clampCopies,
  decodePayload,
  drawerKickBytes,
  friendlyPrintError,
  parseWinPrinters,
  isValidPrinterName,
} from './printers-core';

describe('printer name validation', () => {
  it.each(['POS-80', 'EPSON TM-T20III Receipt', '\\\\server\\Front Desk (2)', 'XP-80C_1'])(
    'accepts %s',
    (n) => expect(isValidPrinterName(n)).toBe(true),
  );
  it.each(['', ' lead', 'a"b', 'a;calc', 'a`b', 'a$(x)', 'a|b', 'a\nb', 'a<b', 'x'.repeat(201)])(
    'rejects %j',
    (n) => expect(isValidPrinterName(n)).toBe(false),
  );
  it('rejects non strings', () => {
    expect(isValidPrinterName(undefined)).toBe(false);
    expect(isValidPrinterName(42)).toBe(false);
  });
});

describe('payload decoding', () => {
  it('decodes valid base64', () => {
    const r = decodePayload(Buffer.from([0x1b, 0x40, 0x41]).toString('base64'));
    expect(r.ok && [...r.bytes]).toEqual([0x1b, 0x40, 0x41]);
  });
  it('rejects empty, malformed and oversized data', () => {
    expect(decodePayload('').ok).toBe(false);
    expect(decodePayload(undefined).ok).toBe(false);
    expect(decodePayload('not base64!').ok).toBe(false);
    expect(decodePayload('abc').ok).toBe(false);
    const big = Buffer.alloc(MAX_PRINT_BYTES + 1).toString('base64');
    expect(decodePayload(big).ok).toBe(false);
    expect(decodePayload(Buffer.alloc(MAX_PRINT_BYTES).toString('base64')).ok).toBe(true);
  });
});

describe('command building', () => {
  it('passes the printer name as its own argument, never inside a string', () => {
    const name = "My Printer' ; calc";
    const args = buildPowerShellArgs('C:\\t\\s.ps1', name, 'C:\\t\\j.bin', 2);
    expect(args[args.indexOf('-PrinterName') + 1]).toBe(name);
    expect(args[args.indexOf('-File') + 1]).toBe('C:\\t\\s.ps1');
    expect(args[args.indexOf('-Copies') + 1]).toBe('2');
    expect(args.filter((a) => a.includes('calc'))).toEqual([name]);
  });
  it('script uses no string interpolation of the printer name and sends RAW', () => {
    expect(RAW_PRINT_SCRIPT).toContain('"RAW"');
    expect(RAW_PRINT_SCRIPT).toContain('Mandatory = $true');
    expect(RAW_PRINT_SCRIPT).not.toMatch(/Invoke-Expression|iex /i);
  });
  it('drawer bytes', () => {
    expect([...(drawerKickBytes('pin2') ?? [])]).toEqual([0x1b, 0x70, 0, 25, 250]);
    expect([...(drawerKickBytes('pin5') ?? [])]).toEqual([0x1b, 0x70, 1, 25, 250]);
    expect(drawerKickBytes('pin3')).toBeNull();
  });
  it('clamps copies', () => {
    expect(clampCopies(undefined)).toBe(1);
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(2)).toBe(2);
    expect(clampCopies(99)).toBe(5);
    expect(clampCopies(1.5)).toBe(1);
  });
});

describe('friendly errors', () => {
  it('explains the common failures', () => {
    expect(friendlyPrintError('ERR:open:1801', false, 'POS')).toMatch(/not found/);
    expect(friendlyPrintError('ERR:write:1796', false, 'POS')).toMatch(/not ready/);
    expect(friendlyPrintError('ERR:open:5', false, 'POS')).toMatch(/refused/);
    expect(friendlyPrintError('', true, 'POS')).toMatch(/timed out/);
    expect(friendlyPrintError('boom', false, '')).toMatch(/default printer/);
  });
  it('parses the printer list', () => {
    const json =
      '[{"name":"POS-80","isDefault":true,"offline":false},{"name":"Old","isDefault":false,"offline":true},{"x":1}]';
    expect(parseWinPrinters(json)).toEqual([
      { name: 'POS-80', isDefault: true, offline: false },
      { name: 'Old', isDefault: false, offline: true },
    ]);
    expect(parseWinPrinters('{"name":"One"}')).toEqual([
      { name: 'One', isDefault: false, offline: false },
    ]);
    expect(parseWinPrinters('garbage')).toEqual([]);
    expect(parseWinPrinters('')).toEqual([]);
  });
});
