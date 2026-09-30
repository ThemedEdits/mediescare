import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import type { ReportResult } from '@mediescare/db';
import { reportToXlsx } from './xlsx';

const result: ReportResult = {
  id: 'sample',
  title: 'Sales by day',
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'invoices', label: 'Invoices', type: 'qty', align: 'end' },
    { key: 'billed', label: 'Billed total', type: 'money', align: 'end' },
    { key: 'marginPct', label: 'Margin %', type: 'percent', align: 'end' },
    { key: 'note', label: 'Note', type: 'text' },
  ],
  rows: [
    { date: '2026-10-05', invoices: 3, billed: 123_456, marginPct: 25.5, note: 'First day' },
    { date: '2026-10-06', invoices: 1, billed: 5, marginPct: 0, note: null },
  ],
  totals: { invoices: 4, billed: 123_461 },
};

async function load(buffer: Buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets[0] as ExcelJS.Worksheet;
}

describe('reportToXlsx', () => {
  it('writes title, styled frozen header, typed cells and a totals row', async () => {
    const sheet = await load(
      await reportToXlsx(result, { subtitle: 'Main branch, 2026-10-05 to 2026-10-06' }),
    );
    expect(sheet.name).toBe('Sales by day');
    expect(sheet.getCell('A1').value).toBe('Sales by day');
    expect(sheet.getCell('A2').value).toBe('Main branch, 2026-10-05 to 2026-10-06');
    const header = sheet.getRow(3);
    expect(header.values).toEqual([
      undefined,
      'Date',
      'Invoices',
      'Billed total',
      'Margin %',
      'Note',
    ]);
    expect(header.getCell(1).font?.bold).toBe(true);
    expect(header.getCell(1).fill).toMatchObject({ type: 'pattern' });
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 3 });

    expect(sheet.getCell('A4').value).toBe('2026-10-05');
    expect(sheet.getCell('B4').value).toBe(3);
    expect(sheet.getCell('C4').value).toBe(1234.56);
    expect(sheet.getCell('C4').numFmt).toBe('#,##0.00');
    expect(sheet.getCell('D4').value).toBe(0.255);
    expect(sheet.getCell('D4').numFmt).toBe('0.00%');
    expect(sheet.getCell('E4').value).toBe('First day');
    expect(sheet.getCell('C5').value).toBe(0.05);
    expect(sheet.getCell('E5').value).toBeNull();

    expect(sheet.getCell('A6').value).toBe('Total');
    expect(sheet.getCell('B6').value).toBe(4);
    expect(sheet.getCell('C6').value).toBe(1234.61);
    expect(sheet.getRow(6).font?.bold).toBe(true);
    expect(sheet.getColumn(3).width).toBeGreaterThan(10);
  });

  it('works without totals or subtitle and with no rows', async () => {
    const sheet = await load(
      await reportToXlsx({ ...result, rows: [], totals: undefined, title: 'A/B: report?' }),
    );
    expect(sheet.name).toBe('A B  report');
    expect(sheet.getRow(2).getCell(1).value).toBe('Date');
    expect(sheet.views[0]).toMatchObject({ ySplit: 2 });
    expect(sheet.rowCount).toBe(2);
  });
});
