import ExcelJS from 'exceljs';
import type { ReportCell, ReportColumn, ReportResult } from '@mediescare/db';

const MONEY_FORMAT = '#,##0.00';
const QTY_FORMAT = '#,##0';
const PERCENT_FORMAT = '0.00%';
const MIN_WIDTH = 8;
const MAX_WIDTH = 50;

/** Value as Excel should hold it: money in rupees, percent as a fraction, quantities as whole numbers. */
function excelValue(column: ReportColumn, value: ReportCell | undefined): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') return value;
  switch (column.type) {
    case 'money':
      return value / 100;
    case 'percent':
      return value / 100;
    default:
      return value;
  }
}

function numberFormat(column: ReportColumn): string | undefined {
  if (column.type === 'money') return MONEY_FORMAT;
  if (column.type === 'qty') return QTY_FORMAT;
  if (column.type === 'percent') return PERCENT_FORMAT;
  return undefined;
}

function shownLength(column: ReportColumn, value: string | number | null): number {
  if (value === null) return 0;
  if (typeof value === 'string') return value.length;
  if (column.type !== 'money') return String(value).length;
  const whole = Math.trunc(Math.abs(value)).toString().length;
  return value.toFixed(2).length + Math.floor((whole - 1) / 3);
}

/**
 * Build the .xlsx for a report that already went through applyColumnRights. A title row, an optional line
 * with the filters used, a styled frozen header, the data, and a totals row when the report has totals.
 */
export async function reportToXlsx(
  result: ReportResult,
  options: { subtitle?: string } = {},
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Mediescare';
  const sheet = workbook.addWorksheet(
    result.title
      .replace(/[\\/?*[\]:]/g, ' ')
      .trim()
      .slice(0, 31),
  );
  const cols = result.columns;
  const last = Math.max(cols.length, 1);

  sheet.addRow([result.title]).font = { bold: true, size: 14 };
  sheet.mergeCells(1, 1, 1, last);
  if (options.subtitle) {
    sheet.addRow([options.subtitle]).font = { color: { argb: 'FF555555' } };
    sheet.mergeCells(2, 1, 2, last);
  }

  const headerRow = sheet.addRow(cols.map((c) => c.label));
  headerRow.font = { bold: true };
  headerRow.eachCell((cell, index) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE6EEF0' } };
    cell.border = { bottom: { style: 'thin' } };
    cell.alignment = { horizontal: cols[index - 1]?.align === 'end' ? 'right' : 'left' };
  });

  const widths = cols.map((c) => c.label.length);
  const addData = (values: (string | number | null)[]) => {
    const row = sheet.addRow(values);
    cols.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      const fmt = numberFormat(c);
      if (fmt && typeof cell.value === 'number') cell.numFmt = fmt;
      if (c.align === 'end') cell.alignment = { horizontal: 'right' };
      widths[i] = Math.max(widths[i] ?? 0, shownLength(c, values[i] ?? null));
    });
    return row;
  };

  for (const r of result.rows) addData(cols.map((c) => excelValue(c, r[c.key])));

  if (result.totals) {
    const totals = result.totals;
    const row = addData(
      cols.map((c, i) => {
        const v = totals[c.key];
        if (v === undefined || v === null) return i === 0 ? 'Total' : null;
        return excelValue(c, v);
      }),
    );
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.border = { top: { style: 'thin' } };
    });
  }

  cols.forEach((_, i) => {
    sheet.getColumn(i + 1).width = Math.min(Math.max((widths[i] ?? 0) + 2, MIN_WIDTH), MAX_WIDTH);
  });
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
