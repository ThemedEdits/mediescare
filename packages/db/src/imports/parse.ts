import { Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import { DomainError } from '../errors';

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 200_000;
const MAX_COLUMNS = 100;

/** The file as text cells. `rowNumbers[i]` is the spreadsheet row of `rows[i]` (the header is row 1 or later). */
export interface ParsedTable {
  fileName: string;
  headers: string[];
  rows: string[][];
  rowNumbers: number[];
}

type FileKind = 'xlsx' | 'csv';

function sniff(buffer: Buffer, fileName: string): FileKind {
  if (buffer.length === 0) throw new DomainError('INVALID', 'The file is empty');
  if (buffer.length > MAX_IMPORT_BYTES)
    throw new DomainError('INVALID', 'The file is larger than 25 MB');
  const name = fileName.toLowerCase();
  if (name.endsWith('.xlsx')) {
    // An xlsx file is a zip archive, which starts with "PK".
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b)
      throw new DomainError('INVALID', 'This is not a real .xlsx file');
    return 'xlsx';
  }
  if (name.endsWith('.csv')) {
    if (buffer.subarray(0, 4096).includes(0))
      throw new DomainError('INVALID', 'This is not a text CSV file');
    return 'csv';
  }
  throw new DomainError('INVALID', 'Only .xlsx and .csv files can be imported');
}

/** Turn one spreadsheet cell into text. Formulas use their stored result and are never evaluated. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    const v = value as {
      result?: unknown;
      richText?: { text?: string }[];
      text?: unknown;
      error?: unknown;
    };
    if (v.error !== undefined) return '';
    if ('result' in v) return cellText(v.result);
    if (Array.isArray(v.richText))
      return v.richText
        .map((t) => t.text ?? '')
        .join('')
        .trim();
    if ('text' in v) return cellText(v.text);
  }
  return '';
}

function isBlank(cells: string[]): boolean {
  return cells.every((c) => c === '');
}

class TableBuilder {
  private headers: string[] | null = null;
  private readonly rows: string[][] = [];
  private readonly rowNumbers: number[] = [];

  constructor(private readonly fileName: string) {}

  add(rowNumber: number, cells: string[]): void {
    const trimmed = cells.slice(0, MAX_COLUMNS);
    // Readers differ on trailing empty cells; dropping them makes every reader give the same row.
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === '') trimmed.pop();
    if (isBlank(trimmed)) return;
    if (!this.headers) {
      this.headers = trimmed.map((h, i) => (h === '' ? `Column ${i + 1}` : h));
      return;
    }
    if (this.rows.length >= MAX_IMPORT_ROWS)
      throw new DomainError('INVALID', `The file has more than ${MAX_IMPORT_ROWS} rows`);
    this.rows.push(trimmed);
    this.rowNumbers.push(rowNumber);
  }

  build(): ParsedTable {
    if (!this.headers) throw new DomainError('INVALID', 'The file has no header row');
    return {
      fileName: this.fileName,
      headers: this.headers,
      rows: this.rows,
      rowNumbers: this.rowNumbers,
    };
  }
}

function rowCells(values: unknown): string[] {
  const list = values as unknown[];
  const cells: string[] = [];
  for (let i = 1; i < list.length; i++) cells.push(cellText(list[i]));
  return cells;
}

/** Low memory path: rows are read one by one from the zip. Needs workbook.xml before the sheets. */
async function streamXlsx(buffer: Buffer, fileName: string): Promise<ParsedTable> {
  const builder = new TableBuilder(fileName);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buffer]), {
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'ignore',
    worksheets: 'emit',
  });
  for await (const sheet of reader) {
    // Only the first worksheet is imported.
    for await (const row of sheet as AsyncIterable<ExcelJS.Row>)
      builder.add(row.number, rowCells(row.values));
    break;
  }
  return builder.build();
}

/** Fallback for files whose parts are stored in another order (some writers do): loads the whole file. */
async function loadXlsx(buffer: Buffer, fileName: string): Promise<ParsedTable> {
  const builder = new TableBuilder(fileName);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new DomainError('INVALID', 'The Excel file has no worksheet');
  sheet.eachRow({ includeEmpty: false }, (row) => builder.add(row.number, rowCells(row.values)));
  return builder.build();
}

async function parseXlsx(buffer: Buffer, fileName: string): Promise<ParsedTable> {
  try {
    return await streamXlsx(buffer, fileName);
  } catch (error) {
    if (error instanceof DomainError) throw error;
  }
  try {
    return await loadXlsx(buffer, fileName);
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      'INVALID',
      'The Excel file could not be read. Save it again as .xlsx or .csv',
    );
  }
}

/** RFC 4180: quoted fields, doubled quotes, line breaks inside quotes, CRLF, LF or CR. */
function parseCsv(buffer: Buffer, fileName: string): ParsedTable {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new DomainError('INVALID', 'The CSV file is not UTF-8 text. Save it as "CSV UTF-8"');
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const firstLine = text.slice(0, Math.max(0, text.search(/\r|\n/)) || text.length);
  const count = (c: string) => firstLine.split(c).length - 1;
  const delimiter =
    count('\t') > count(',') && count('\t') >= count(';')
      ? '\t'
      : count(';') > count(',')
        ? ';'
        : ',';

  const builder = new TableBuilder(fileName);
  let cells: string[] = [];
  let field = '';
  let quoted = false;
  let rowNumber = 1;
  let rowStart = 1;
  const endRow = () => {
    cells.push(field.trim());
    builder.add(rowStart, cells);
    cells = [];
    field = '';
    rowNumber++;
    rowStart = rowNumber;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === '\n') rowNumber++;
        field += ch;
      }
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      cells.push(field.trim());
      field = '';
    } else if (ch === '\n') endRow();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      endRow();
    } else field += ch;
  }
  if (field !== '' || cells.length > 0) endRow();
  return builder.build();
}

/** Read an .xlsx or .csv upload into rows of text. Rejects wrong types, empty, oversized and unreadable files. */
export async function parseItemFile(buffer: Buffer, fileName: string): Promise<ParsedTable> {
  const kind = sniff(buffer, fileName);
  return kind === 'xlsx' ? parseXlsx(buffer, fileName) : parseCsv(buffer, fileName);
}
