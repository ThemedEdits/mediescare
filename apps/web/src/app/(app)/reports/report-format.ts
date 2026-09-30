import { formatMinor } from '@mediescare/core/money';

export type Preset = 'today' | 'yesterday' | 'week' | 'month' | 'last30' | 'custom';

export const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'last30', label: 'Last 30 days' },
  { id: 'custom', label: 'Custom' },
];

export type ColumnType = 'text' | 'money' | 'qty' | 'date' | 'percent' | 'datetime';
export interface Column {
  key: string;
  label: string;
  type: ColumnType;
  align?: 'start' | 'end';
}
export type Cell = string | number | null;
export type Row = Record<string, Cell>;

/** 'YYYY-MM-DD' from the PC's own calendar (the branch PC runs in the branch time zone). */
export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** From and to dates (inclusive) for a preset. The week starts on Monday. */
export function presetRange(
  preset: Exclude<Preset, 'custom'>,
  now: Date,
): { from: string; to: string } {
  const today = localDate(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = localDate(addDays(now, -1));
      return { from: y, to: y };
    }
    case 'week':
      return { from: localDate(addDays(now, -((now.getDay() + 6) % 7))), to: today };
    case 'month':
      return { from: localDate(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
    case 'last30':
      return { from: localDate(addDays(now, -29)), to: today };
  }
}

export function formatCell(type: ColumnType, value: Cell | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') return value;
  switch (type) {
    case 'money':
      return formatMinor(value);
    case 'percent':
      return `${value.toFixed(2)}%`;
    case 'qty':
      return value.toLocaleString('en-US');
    default:
      return String(value);
  }
}

/** Numbers compare as numbers, text as text, empty cells last. */
export function compareCells(a: Cell | undefined, b: Cell | undefined): number {
  const aEmpty = a === null || a === undefined || a === '';
  const bEmpty = b === null || b === undefined || b === '';
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

export function sortRows(rows: Row[], key: string | null, dir: 'asc' | 'desc'): Row[] {
  if (!key) return rows;
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = x[key];
    const b = y[key];
    const aEmpty = a === null || a === undefined || a === '';
    const bEmpty = b === null || b === undefined || b === '';
    // Empty cells stay last whichever way the column is sorted.
    if (aEmpty || bEmpty) return compareCells(a, b);
    return sign * compareCells(a, b);
  });
}

export interface ReportFilterState {
  from: string;
  to: string;
  q: string;
  bucket: string;
  limit: string;
}

export function reportQuery(f: ReportFilterState, uses: string[]): string {
  const p = new URLSearchParams();
  if (uses.includes('range')) {
    p.set('from', f.from);
    p.set('to', f.to);
  }
  if (uses.includes('q') && f.q.trim()) p.set('q', f.q.trim());
  if (uses.includes('bucket') && f.bucket) p.set('bucket', f.bucket);
  if (uses.includes('limit') && f.limit) p.set('limit', f.limit);
  return p.toString();
}
