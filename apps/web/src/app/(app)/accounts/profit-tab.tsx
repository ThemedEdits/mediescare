'use client';

import { useState } from 'react';
import { api, Button, ErrorText, useAsync, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr } from '@/lib/format';
import { printReport } from '../reports/print-report';
import { reportCellText } from '../reports/report-i18n';
import { KpiCards, type ReportData } from '../reports/report-table';
import { monthRange, RangeBar } from './range-bar';

/** Lines that close a block of the statement are shown in bold. */
const TOTAL_LINES = new Set(['Gross profit', 'Total expenses', 'Net profit']);
/** The other fixed lines. Every line that is none of these is an expense category and is indented. */
const FIXED_LINES = new Set(['Net revenue', 'Cost of goods sold']);
/** Lines below the profit figure that are for information and not part of it. */
const INFO_LINES = new Set(['Purchases of stock (not an expense)', 'Owed to suppliers today']);

/** Profit and loss statement for a date range, from the net-profit report (rights are applied by the server). */
export function ProfitTab({ canExport }: { canExport: boolean }) {
  const t = useT();
  const errorText = useErrorText();
  const [range, setRange] = useState(monthRange());
  const query = `from=${range.from}&to=${range.to}`;
  const data = useAsync(() => api<ReportData>(`/api/reports/net-profit?${query}`), [query]);
  const [error, setError] = useState<string | null>(null);
  const report = data.data;
  const lineText = (line: string) => reportCellText(t, 'line', line);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3">
        <RangeBar value={range} onChange={setRange} />
        <div className="ms-auto flex gap-2">
          {canExport ? (
            <a
              href={`/api/reports/net-profit/export?format=xlsx&${query}`}
              download
              className="inline-flex h-10 items-center rounded-[6px] border border-primary-600 px-4 text-sm font-semibold text-primary-600 hover:bg-primary-50"
            >
              {t('reports.exportExcel')}
            </a>
          ) : null}
          <Button
            variant="outline"
            disabled={!report}
            onClick={() =>
              printReport(`mediescare-profit-${range.from}-${range.to}`).catch((e: unknown) =>
                setError(errorText(e, 'reports.printFailed')),
              )
            }
          >
            {t('reports.printPdf')}
          </Button>
        </div>
      </div>
      <ErrorText message={error ?? data.error} />
      {!report && !data.error ? <p className="text-sm text-muted">{t('common.loading')}</p> : null}
      {report ? (
        <div id="report-print" className="space-y-4">
          <header>
            <h2 className="text-xl font-semibold">{t('accounts.profit.title')}</h2>
            <p className="text-sm text-muted">{t('reports.dateRange', { ...range })}</p>
          </header>
          {report.kpis && report.kpis.length > 0 ? <KpiCards kpis={report.kpis} /> : null}
          <div className="overflow-x-auto rounded-[10px] border border-border">
            <table className="w-full text-sm">
              <tbody>
                {report.rows.map((r, i) => {
                  const line = String(r.line ?? '');
                  const total = TOTAL_LINES.has(line);
                  return (
                    <tr
                      key={i}
                      className={`border-t border-border first:border-t-0 ${
                        total ? 'bg-surface-2 font-semibold' : ''
                      } ${INFO_LINES.has(line) ? 'text-muted' : ''}`}
                    >
                      <td
                        className={`px-3 py-2 ${total || FIXED_LINES.has(line) || INFO_LINES.has(line) ? '' : 'ps-8'}`}
                      >
                        {lineText(line)}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        <bdi dir="ltr">{pkr(Number(r.amount ?? 0))}</bdi>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">{t('accounts.profit.note')}</p>
        </div>
      ) : null}
    </div>
  );
}
