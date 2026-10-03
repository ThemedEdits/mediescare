'use client';

import { useState } from 'react';
import { api, Button, ErrorText, useAsync, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr } from '@/lib/format';
import { printReport } from '../reports/print-report';
import { KpiCards } from '../reports/report-table';
import { CashEntries } from './cash-entries';
import { monthRange, RangeBar } from './range-bar';

interface CashFlow {
  range: { from: string; to: string };
  openingCashMinor: number;
  closingCashMinor: number;
  cashIn: { salesMinor: number; adjustmentsMinor: number; totalMinor: number };
  cashOut: {
    refundsMinor: number;
    adjustmentsMinor: number;
    expensesMinor: number;
    supplierPaymentsMinor: number;
    totalMinor: number;
  };
  byMode: {
    modeId: string;
    name: string;
    kind: string;
    salesMinor: number;
    refundsMinor: number;
    expensesMinor: number;
    supplierPaymentsMinor: number;
    adjustmentsMinor: number;
    netMinor: number;
  }[];
  expensesByCategory: { categoryId: string; name: string; amountMinor: number }[];
  daily: {
    date: string;
    inMinor: number;
    outMinor: number;
    netMinor: number;
    closingMinor: number;
  }[];
}

const money = (n: number) => <bdi dir="ltr">{pkr(n)}</bdi>;
const th = 'px-3 py-2 text-end';

