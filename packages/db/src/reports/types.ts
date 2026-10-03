import type { Db } from '../client';
import type { WriteContext } from '../context';

export type ColumnType = 'text' | 'money' | 'qty' | 'date' | 'percent' | 'datetime';

/** `cost` columns need a view-cost right, `profit` columns need view-profit. Removed server-side otherwise. */
export type Sensitivity = 'cost' | 'profit';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  align?: 'start' | 'end';
  sensitivity?: Sensitivity;
}

export type ReportCell = string | number | null;
export type ReportRow = Record<string, ReportCell>;

export interface ReportKpi {
  label: string;
  value: string | number;
  type: ColumnType;
  sensitivity?: Sensitivity;
}

/**
 * Money is integer paisa in rows and totals; percent is a number of percent with 2 decimals (12.5 = 12.5%);
 * qty is an integer in the item's smallest unit; datetime is branch-local 'YYYY-MM-DD HH:mm'.
 */
export interface ReportResult {
  id: string;
  title: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Optional, same length as rows: a row that needs a cost or profit right is removed for users without it. */
  rowSensitivity?: (Sensitivity | null)[];
  totals?: Record<string, number | string | null>;
  kpis?: ReportKpi[];
  note?: string;
  truncated?: boolean;
}

export type ReportGroup = 'sales' | 'stock' | 'expiry' | 'profit' | 'compliance' | 'finance';
export type FilterKey = 'range' | 'q' | 'bucket' | 'limit';

export interface ReportFilters {
  /** Branch-local 'YYYY-MM-DD', inclusive. */
  from?: string;
  to?: string;
  q?: string;
  bucket?: string;
  limit?: number;
}

export type ReportRunner = (db: Db, ctx: WriteContext, filters: ReportFilters) => ReportResult;

export interface ReportDefinition {
  id: string;
  title: string;
  group: ReportGroup;
  /** Needed to see the report. The matching `.export` right is needed to download it. */
  requiredPermission: string;
  exportPermission: string;
  filters: FilterKey[];
  run: ReportRunner;
}

export const EXPIRY_BUCKETS = ['expired', '0-30', '31-60', '61-90', '91-180'] as const;
export type ExpiryBucket = (typeof EXPIRY_BUCKETS)[number];
