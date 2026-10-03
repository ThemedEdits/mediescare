'use client';

import { useState } from 'react';
import { api, Badge, Button, ErrorText, inputClass, useAsync } from '@/components/ui';
import { useT } from '@/i18n/client';
import { pkr } from '@/lib/format';
import { expenseQuery, pageCount, type ExpenseFilterState } from './accounts-format';
import {
  AddExpenseDialog,
  VoidExpenseDialog,
  type CategoryOption,
  type ModeOption,
} from './expense-dialogs';
import { monthRange, RangeBar } from './range-bar';

const PAGE_SIZE = 50;

interface ExpenseRow {
  id: string;
  docNo: string;
  expenseDate: string;
  categoryName: string;
  amountMinor: number;
  modeName: string;
  payee: string | null;
  reference: string | null;
  note: string | null;
  fromTill: boolean;
  status: 'posted' | 'void';
  voidReason: string | null;
}

interface ExpenseList {
  rows: ExpenseRow[];
  total: number;
  postedTotalMinor: number;
}

export function ExpensesTab({
  canCreate,
  canVoid,
  canBackdate,
}: {
  canCreate: boolean;
  canVoid: boolean;
  canBackdate: boolean;
}) {
  const t = useT();
  const [filters, setFilters] = useState<ExpenseFilterState>({
    ...monthRange(),
    categoryId: '',
    modeId: '',
    status: '',
    page: 1,
  });
  const set = (patch: Partial<ExpenseFilterState>) =>
    setFilters((f) => ({ ...f, page: 1, ...patch }));
  const list = useAsync(
    () => api<ExpenseList>(`/api/expenses?${expenseQuery(filters, PAGE_SIZE)}`),
    [JSON.stringify(filters)],
  );
  const cats = useAsync(() =>
    api<{ categories: CategoryOption[] }>('/api/expense-categories?all=1'),
  );
  const lookups = useAsync(() => api<{ paymentModes: ModeOption[] }>('/api/lookups'));
  const modes = (lookups.data?.paymentModes ?? []).filter((m) => m.kind !== 'credit');
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<{ id: string; docNo: string } | null>(null);
  const pages = pageCount(list.data?.total ?? 0, PAGE_SIZE);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end gap-3">
        <RangeBar value={filters} onChange={(r) => set(r)} />
        <select
          aria-label={t('accounts.filters.category')}
          className={`${inputClass} w-48`}
          value={filters.categoryId}
          onChange={(e) => set({ categoryId: e.target.value })}
        >
          <option value="">{t('accounts.filters.allCategories')}</option>
          {cats.data?.categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('accounts.filters.paidBy')}
          className={`${inputClass} w-44`}
          value={filters.modeId}
          onChange={(e) => set({ modeId: e.target.value })}
        >
          <option value="">{t('accounts.filters.allModes')}</option>
          {modes.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('common.status')}
          className={`${inputClass} w-36`}
          value={filters.status}
          onChange={(e) => set({ status: e.target.value as ExpenseFilterState['status'] })}
        >
          <option value="">{t('common.all')}</option>
          <option value="posted">{t('accounts.status.posted')}</option>
          <option value="void">{t('accounts.status.void')}</option>
        </select>
        {canCreate ? (
          <Button className="ms-auto" onClick={() => setAdding(true)} disabled={!cats.data}>
            {t('accounts.addExpense')}
          </Button>
        ) : null}
      </div>
      <ErrorText message={list.error ?? cats.error} />

      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('common.date')}</th>
              <th className="px-3 py-2 text-start">{t('accounts.col.voucher')}</th>
              <th className="px-3 py-2 text-start">{t('accounts.col.category')}</th>
              <th className="px-3 py-2 text-start">{t('accounts.col.payee')}</th>
              <th className="px-3 py-2 text-start">{t('accounts.col.paidBy')}</th>
              <th className="px-3 py-2 text-end">{t('accounts.col.amount')}</th>
              <th className="px-3 py-2 text-start">{t('common.status')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.data?.rows.map((r) => (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-3 py-2">
                  <bdi dir="ltr">{r.expenseDate}</bdi>
                </td>
                <td className="px-3 py-2">
                  <bdi dir="ltr">{r.docNo}</bdi>
                </td>
                <td className="px-3 py-2">{r.categoryName}</td>
                <td className="px-3 py-2">
                  {r.payee}
                  {r.note || r.reference ? (
                    <span className="block text-xs text-muted">
                      {[r.reference, r.note].filter(Boolean).join(' · ')}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  {r.modeName}
                  {r.fromTill ? (
                    <span className="ms-1 text-xs text-muted">({t('accounts.fromTillBadge')})</span>
                  ) : null}
                </td>
                <td
                  className={`px-3 py-2 text-end tabular-nums ${r.status === 'void' ? 'text-muted line-through' : ''}`}
                >
                  <bdi dir="ltr">{pkr(r.amountMinor)}</bdi>
                </td>
                <td className="px-3 py-2">
                  <Badge tone={r.status === 'void' ? 'danger' : 'success'}>
                    {t(`accounts.status.${r.status}`)}
                  </Badge>
                  {r.voidReason ? (
                    <span className="block text-xs text-muted">{r.voidReason}</span>
                  ) : null}
                </td>
                <td className="no-print px-3 py-2 text-end">
                  {canVoid && r.status === 'posted' ? (
                    <Button
                      variant="ghost"
                      className="h-8"
                      onClick={() => setVoiding({ id: r.id, docNo: r.docNo })}
                    >
                      {t('accounts.voidAction')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {list.data && list.data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-muted">
                  {t('accounts.expensesEmpty')}
                </td>
              </tr>
            ) : null}
            {!list.data && !list.error ? (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted">
                  {t('common.loading')}
                </td>
              </tr>
            ) : null}
          </tbody>
          {list.data && list.data.rows.length > 0 ? (
            <tfoot className="font-semibold">
              <tr className="border-t-2 border-border bg-surface">
                <td colSpan={5} className="px-3 py-2">
                  {t('accounts.totalPosted')}
                </td>
                <td className="px-3 py-2 text-end tabular-nums">
                  <bdi dir="ltr">{pkr(list.data.postedTotalMinor)}</bdi>
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>

      {pages > 1 ? (
        <div className="flex items-center justify-end gap-3 text-sm">
          <Button
            variant="outline"
            disabled={filters.page <= 1}
            onClick={() => setFilters((f) => ({ ...f, page: f.page - 1 }))}
          >
            {t('common.previous')}
          </Button>
          <span>{t('accounts.pageOf', { page: filters.page, pages })}</span>
          <Button
            variant="outline"
            disabled={filters.page >= pages}
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            {t('common.next')}
          </Button>
        </div>
      ) : null}

      {adding && cats.data ? (
        <AddExpenseDialog
          categories={cats.data.categories.filter((c) => c.isActive)}
          modes={modes}
          canBackdate={canBackdate}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            list.reload();
          }}
        />
      ) : null}
      {voiding ? (
        <VoidExpenseDialog
          expense={voiding}
          onClose={() => setVoiding(null)}
          onDone={() => {
            setVoiding(null);
            list.reload();
          }}
        />
      ) : null}
    </div>
  );
}
