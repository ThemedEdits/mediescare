'use client';

import { useState, type FormEvent } from 'react';
import {
  api,
  Badge,
  Button,
  ErrorText,
  inputClass,
  Modal,
  SecretBox,
  useAsync,
  useErrorText,
} from '@/components/ui';
import { useT } from '@/i18n/client';
import { PasswordInput } from '@/components/password-input';

interface UserRow {
  id: string;
  username: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: string;
  hasPin: boolean;
  lastLoginAt: string | null;
  version: number;
  roleIds: string[];
  roleCodes: string[];
  allBranches: boolean;
  branchIds: string[];
}
interface Role {
  id: string;
  code: string;
  name: string;
}
interface Branch {
  id: string;
  code: string;
  name: string;
}

export function UsersClient({
  me,
  canCreate,
  canEdit,
}: {
  me: string;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const users = useAsync(
    () => api<{ users: UserRow[] }>(`/api/users?q=${encodeURIComponent(q)}&status=${status}`),
    [q, status],
  );
  const roles = useAsync(() => api<{ roles: Role[] }>('/api/roles'));
  const branches = useAsync(() => api<{ branches: Branch[] }>('/api/branches'));
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [secret, setSecret] = useState<{ title: string; value: string; note: string } | null>(null);
  const [pinFor, setPinFor] = useState<UserRow | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const roleName = (id: string) => roles.data?.roles.find((r) => r.id === id)?.name ?? '';

  async function act(label: string, fn: () => Promise<unknown>) {
    setNotice(null);
    try {
      await fn();
      users.reload();
      setNotice(label);
    } catch (e) {
      setNotice(errorText(e, 'users.failed'));
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('users.title')}</h1>
          <p className="text-sm text-muted">{t('users.subtitle')}</p>
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <input
            aria-label={t('users.searchLabel')}
            className={`${inputClass} w-64`}
            placeholder={t('users.searchPlaceholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select
            aria-label={t('users.filterStatus')}
            className={`${inputClass} w-36`}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t('common.all')}</option>
            <option value="active">{t('common.active')}</option>
            <option value="disabled">{t('users.disabled')}</option>
          </select>
          {canCreate ? <Button onClick={() => setEditing('new')}>{t('users.add')}</Button> : null}
        </div>
      </div>

      {notice ? (
        <p role="status" className="rounded-[6px] bg-primary-50 px-4 py-2 text-sm text-primary-900">
          {notice}
        </p>
      ) : null}
      <ErrorText message={users.error} />

      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">{t('common.name')}</th>
              <th className="px-4 py-3">{t('users.username')}</th>
              <th className="px-4 py-3">{t('users.roles')}</th>
              <th className="px-4 py-3">{t('common.status')}</th>
              <th className="px-4 py-3">{t('users.lastSignIn')}</th>
              <th className="px-4 py-3 text-end">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.users.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{u.fullName}</td>
                <td dir="ltr" className="px-4 py-3 text-start font-mono text-xs rtl:text-end">
                  {u.username}
                </td>
                <td className="px-4 py-3">
                  {u.roleIds.map(roleName).join(', ')}
                  {u.allBranches ? ` · ${t('users.allBranchesSuffix')}` : ''}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={u.status === 'active' ? 'success' : 'danger'}>
                    {u.status === 'active' ? t('common.active') : t('users.disabled')}
                  </Badge>{' '}
                  {u.hasPin ? <Badge>{t('users.pin')}</Badge> : null}
                </td>
                <td className="px-4 py-3 text-muted">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : t('users.never')}
                </td>
                <td className="px-4 py-3 text-end">
                  {canEdit ? (
                    <span className="inline-flex flex-wrap justify-end gap-1">
                      <Button variant="ghost" className="h-8 px-2" onClick={() => setEditing(u)}>
                        {t('common.edit')}
                      </Button>
                      <Button variant="ghost" className="h-8 px-2" onClick={() => setPinFor(u)}>
                        {t('users.pin')}
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() => {
                          if (!window.confirm(t('users.resetConfirm', { name: u.fullName })))
                            return;
                          void act(t('users.passwordReset'), async () => {
                            const r = await api<{ temporaryPassword: string }>(
                              `/api/users/${u.id}/reset-password`,
                              { method: 'POST', body: {} },
                            );
                            setSecret({
                              title: t('users.tempPasswordFor', { username: u.username }),
                              value: r.temporaryPassword,
                              note: t('users.shownOnce'),
                            });
                          });
                        }}
                      >
                        {t('users.resetPassword')}
                      </Button>
                      <Button
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() =>
                          void act(t('users.signedOutEverywhere'), () =>
                            api(`/api/users/${u.id}/logout`, { method: 'POST', body: {} }),
                          )
                        }
                      >
                        {t('users.signOut')}
                      </Button>
                      {u.id !== me ? (
                        <Button
                          variant="ghost"
                          className="h-8 px-2 text-danger"
                          onClick={() =>
                            void act(
                              u.status === 'active'
                                ? t('users.userDisabled')
                                : t('users.userEnabled'),
                              () =>
                                api(`/api/users/${u.id}/status`, {
                                  body: { active: u.status !== 'active' },
                                }),
                            )
                          }
                        >
                          {u.status === 'active' ? t('users.disable') : t('users.enable')}
                        </Button>
                      ) : null}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
            {users.data && users.data.users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">
                  {t('users.empty')}
                </td>
              </tr>
            ) : null}
            {!users.data && !users.error ? (
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
        <UserForm
          user={editing === 'new' ? null : editing}
          roles={roles.data?.roles ?? []}
          branches={branches.data?.branches ?? []}
          onClose={() => setEditing(null)}
          onSaved={(temp, username) => {
            setEditing(null);
            users.reload();
            if (temp)
              setSecret({
                title: t('users.tempPasswordFor', { username }),
                value: temp,
                note: t('users.shownOnce'),
              });
          }}
        />
      ) : null}
      {pinFor ? (
        <PinDialog
          user={pinFor}
          onClose={() => setPinFor(null)}
          onDone={() => {
            setPinFor(null);
            users.reload();
          }}
        />
      ) : null}
      {secret ? (
        <Modal title={secret.title} onClose={() => setSecret(null)}>
          <SecretBox label={t('users.writeItDown')} value={secret.value} note={secret.note} />
          <Button className="mt-4 w-full" onClick={() => setSecret(null)}>
            {t('common.done')}
          </Button>
        </Modal>
      ) : null}
    </>
  );
}

