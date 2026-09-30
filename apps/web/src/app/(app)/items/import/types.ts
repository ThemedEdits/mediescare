/** Shapes returned by /api/imports/items (see server/items-import.ts). */

export interface FieldChoice {
  key: string;
  label: string;
  required: boolean;
  hint: string;
}

export interface Issue {
  row: number;
  severity: 'error' | 'warning' | 'exists';
  code: string;
  field: string | null;
  message: string;
  name: string;
}

export interface Summary {
  totalRows: number;
  willImport: number;
  alreadyExist: number;
  skippedWithErrors: number;
  rowsWithWarnings: number;
  stockRows: number;
  needsDefaultExpiry: number;
  rowsWithSuppliers: number;
  issueCounts: Record<string, number>;
  issuesTruncated: boolean;
}

export interface Progress {
  done: number;
  total: number;
  created: number;
  skipped: number;
  errors: number;
  warnings: number;
}

export interface ImportResult {
  created: number;
  skipped: number;
  openingBatches: number;
  openingSkipped: number;
  unitsCreated: number;
  categoriesCreated: number;
  manufacturersCreated: number;
  racksCreated: number;
  durationMs: number;
}

export interface ImportView {
  importId: string;
  fileName: string;
  status: 'ready' | 'queued' | 'running' | 'done' | 'failed';
  headers: string[];
  mapping: Record<string, number>;
  fields: FieldChoice[];
  summary: Summary;
  needsDefaultExpiry: boolean;
  sampleIssues: Issue[];
  progress: Progress;
  result: ImportResult | null;
  error: string | null;
}
