'use client';

import { useState } from 'react';
import { useT } from '@/i18n/client';
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
import { PasswordInput } from '@/components/password-input';

interface BackupRow {
  id: string;
  sizeBytes: number;
  sha256: string;
  kind: string;
  createdAt: string;
  verifiedAt: string | null;
}
interface Listing {
  backups: BackupRow[];
  folder: string;
  recoveryKeyConfigured: boolean;
}

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;

export function BackupsClient({
  canCreate,
  canRotate,
}: {
  canCreate: boolean;
  canRotate: boolean;
}) {
  const t = useT();
  const errorText = useErrorText();
  const list = useAsync(() => api<Listing>('/api/backups'));
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState<BackupRow | null>(null);
  const [rotating, setRotating] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<string | void>) {
    setBusy(true);
    setNotice(null);
    try {
      const extra = await fn();
      setNotice(extra || label);
      list.reload();
    } catch (e) {
      setNotice(errorText(e, 'backups.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('backups.title')}</h1>
          <p className="text-sm text-muted">
            {list.data ? t('backups.introIn', { folder: list.data.folder }) : t('backups.intro')}
          </p>
        </div>
        <span className="ms-auto flex gap-2">
          {canRotate ? (
            <Button variant="outline" onClick={() => setRotating(true)}>
              {t('backups.newKey')}
            </Button>
          ) : null}
          {canCreate ? (
            <Button
              disabled={busy}
              onClick={() =>
                run(t('backups.created'), async () => {
                  await api('/api/backups', { method: 'POST', body: {} });
                })
              }
            >
              {busy ? t('backups.working') : t('backups.backUpNow')}
            </Button>
          ) : null}
        </span>
      </div>
      {list.data && !list.data.recoveryKeyConfigured ? (
        <p role="alert" className="rounded-[6px] bg-[#FEF3C7] px-4 py-3 text-sm text-warning">
          {t('backups.noKeyWarning')}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="rounded-[6px] bg-primary-50 px-4 py-2 text-sm text-primary-900">
          {notice}
        </p>
      ) : null}
      <ErrorText message={list.error} />
      <div className="overflow-x-auto rounded-[10px] border border-border">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-start text-xs uppercase text-muted">
            <tr>
              <th className="px-4 py-3">{t('backups.colCreated')}</th>
              <th className="px-4 py-3">{t('backups.colType')}</th>
              <th className="px-4 py-3">{t('backups.colSize')}</th>
              <th className="px-4 py-3">{t('backups.colChecksum')}</th>
              <th className="px-4 py-3 text-end">{t('common.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.backups.map((b) => (
              <tr key={b.id} className="border-t border-border">
                <td className="px-4 py-3">{new Date(b.createdAt).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <Badge tone={b.kind === 'manual' ? 'warning' : 'neutral'}>
                    {t.has(`backups.kind.${b.kind}`) ? t(`backups.kind.${b.kind}`) : b.kind}
                  </Badge>
                </td>
                <td className="px-4 py-3" dir="ltr">
                  {mb(b.sizeBytes)}
                </td>
                <td className="px-4 py-3 font-mono text-xs" dir="ltr">
                  {b.sha256.slice(0, 12)}…
                </td>
                <td className="px-4 py-3 text-end">
                  <Button
                    variant="ghost"
                    className="h-8 px-2"
                    disabled={busy}
                    onClick={() =>
                      run('', async () => {
                        const r = await api<{ ok: boolean; problem?: string }>(
                          '/api/backups/verify',
                          { body: { id: b.id } },
                        );
                        return r.ok
                          ? t('backups.verified')
                          : t('backups.problem', { problem: r.problem ?? '' });
                      })
                    }
                  >
                    {t('backups.verify')}
                  </Button>
                  {canCreate ? (
                    <Button variant="ghost" className="h-8 px-2" onClick={() => setExporting(b)}>
                      {t('backups.copyToDrive')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
            {list.data && list.data.backups.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  {t('backups.empty')}
                </td>
              </tr>
            ) : null}
            {!list.data && !list.error ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  {t('common.loading')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">
        {t('backups.restoreLead')} <strong>{t('backups.restoreMenu')}</strong>
        {t('backups.restoreStop')} {t('backups.restoreTail')}
      </p>

      {exporting ? (
        <ExportDialog
          backup={exporting}
          onClose={() => setExporting(null)}
          onDone={(file) => {
            setExporting(null);
            setNotice(t('backups.copiedVerified', { file }));
          }}
        />
      ) : null}
      {rotating ? (
        <RotateDialog
          onClose={() => setRotating(false)}
          onKey={(k) => {
            setRotating(false);
            setNewKey(k);
            list.reload();
          }}
        />
      ) : null}
      {newKey ? (
        <Modal title={t('backups.newKeyTitle')} onClose={() => undefined}>
          <SecretBox
            label={t('backups.newKeyLabel')}
            value={newKey}
            note={t('backups.newKeyNote')}
          />
          <Button className="mt-4 w-full" onClick={() => setNewKey(null)}>
            {t('backups.savedIt')}
          </Button>
        </Modal>
      ) : null}
    </>
  );
}

function ExportDialog({
  backup,
  onClose,
  onDone,
}: {
  backup: BackupRow;
  onClose: () => void;
  onDone: (file: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [dest, setDest] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={t('backups.exportTitle')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const r = await api<{ file: string }>('/api/backups/export', {
              body: { id: backup.id, destination: dest },
            });
            onDone(r.file);
          } catch (err) {
            setError(errorText(err, 'backups.copyFailed'));
            setBusy(false);
          }
        }}
      >
        <label className="block text-sm">
          {t('backups.exportFolder')}
          <input
            className={`${inputClass} mt-1`}
            placeholder="E:\Mediescare Backups"
            dir="ltr"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            required
          />
        </label>
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={busy || dest.length < 3}>
            {busy ? t('backups.copying') : t('backups.copyAndVerify')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RotateDialog({ onClose, onKey }: { onClose: () => void; onKey: (key: string) => void }) {
  const t = useT();
  const errorText = useErrorText();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={t('backups.rotateTitle')} onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const r = await api<{ recoveryKey: string }>('/api/recovery/rotate', {
              body: { password },
            });
            onKey(r.recoveryKey);
          } catch (err) {
            setError(errorText(err, 'backups.failed'));
          }
        }}
      >
        <p className="text-sm text-muted">{t('backups.rotateHelp')}</p>
        <PasswordInput
          className={inputClass}
          autoComplete="current-password"
          aria-label={t('backups.yourPassword')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <ErrorText message={error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!password}>
            {t('backups.createKey')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