function UserForm({
  user,
  roles,
  branches,
  onClose,
  onSaved,
}: {
  user: UserRow | null;
  roles: Role[];
  branches: Branch[];
  onClose: () => void;
  onSaved: (temporaryPassword: string | null, username: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [roleIds, setRoleIds] = useState<string[]>(user?.roleIds ?? []);
  const [branchIds, setBranchIds] = useState<string[]>(user?.branchIds ?? []);
  const [allBranches, setAllBranches] = useState(user?.allBranches ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const fullName = String(f.get('fullName'));
    const email = String(f.get('email') ?? '').trim() || null;
    const phone = String(f.get('phone') ?? '').trim() || null;
    try {
      if (!user) {
        const r = await api<{ id: string; temporaryPassword: string | null }>('/api/users', {
          body: {
            username: String(f.get('username')),
            fullName,
            email,
            phone,
            roleIds,
            branchIds: allBranches ? [] : branchIds,
            allBranches,
          },
        });
        onSaved(r.temporaryPassword, String(f.get('username')));
      } else {
        await api(`/api/users/${user.id}`, {
          method: 'PATCH',
          body: { fullName, email, phone, expectedVersion: user.version },
        });
        await api(`/api/users/${user.id}/roles`, { method: 'PUT', body: { roleIds } });
        await api(`/api/users/${user.id}/branches`, {
          method: 'PUT',
          body: { branchIds: allBranches ? [] : branchIds, allBranches },
        });
        onSaved(null, user.username);
      }
    } catch (err) {
      setError(errorText(err, 'common.couldNotSave'));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={user ? t('users.editTitle', { username: user.username }) : t('users.add')}
      onClose={onClose}
      wide
    >
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            {t('users.fullName')}
            <input name="fullName" required defaultValue={user?.fullName} className={inputClass} />
          </label>
          {!user ? (
            <label className="text-sm">
              {t('users.username')}
              <input
                name="username"
                required
                pattern="[a-z0-9._-]{3,40}"
                title={t('users.usernameHint')}
                className={inputClass}
              />
            </label>
          ) : null}
          <label className="text-sm">
            {t('users.email')}
            <input
              name="email"
              type="email"
              defaultValue={user?.email ?? ''}
              className={inputClass}
            />
          </label>
          <label className="text-sm">
            {t('users.phone')}
            <input name="phone" defaultValue={user?.phone ?? ''} className={inputClass} />
          </label>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('users.roles')}</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {roles.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={roleIds.includes(r.id)}
                  onChange={() => setRoleIds(toggle(roleIds, r.id))}
                />{' '}
                {r.name}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm font-medium">{t('users.branchAccess')}</legend>
          <label className="mb-1 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allBranches}
              onChange={(e) => setAllBranches(e.target.checked)}
            />{' '}
            {t('users.allBranches')}
          </label>
          {!allBranches ? (
            <div className="grid gap-1 sm:grid-cols-2">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={branchIds.includes(b.id)}
                    onChange={() => setBranchIds(toggle(branchIds, b.id))}
                  />{' '}
                  {b.name} (<bdi>{b.code}</bdi>)
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>
        {!user ? <p className="text-xs text-muted">{t('users.tempPasswordNote')}</p> : null}
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy || roleIds.length === 0}>
            {busy ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function PinDialog({
  user,
  onClose,
  onDone,
}: {
  user: UserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t('users.pinTitle', { username: user.username })} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api(`/api/users/${user.id}/pin`, { body: { pin } });
            onDone();
          } catch (err) {
            setError(errorText(err, 'users.pinFailed'));
          }
        }}
      >
        <p className="text-sm text-muted">{t('users.pinHelp')}</p>
        <PasswordInput
          aria-label={t('users.newPin')}
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          className={`${inputClass} text-center font-mono text-lg tracking-widest`}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        <ErrorText message={error} />
        <div className="flex justify-between gap-2">
          {user.hasPin ? (
            <Button
              type="button"
              variant="danger"
              onClick={async () => {
                await api(`/api/users/${user.id}/pin`, { method: 'DELETE' });
                onDone();
              }}
            >
              {t('users.removePin')}
            </Button>
          ) : (
            <span />
          )}
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pin.length < 4}>
              {t('users.savePin')}
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