/** Cash book: opening, cash in and out, closing, by payment mode, by category and day by day. */
export function CashBookTab({ canExport, canAdjust }: { canExport: boolean; canAdjust: boolean }) {
  const t = useT();
  const errorText = useErrorText();
  const [range, setRange] = useState(monthRange());
  const query = `from=${range.from}&to=${range.to}`;
  const data = useAsync(() => api<CashFlow>(`/api/expenses/cash-flow?${query}`), [query]);
  const [error, setError] = useState<string | null>(null);
  const cf = data.data;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3">
        <RangeBar value={range} onChange={setRange} />
        <div className="ms-auto flex gap-2">
          {canExport ? (
            <a
              href={`/api/reports/cash-flow/export?format=xlsx&${query}`}
              download
              className="inline-flex h-10 items-center rounded-[6px] border border-primary-600 px-4 text-sm font-semibold text-primary-600 hover:bg-primary-50"
            >
              {t('reports.exportExcel')}
            </a>
          ) : null}
          <Button
            variant="outline"
            disabled={!cf}
            onClick={() =>
              printReport(`mediescare-cash-book-${range.from}-${range.to}`).catch((e: unknown) =>
                setError(errorText(e, 'reports.printFailed')),
              )
            }
          >
            {t('reports.printPdf')}
          </Button>
        </div>
      </div>
      <ErrorText message={error ?? data.error} />
      {!cf && !data.error ? <p className="text-sm text-muted">{t('common.loading')}</p> : null}
      {cf ? (
        <div id="report-print" className="space-y-5">
          <header>
            <h2 className="text-xl font-semibold">{t('accounts.cashBook.title')}</h2>
            <p className="text-sm text-muted">
              {t('reports.dateRange', { from: cf.range.from, to: cf.range.to })}
            </p>
          </header>
          <KpiCards
            kpis={[
              { label: 'Opening cash', value: cf.openingCashMinor, type: 'money' },
              { label: 'Cash in', value: cf.cashIn.totalMinor, type: 'money' },
              { label: 'Cash out', value: cf.cashOut.totalMinor, type: 'money' },
              { label: 'Closing cash', value: cf.closingCashMinor, type: 'money' },
            ]}
          />

          <section className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[10px] border border-border">
              <h3 className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-semibold">
                {t('accounts.cashBook.cashMovement')}
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  <tr>
                    <td className="px-3 py-2">{t('accounts.cashBook.cashSales')}</td>
                    <td className={th}>{money(cf.cashIn.salesMinor)}</td>
                  </tr>
                  {cf.cashIn.adjustmentsMinor > 0 ? (
                    <tr className="border-t border-border">
                      <td className="px-3 py-2">{t('accounts.cashBook.entriesIn')}</td>
                      <td className={th}>{money(cf.cashIn.adjustmentsMinor)}</td>
                    </tr>
                  ) : null}
                  <tr className="border-t border-border">
                    <td className="px-3 py-2">{t('accounts.cashBook.cashRefunds')}</td>
                    <td className={th}>{money(cf.cashOut.refundsMinor)}</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2">{t('accounts.cashBook.cashExpenses')}</td>
                    <td className={th}>{money(cf.cashOut.expensesMinor)}</td>
                  </tr>
                  <tr className="border-t border-border">
                    <td className="px-3 py-2">{t('accounts.cashBook.cashSupplier')}</td>
                    <td className={th}>{money(cf.cashOut.supplierPaymentsMinor)}</td>
                  </tr>
                  {cf.cashOut.adjustmentsMinor > 0 ? (
                    <tr className="border-t border-border">
                      <td className="px-3 py-2">{t('accounts.cashBook.entriesOut')}</td>
                      <td className={th}>{money(cf.cashOut.adjustmentsMinor)}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
              <p className="border-t border-border px-3 py-2 text-xs text-muted">
                {t('accounts.cashBook.floatNote')}
              </p>
            </div>

            <div className="rounded-[10px] border border-border">
              <h3 className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-semibold">
                {t('accounts.cashBook.byCategory')}
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  {cf.expensesByCategory.map((c) => (
                    <tr key={c.categoryId} className="border-t border-border first:border-t-0">
                      <td className="px-3 py-2">{c.name}</td>
                      <td className={th}>{money(c.amountMinor)}</td>
                    </tr>
                  ))}
                  {cf.expensesByCategory.length === 0 ? (
                    <tr>
                      <td className="px-3 py-4 text-center text-muted">
                        {t('accounts.expensesEmpty')}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="overflow-x-auto rounded-[10px] border border-border">
            <h3 className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-semibold">
              {t('accounts.cashBook.byMode')}
            </h3>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2 text-start">{t('reports.col.mode')}</th>
                  <th className={th}>{t('accounts.cashBook.sales')}</th>
                  <th className={th}>{t('accounts.cashBook.refunds')}</th>
                  <th className={th}>{t('accounts.cashBook.expenses')}</th>
                  <th className={th}>{t('accounts.cashBook.supplier')}</th>
                  <th className={th}>{t('accounts.cashBook.entries')}</th>
                  <th className={th}>{t('reports.col.net')}</th>
                </tr>
              </thead>
              <tbody>
                {cf.byMode.map((m) => (
                  <tr key={m.modeId} className="border-t border-border">
                    <td className="px-3 py-2">{m.name}</td>
                    <td className={th}>{money(m.salesMinor)}</td>
                    <td className={th}>{money(m.refundsMinor)}</td>
                    <td className={th}>{money(m.expensesMinor)}</td>
                    <td className={th}>{money(m.supplierPaymentsMinor)}</td>
                    <td className={th}>{money(m.adjustmentsMinor)}</td>
                    <td className={`${th} font-semibold`}>{money(m.netMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="report-scroll max-h-[50vh] overflow-auto rounded-[10px] border border-border">
            <h3 className="border-b border-border bg-surface-2 px-3 py-2 text-sm font-semibold">
              {t('accounts.cashBook.daily')}
            </h3>
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs uppercase text-muted">
                <tr>
                  <th className="px-3 py-2 text-start">{t('common.date')}</th>
                  <th className={th}>{t('accounts.cashBook.in')}</th>
                  <th className={th}>{t('accounts.cashBook.out')}</th>
                  <th className={th}>{t('reports.col.net')}</th>
                  <th className={th}>{t('accounts.cashBook.closing')}</th>
                </tr>
              </thead>
              <tbody>
                {cf.daily.map((d) => (
                  <tr key={d.date} className="border-t border-border">
                    <td className="px-3 py-2">
                      <bdi dir="ltr">{d.date}</bdi>
                    </td>
                    <td className={th}>{money(d.inMinor)}</td>
                    <td className={th}>{money(d.outMinor)}</td>
                    <td className={th}>{money(d.netMinor)}</td>
                    <td className={`${th} font-semibold`}>{money(d.closingMinor)}</td>
                  </tr>
                ))}
                {cf.daily.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-muted">
                      {t('reports.empty')}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
          <p className="text-xs text-muted">{t('accounts.cashBook.note')}</p>
        </div>
      ) : null}
      <CashEntries canAdjust={canAdjust} onChanged={data.reload} />
    </div>
  );
}
