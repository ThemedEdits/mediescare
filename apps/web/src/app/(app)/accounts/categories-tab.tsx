'use client';

import { useState } from 'react';
import { api, Badge, Button, ErrorText, inputClass, useAsync, useErrorText } from '@/components/ui';
import { useT } from '@/i18n/client';
import { EXPENSE_KINDS, type ExpenseKind } from './accounts-format';

interface Category {
  id: string;
  name: string;
  kind: ExpenseKind;
  isActive: boolean;
  version: number;
}

/** Expense categories: add, rename, change kind, hide from new entries. Never deleted. */
export function CategoriesTab({ canManage }: { canManage: boolean }) {
  const t = useT();
  const errorText = useErrorText();
  const list = useAsync(() => api<{ categories: Category[] }>('/api/expense-categories?all=1'));
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ExpenseKind>('operating');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      list.reload();
      return true;
    } catch (e) {
      setError(errorText(e, 'common.couldNotSave'));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const patch = (c: Category, body: Record<string, unknown>) =>
    run(() =>
      api(`/api/expense-categories/${encodeURIComponent(c.id)}`, {
        method: 'PATCH',
        body: { version: c.version, ...body },
      }),
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('accounts.categories.intro')}</p>
      {canManage ? (
        <form
          className="no-print flex flex-wrap items-end gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await run(() =>
              api('/api/expense-categories', { body: { name: name.trim(), kind } }),
            );
            if (ok) setName('');
          }}
        >
          <label className="text-xs text-muted">
            {t('common.name')}
            <input
              className={`${inputClass} w-64`}
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="text-xs text-muted">
            {t('accounts.categories.kind')}
            <select
              className={`${inputClass} w-40`}
              value={kind}
              onChange={(e) => setKind(e.target.value as ExpenseKind)}
            >
              {EXPENSE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`accounts.kinds.${k}`)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={busy || name.trim().length < 2}>
            {t('accounts.categories.add')}
          </Button>
        </form>
      ) : null}
      <ErrorText message={error ?? list.error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs uppercase text-muted">
            <tr>
              <th className="px-3 py-2 text-start">{t('common.name')}</th>
              <th className="px-3 py-2 text-start">{t('accounts.categories.kind')}</th>
              <th className="px-3 py-2 text-start">{t('common.status')}</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {list.data?.categories.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-3 py-2">
                  {editing?.id === c.id ? (
                    <form
                      className="flex gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (await patch(c, { name: editing.name })) setEditing(null);
                      }}
                    >
                      <input
                        autoFocus
                        className={`${inputClass} w-64`}
                        value={editing.name}
                        maxLength={60}
                        onChange={(e) => setEditing({ id: c.id, name: e.target.value })}
                      />
                      <Button type="submit" className="h-10" disabled={busy}>
                        {t('common.save')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10"
                        onClick={() => setEditing(null)}
                      >
                        {t('common.cancel')}
                      </Button>
                    </form>
                  ) : (
                    c.name
                  )}
                </td>
                <td className="px-3 py-2">
                  {canManage ? (
                    <select
                      aria-label={t('accounts.categories.kind')}
                      className={`${inputClass} w-40`}
                      value={c.kind}
                      disabled={busy}
                      onChange={(e) => patch(c, { kind: e.target.value })}
                    >
                      {EXPENSE_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {t(`accounts.kinds.${k}`)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    t(`accounts.kinds.${c.kind}`)
                  )}
                </td>
                <td className="px-3 py-2">
                  <Badge tone={c.isActive ? 'success' : 'neutral'}>
                    {c.isActive ? t('common.active') : t('common.inactive')}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-end">
                  {canManage ? (
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        className="h-8"
                        onClick={() => setEditing({ id: c.id, name: c.name })}
                      >
                        {t('accounts.categories.rename')}
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8"
                        disabled={busy}
                        onClick={() => patch(c, { isActive: !c.isActive })}
                      >
                        {c.isActive
                          ? t('accounts.categories.deactivate')
                          : t('accounts.categories.activate')}
                      </Button>
                    </div>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
