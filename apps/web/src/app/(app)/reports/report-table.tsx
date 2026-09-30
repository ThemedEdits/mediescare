'use client';

import { useMemo, useState } from 'react';
import { useT } from '@/i18n/client';
import { kpiLabel, reportCellText, reportColumn } from './report-i18n';
import { formatCell, sortRows, type Cell, type Column, type Row } from './report-format';

export interface ReportData {
  id: string;
  title: string;
  columns: Column[];
  rows: Row[];
  totals?: Record<string, Cell>;
  kpis?: { label: string; value: string | number; type: Column['type'] }[];
  note?: string;
  truncated?: boolean;
}

export function KpiCards({ kpis }: { kpis: NonNullable<ReportData['kpis']> }) {
  const t = useT();
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-[10px] border border-border bg-surface px-4 py-3">
          <p className="text-xs uppercase text-muted">{kpiLabel(t, k.label)}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{formatCell(k.type, k.value)}</p>
        </div>
      ))}
    </div>
  );
}

/** Data grid with click-to-sort headers (sorts the rows already loaded) and a sticky header. */
export function ReportTable({ data }: { data: ReportData }) {
  const t = useT();
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const rows = useMemo(
    () => sortRows(data.rows, sort?.key ?? null, sort?.dir ?? 'asc'),
    [data.rows, sort],
  );
  const toggle = (key: string) =>
    setSort((s) =>
      s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' },
    );
  const cellText = (c: Column, v: Cell | undefined) => {
    const text = formatCell(c.type, v);
    return c.type === 'text' ? reportCellText(t, c.key, text) : text;
  };
  const cellClass = (c: Column) =>
    `px-3 py-2 ${c.align === 'end' ? 'text-end tabular-nums' : 'text-start'}`;

  return (
    <div className="report-scroll max-h-[65vh] overflow-auto rounded-[10px] border border-border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-2 text-xs uppercase text-muted">
          <tr>
            {data.columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                aria-sort={
                  sort?.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'
                }
                className={`${cellClass(c)} whitespace-nowrap font-medium`}
              >
                <button
                  type="button"
                  onClick={() => toggle(c.key)}
                  className="inline-flex items-center gap-1 uppercase hover:text-primary-600"
                >
                  {reportColumn(t, data.id, c)}
                  <span aria-hidden className="no-print w-3 text-[10px]">
                    {sort?.key === c.key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border hover:bg-primary-50/40">
              {data.columns.map((c) => (
                <td key={c.key} className={cellClass(c)}>
                  {cellText(c, r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {data.totals && rows.length > 0 ? (
          <tfoot className="font-semibold">
            <tr className="border-t-2 border-border bg-surface">
              {data.columns.map((c, i) => (
                <td key={c.key} className={cellClass(c)}>
                  {data.totals?.[c.key] === undefined || data.totals?.[c.key] === null
                    ? i === 0
                      ? t('common.total')
                      : ''
                    : formatCell(c.type, data.totals[c.key])}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
