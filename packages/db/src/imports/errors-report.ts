import type { ItemImportReport } from './types';

const BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;

/** One CSV cell. Quotes when needed, and defuses spreadsheet formulas with a leading quote. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const SEVERITY_LABEL = {
  error: 'Skipped (error)',
  exists: 'Skipped (already exists)',
  warning: 'Imported with warning',
} as const;

/**
 * The issue list as CSV (UTF-8 with BOM so Excel shows Urdu and accents correctly).
 * When the stored list was cut, a last line says how many issues exist per kind.
 */
export function buildIssueReportCsv(report: ItemImportReport): string {
  const lines = [['Row', 'Result', 'Item name', 'Field', 'Code', 'Reason'].join(',')];
  for (const i of report.issues)
    lines.push(
      [i.row, SEVERITY_LABEL[i.severity], i.name, i.field ?? '', i.code, i.message]
        .map(csvCell)
        .join(','),
    );
  if (report.issuesTruncated) {
    const counts = Object.entries(report.issueCounts)
      .map(([code, n]) => `${code}: ${n}`)
      .join('; ');
    lines.push(
      ['', 'Note', '', '', '', `Only the first issues of each kind are listed. Totals - ${counts}`]
        .map(csvCell)
        .join(','),
    );
  }
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
