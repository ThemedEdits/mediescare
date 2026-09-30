import type { ImportField } from './columns';

export type IssueSeverity = 'error' | 'warning' | 'exists';

export interface ImportIssue {
  /** Row number in the spreadsheet (the header is row 1 in most files). */
  row: number;
  severity: IssueSeverity;
  code: string;
  field: ImportField | null;
  message: string;
  /** The item name as written in the file (cut to 80 characters), to find the row quickly. */
  name: string;
}

/** One file row that passed validation, in the form the committer writes. */
export interface PreparedRow {
  rowNo: number;
  name: string;
  genericName: string | null;
  barcode: string | null;
  sku: string | null;
  category: string | null;
  manufacturer: string | null;
  /** Stocking unit name as written, or null for the default. */
  unitName: string | null;
  /** Smallest units in one stocking unit. 1 means the stocking unit is the smallest unit. */
  packSize: number;
  /** Price of the smallest unit in micro-PKR. */
  retailRateUnitMicro: number;
  /** Cost of one stocking unit in micro-PKR, or null when the file has none. */
  costPackMicro: number | null;
  reorderLevelBase: number;
  /** Quantity in smallest units (0 when none). */
  quantityBase: number;
  expiryDate: string | null;
  batchNo: string | null;
  isNarcotic: boolean;
  isPrescription: boolean;
  isActive: boolean;
  rack: string | null;
  taxBp: number;
}

export interface ItemImportReport {
  totalRows: number;
  /** Rows that will become items (including those with warnings). */
  willImport: number;
  /** Rows skipped because their barcode or item code already belongs to an item. */
  alreadyExist: number;
  /** Rows skipped because of an error. */
  skippedWithErrors: number;
  rowsWithWarnings: number;
  /** Importable rows with a quantity: opening stock candidates. */
  stockRows: number;
  /** Importable rows with a quantity but no expiry in the file. */
  needsDefaultExpiry: number;
  /** Rows whose supplier cell was filled. Suppliers are not created by this import. */
  rowsWithSuppliers: number;
  /** Exact number of issues per code, even when the stored list was cut. */
  issueCounts: Record<string, number>;
  /** Stored issues: at most MAX_STORED_ISSUES of each severity. */
  issues: ImportIssue[];
  issuesTruncated: boolean;
}

export interface PreparedImport {
  rows: PreparedRow[];
  report: ItemImportReport;
}

export interface ValidationOptions {
  /** Check opening stock (cost and expiry) as well. */
  importStock?: boolean;
}

export interface CommitOptions {
  importStock: boolean;
  /** 'YYYY-MM-DD', in the future. Used for opening stock rows that have no expiry. */
  defaultExpiry?: string | null;
  /** Document id written on opening stock and in the audit trail. Generated when omitted. */
  importId?: string;
}

export interface ImportProgress {
  done: number;
  total: number;
  created: number;
  skipped: number;
  errors: number;
  warnings: number;
}

export interface CommitResult {
  created: number;
  /** Rows not imported: already existing, errors. */
  skipped: number;
  openingBatches: number;
  /** Rows whose opening stock was left out (no cost, or already expired). */
  openingSkipped: number;
  unitsCreated: number;
  categoriesCreated: number;
  manufacturersCreated: number;
  racksCreated: number;
  durationMs: number;
}
