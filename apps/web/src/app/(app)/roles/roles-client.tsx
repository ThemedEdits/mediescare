'use client';

import { useState } from 'react';
import {
  api,
  Badge,
  Button,
  ErrorText,
  inputClass,
  Modal,
  useAsync,
  useErrorText,
} from '@/components/ui';
import { useT } from '@/i18n/client';
import type { Translator } from '@/i18n/core';

interface RoleRow {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  discountLimitBp: number;
  refundLimitMinor: number | null;
  priceOverrideLimitBp: number;
  version: number;
  permissionCount: number;
  userCount: number;
}
interface RoleDetail extends RoleRow {
  permissions: string[];
}
interface Group {
  module: string;
  resource: string;
  keys: string[];
}

const pct = (bp: number) => `${bp / 100}%`;
const pkr = (minor: number | null, t: Translator) =>
  minor === null ? t('roles.noCap') : `PKR ${(minor / 100).toLocaleString('en-PK')}`;

/** Translated label for a catalogue part (module, resource or action); English falls back to the raw words. */
function partLabel(t: Translator, kind: 'module' | 'resource' | 'action', part: string): string {
  const key = `roles.${kind}.${part}`;
  return t.has(key) ? t(key) : part.replace(/_/g, ' ');
}

export function RolesClient({
  canCreate,
  canEdit,
  canDelete,
}: {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const t = useT();
  const errorText = useErrorText();
  const roles = useAsync(() => api<{ roles: RoleRow[] }>('/api/roles'));
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <div className="flex items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('roles.title')}</h1>
          <p className="text-sm text-muted">{t('roles.subtitle')}</p>
        </div>
        {canCreate ? (
          <Button className="ms-auto" onClick={() => setEditing('new')}>
            {t('roles.new')}
          </Button>
        ) : null}
      </div>
      <ErrorText message={roles.error ?? error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">{t('roles.role')}</th>
              <th className="px-4 py-3">{t('roles.permissions')}</th>
              <th className="px-4 py-3">{t('roles.discountLimit')}</th>
              <th className="px-4 py-3">{t('roles.refundLimit')}</th>
              <th className="px-4 py-3">{t('roles.users')}</th>
              <th className="px-4 py-3 text-end">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {roles.data?.roles.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">
                  {r.name}{' '}
                  {r.isSystem ? (
                    <Badge>{t('roles.builtIn')}</Badge>
                  ) : (
                    <Badge tone="warning">{t('roles.custom')}</Badge>
                  )}
                </td>
                <td className="px-4 py-3">{r.permissionCount}</td>
                <td className="px-4 py-3">{pct(r.discountLimitBp)}</td>
                <td className="px-4 py-3">
                  <span dir="ltr">{pkr(r.refundLimitMinor, t)}</span>
                </td>
                <td className="px-4 py-3">{r.userCount}</td>
                <td className="px-4 py-3 text-end">
                  <Button variant="ghost" className="h-8 px-2" onClick={() => setEditing(r.id)}>
                    {canEdit && r.code !== 'super_admin' ? t('common.edit') : t('roles.view')}
                  </Button>
                  {canDelete && !r.isSystem ? (
                    <Button
                      variant="ghost"
                      className="h-8 px-2 text-danger"
                      onClick={async () => {
                        if (!window.confirm(t('roles.deleteConfirm', { name: r.name }))) return;
                        try {
                          await api(`/api/roles/${r.id}`, { method: 'DELETE' });
                          roles.reload();
                          setError(null);
                        } catch (e) {
                          setError(errorText(e, 'roles.deleteFailed'));
                        }
                      }}
                    >
                      {t('common.delete')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {!roles.data && !roles.error ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  {t('common.loading')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {editing ? (
        <RoleEditor
          id={editing === 'new' ? null : editing}
          canEdit={canEdit || canCreate}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            roles.reload();
          }}
        />
      ) : null}
    </>
  );
}

function RoleEditor({
  id,
  canEdit,
  onClose,
  onSaved,
}: {
  id: string | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const catalogue = useAsync(() => api<{ groups: Group[] }>('/api/permissions'));
  const detail = useAsync(
    () => (id ? api<{ role: RoleDetail }>(`/api/roles/${id}`) : Promise.resolve(null)),
    [id],
  );
  const loaded = id ? detail.data : ({ role: null } as { role: RoleDetail | null });
  if (!catalogue.data || !loaded)
    return (
      <Modal title={t('roles.role')} onClose={onClose}>
        <p className="text-sm text-muted">{t('common.loading')}</p>
        <ErrorText message={catalogue.error ?? detail.error} />
      </Modal>
    );
  return (
    <EditorForm
      key={id ?? 'new'}
      role={loaded.role}
      groups={catalogue.data.groups}
      readOnly={!canEdit || loaded.role?.code === 'super_admin'}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function EditorForm({
  role,
  groups,
  readOnly,
  onClose,
  onSaved,
}: {
  role: RoleDetail | null;
  groups: Group[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [name, setName] = useState(role?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [discount, setDiscount] = useState(String((role?.discountLimitBp ?? 0) / 100));
  const [refund, setRefund] = useState(
    role?.refundLimitMinor === null ? '' : String((role?.refundLimitMinor ?? 0) / 100),
  );
  const [noRefundCap, setNoRefundCap] = useState(role ? role.refundLimitMinor === null : false);
  const [override, setOverride] = useState(String((role?.priceOverrideLimitBp ?? 0) / 100));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const modules = [...new Set(groups.map((g) => g.module))];

  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const toggleGroup = (keys: string[]) =>
    setSelected((s) => {
      const n = new Set(s);
      const all = keys.every((k) => n.has(k));
      keys.forEach((k) => (all ? n.delete(k) : n.add(k)));
      return n;
    });

  async function save() {
    setBusy(true);
    setError(null);
    const body = {
      name,
      permissions: [...selected],
      discountLimitBp: Math.round(Number(discount) * 100),
      refundLimitMinor: noRefundCap ? null : Math.round(Number(refund || '0') * 100),
      priceOverrideLimitBp: Math.round(Number(override) * 100),
    };
    try {
      if (role)
        await api(`/api/roles/${role.id}`, {
          method: 'PUT',
          body: { ...body, expectedVersion: role.version },
        });
      else await api('/api/roles', { body });
      onSaved();
    } catch (e) {
      setError(errorText(e, 'common.couldNotSave'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={
        role ? (readOnly ? role.name : t('roles.editTitle', { name: role.name })) : t('roles.new')
      }
      onClose={onClose}
      wide
    >
      <div className="space-y-4">
        {role?.code === 'super_admin' ? (
          <p className="rounded-[6px] bg-primary-50 px-3 py-2 text-sm">
            {t('roles.superAdminNote')}
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-4">
          <label className="text-sm sm:col-span-2">
            {t('common.name')}
            <input
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={readOnly || !!role?.isSystem}
            />
          </label>
          <label className="text-sm">
            {t('roles.maxDiscount')}
            <input
              className={inputClass}
              inputMode="decimal"
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              disabled={readOnly}
            />
          </label>
          <label className="text-sm">
            {t('roles.maxPriceCut')}
            <input
              className={inputClass}
              inputMode="decimal"
              value={override}
              onChange={(e) => setOverride(e.target.value)}
              disabled={readOnly}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            {t('roles.maxRefund')}
            <input
              className={inputClass}
              inputMode="decimal"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
              disabled={readOnly || noRefundCap}
            />
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={noRefundCap}
              onChange={(e) => setNoRefundCap(e.target.checked)}
              disabled={readOnly}
            />{' '}
            {t('roles.noRefundCap')}
          </label>
        </div>
        <div className="max-h-[45vh] space-y-4 overflow-y-auto rounded-[10px] border border-border p-3">
          {modules.map((m) => (
            <section key={m}>
              <h3 className="mb-1 text-sm font-semibold capitalize">{partLabel(t, 'module', m)}</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {groups
                  .filter((g) => g.module === m)
                  .map((g) => (
                    <div key={g.resource} className="rounded-[6px] bg-surface p-2">
                      <label className="mb-1 flex items-center gap-2 text-sm font-medium">
                        <input
                          type="checkbox"
                          disabled={readOnly}
                          checked={g.keys.every((k) => selected.has(k))}
                          onChange={() => toggleGroup(g.keys)}
                        />
                        {partLabel(t, 'resource', g.resource)}
                      </label>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 ps-6">
                        {g.keys.map((k) => (
                          <label key={k} className="flex items-center gap-1 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              disabled={readOnly}
                              checked={selected.has(k)}
                              onChange={() => toggle(k)}
                            />
                            {partLabel(t, 'action', k.split('.')[2] ?? '')}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </div>
        <ErrorText message={error} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-muted">
            {t('roles.selected', { count: selected.size })}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {readOnly ? t('common.close') : t('common.cancel')}
            </Button>
            {!readOnly ? (
              <Button onClick={save} disabled={busy || name.trim().length < 2}>
                {busy ? t('common.saving') : t('roles.save')}
              </Button>
            ) : null}
          </span>
        </div>
      </div>
    </Modal>
  );
}
