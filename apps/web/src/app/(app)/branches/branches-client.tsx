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

interface BranchRow {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
  status: string;
}

interface Issued {
  branch: BranchRow;
  code: string;
  expiresAt: string;
  cloudUrl: string;
  branchCreated: boolean;
}

export function BranchesClient({
  headOffice,
  canCreate,
}: {
  headOffice: boolean;
  canCreate: boolean;
}) {
  const t = useT();
  const list = useAsync(() => api<{ branches: BranchRow[] }>('/api/branches'));
  const [adding, setAdding] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const errorText = useErrorText();
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  /** A new one-time code for a branch that already exists (its PC was not set up yet, or is replaced). */
  async function newCode(b: BranchRow) {
    setRowBusy(b.id);
    setRowError(null);
    try {
      setIssued(
        await api<Issued>('/api/branches/enrollment-codes', {
          body: { code: b.code, name: b.name },
        }),
      );
    } catch (err) {
      setRowError(errorText(err, 'branches.createFailed'));
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('branches.title')}</h1>
          <p className="text-sm text-muted">
            {headOffice ? t('branches.subtitleHeadOffice') : t('branches.subtitleBranch')}
          </p>
        </div>
        {canCreate ? (
          <Button className="ms-auto" onClick={() => setAdding(true)}>
            {t('branches.add')}
          </Button>
        ) : null}
      </div>
      <ErrorText message={list.error} />
      <ErrorText message={rowError} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">{t('branches.code')}</th>
              <th className="px-4 py-3">{t('common.name')}</th>
              <th className="px-4 py-3">{t('branches.type')}</th>
              <th className="px-4 py-3">{t('common.status')}</th>
              {canCreate ? <th className="px-4 py-3" /> : null}
            </tr>
          </thead>
          <tbody>
            {list.data?.branches.map((b) => (
              <tr key={b.id} className="border-t border-border">
                <td className="px-4 py-3 font-mono" dir="ltr">
                  {b.code}
                </td>
                <td className="px-4 py-3">{b.name}</td>
                <td className="px-4 py-3">
                  <Badge tone={b.isHeadOffice ? 'warning' : 'neutral'}>
                    {b.isHeadOffice ? t('branches.headOffice') : t('common.branch')}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  {t.has(`branches.status.${b.status}`)
                    ? t(`branches.status.${b.status}`)
                    : b.status}
                </td>
                {canCreate ? (
                  <td className="px-4 py-2 text-end">
                    {b.isHeadOffice ? null : (
                      <Button
                        variant="outline"
                        className="h-8 px-3"
                        disabled={rowBusy !== null}
                        onClick={() => void newCode(b)}
                      >
                        {rowBusy === b.id ? t('branches.creating') : t('branches.newCode')}
                      </Button>
                    )}
                  </td>
                ) : null}
              </tr>
            ))}
            {!list.data && !list.error ? (
              <tr>
                <td colSpan={canCreate ? 5 : 4} className="px-4 py-10 text-center text-muted">
                  {t('common.loading')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {adding ? (
        <AddBranchDialog
          onClose={() => setAdding(false)}
          onIssued={(r) => {
            setAdding(false);
            setIssued(r);
            list.reload();
          }}
        />
      ) : null}
      {issued ? <CodeDialog issued={issued} onClose={() => setIssued(null)} /> : null}
    </>
  );
}

function AddBranchDialog({
  onClose,
  onIssued,
}: {
  onClose: () => void;
  onIssued: (r: Issued) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onIssued(
        await api<Issued>('/api/branches/enrollment-codes', {
          body: { code: code.trim().toUpperCase(), name: name.trim() },
        }),
      );
    } catch (err) {
      setError(errorText(err, 'branches.createFailed'));
      setBusy(false);
    }
  }

  return (
    <Modal title={t('branches.add')} onClose={onClose}>
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm text-muted">{t('branches.dialogIntro')}</p>
        <label className="block text-sm">
          {t('branches.branchCode')}
          <input
            autoFocus
            className={`${inputClass} mt-1 uppercase`}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="KHI02"
            maxLength={8}
            required
          />
        </label>
        <label className="block text-sm">
          {t('branches.branchName')}
          <input
            className={`${inputClass} mt-1`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy || code.trim().length < 2 || name.trim().length < 2}>
            {busy ? t('branches.creating') : t('branches.createCode')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CodeDialog({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const t = useT();
  return (
    <Modal title={t('branches.enrollmentTitle', { code: issued.branch.code })} onClose={onClose}>
      <div className="space-y-3">
        <SecretBox
          label={t('branches.enrollmentCode')}
          value={issued.code}
          note={t('branches.validUntil', { date: new Date(issued.expiresAt).toLocaleString() })}
        />
        <ol className="list-decimal space-y-1 ps-5 text-sm">
          <li>{t('branches.step1')}</li>
          <li>
            {t('branches.step2Before')}
            <strong>{t('branches.step2Choice')}</strong>
            {t('branches.step2After')}
          </li>
          <li>
            {t('branches.step3')}{' '}
            <span className="break-all font-mono" dir="ltr">
              {issued.cloudUrl}
            </span>
          </li>
          <li>{t('branches.step4')}</li>
          <li>{t('branches.step5')}</li>
        </ol>
        <div className="flex justify-end">
          <Button onClick={onClose}>{t('common.done')}</Button>
        </div>
      </div>
    </Modal>
  );
}
