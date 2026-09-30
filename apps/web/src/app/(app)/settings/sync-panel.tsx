'use client';

import { useEffect, useState } from 'react';
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

interface Status {
  enabled: boolean;
  state: string;
  pending: number;
  rejected: number;
  oldestPendingAgeSeconds: number | null;
  lastSuccessAt: string | null;
  lastError: { message: string; at: string } | null;
  clockSkewSuspected: boolean;
  serverEpoch: number;
  cloudHost: string | null;
  initialUpload: { active: boolean; sent: number; total: number } | null;
}

function ageText(t: ReturnType<typeof useT>, s: number | null): string {
  if (s === null) return '–';
  if (s < 90) return t('settings.sync.ageSeconds', { n: s });
  if (s < 5400) return t('settings.sync.ageMinutes', { n: Math.floor(s / 60) });
  return t('settings.sync.ageHours', { n: Math.floor(s / 3600) });
}

/**
 * Cloud sync: connection, progress of the first upload, "sync now", connect (Head Office PC) and
 * disconnect, and a one-time code for pairing a terminal to this server. Tokens, codes and
 * passwords never appear here; only the cloud host is shown.
 */
export function SyncPanel({ canSync, canPair }: { canSync: boolean; canPair: boolean }) {
  const t = useT();
  const errorText = useErrorText();
  const { data, error, reload } = useAsync(() => api<Status>('/api/sync/status'));
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  // Keep the numbers moving while something is being uploaded.
  const busy = data?.state === 'syncing' || data?.initialUpload?.active === true;
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(reload, 3000);
    return () => clearInterval(timer);
    // reload only bumps a counter, so it is safe to leave out of the dependencies
  }, [busy]);

  async function run(fn: () => Promise<void>) {
    setProblem(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setProblem(errorText(e, 'common.error'));
    }
  }

  const connected = Boolean(data?.enabled) && data?.state !== 'revoked';

  return (
    <div className="space-y-3 text-sm">
      <ErrorText message={error ?? problem} />
      {data ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                !data.enabled
                  ? 'neutral'
                  : data.state === 'revoked' || data.rejected > 0 || data.lastError
                    ? 'danger'
                    : data.pending > 0
                      ? 'warning'
                      : 'success'
              }
            >
              {!data.enabled
                ? t('settings.sync.notConnected')
                : data.state === 'revoked'
                  ? t('settings.sync.revokedBadge')
                  : t.has(`settings.sync.state.${data.state}`)
                    ? t(`settings.sync.state.${data.state}`)
                    : data.state}
            </Badge>
            <span className="text-muted">
              {data.enabled
                ? t('settings.sync.cloudHost', { host: data.cloudHost ?? '–' })
                : t('settings.sync.localOnly')}
            </span>
          </div>
          {data.initialUpload ? <InitialUpload progress={data.initialUpload} /> : null}
          {data.enabled ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={t('settings.sync.waiting')} value={String(data.pending)} />
              <Stat
                label={t('settings.sync.oldest')}
                value={ageText(t, data.oldestPendingAgeSeconds)}
              />
              <Stat label={t('settings.sync.refused')} value={String(data.rejected)} />
              <Stat
                label={t('settings.sync.lastSuccess')}
                value={data.lastSuccessAt ? data.lastSuccessAt.slice(0, 16).replace('T', ' ') : '–'}
              />
            </div>
          ) : null}
          {data.lastError ? (
            <p className="text-danger">
              {t('settings.sync.lastProblem', { message: data.lastError.message })}
            </p>
          ) : null}
          {data.clockSkewSuspected ? (
            <p className="text-warning">{t('settings.sync.clockWrong')}</p>
          ) : null}
          {data.enabled ? (
            <p className="text-xs text-muted">
              {t('settings.sync.epoch', { epoch: data.serverEpoch })}
            </p>
          ) : null}
        </>
      ) : null}
      {msg ? (
        <p role="status" className="text-success">
          {msg}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canSync && connected ? (
          <Button
            variant="outline"
            onClick={() =>
              void run(async () => {
                await api('/api/sync/retry', { body: {} });
                setMsg(t('settings.sync.started'));
                reload();
              })
            }
          >
            {t('settings.sync.syncNow')}
          </Button>
        ) : null}
        {canSync && data?.enabled ? (
          <Button variant="ghost" onClick={() => setConfirmDisconnect(true)}>
            {t('settings.sync.disconnect')}
          </Button>
        ) : null}
        {canPair ? (
          <Button
            variant="outline"
            onClick={() =>
              void run(async () =>
                setCode(
                  await api<{ code: string; expiresAt: string }>('/api/sync/pairing-code', {
                    body: {},
                  }),
                ),
              )
            }
          >
            {t('settings.sync.newPairing')}
          </Button>
        ) : null}
      </div>
      {code ? (
        <div className="rounded-[10px] border border-primary-600 bg-primary-50 p-3 text-center">
          <p className="text-xs text-muted">{t('settings.sync.pairingHelp')}</p>
          <p
            className="font-mono text-3xl font-bold tracking-widest"
            data-testid="pairing-code"
            dir="ltr"
          >
            {code.code}
          </p>
        </div>
      ) : null}
      {canSync && data && !connected ? (
        <ConnectForm
          reconnect={data.state === 'revoked'}
          onDone={(text) => {
            setMsg(text);
            reload();
          }}
        />
      ) : null}
      {confirmDisconnect ? (
        <Modal
          title={t('settings.sync.disconnectTitle')}
          onClose={() => setConfirmDisconnect(false)}
        >
          <p className="text-sm">{t('settings.sync.disconnectBody')}</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                void run(async () => {
                  await api('/api/sync/disconnect', { body: {} });
                  setConfirmDisconnect(false);
                  setMsg(t('settings.sync.disconnected'));
                  reload();
                })
              }
            >
              {t('settings.sync.disconnect')}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function InitialUpload({
  progress,
}: {
  progress: { active: boolean; sent: number; total: number };
}) {
  const t = useT();
  const pct =
    progress.total === 0 ? 0 : Math.min(100, Math.floor((progress.sent / progress.total) * 100));
  return (
    <div className="rounded-[10px] border border-border p-3" data-testid="initial-upload">
      <p className="font-medium">
        {progress.active ? t('settings.sync.uploading') : t('settings.sync.uploadingPaused')}
      </p>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.sent}
      >
        <div className="h-full bg-primary-600" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted tabular-nums">
        {t('settings.sync.uploadProgress', {
          sent: progress.sent.toLocaleString(),
          total: progress.total.toLocaleString(),
          pct,
        })}
      </p>
    </div>
  );
}

function ConnectForm({
  reconnect,
  onDone,
}: {
  reconnect: boolean;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const errorText = useErrorText();
  const [cloudUrl, setCloudUrl] = useState('');
  const [bootstrapCode, setBootstrapCode] = useState('');
  const [organisationName, setOrganisationName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setProblem(null);
    try {
      await api('/api/sync/connect', { body: { cloudUrl, bootstrapCode, organisationName } });
      setBootstrapCode('');
      onDone(t('settings.sync.connected'));
    } catch (e) {
      setProblem(errorText(e, 'settings.sync.connectFailed'));
    } finally {
      setBusy(false);
    }
  }

  const ready =
    cloudUrl.trim().length > 7 && bootstrapCode.trim() && organisationName.trim().length > 1;
  return (
    <form
      className="space-y-3 rounded-[10px] border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) void submit();
      }}
    >
      <div>
        <h3 className="font-semibold">
          {reconnect ? t('settings.sync.reconnectTitle') : t('settings.sync.connectTitle')}
        </h3>
        <p className="text-xs text-muted">{t('settings.sync.connectHelp')}</p>
      </div>
      <ErrorText message={problem} />
      <label className="block">
        <span className="mb-1 block text-xs font-medium">{t('settings.sync.cloudAddress')}</span>
        <input
          className={inputClass}
          placeholder="https://your-cloud.vercel.app"
          dir="ltr"
          value={cloudUrl}
          onChange={(e) => setCloudUrl(e.target.value)}
          autoComplete="off"
          inputMode="url"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium">{t('settings.sync.bootstrapCode')}</span>
        <input
          className={inputClass}
          type="password"
          value={bootstrapCode}
          onChange={(e) => setBootstrapCode(e.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium">
          {t('settings.sync.organisationName')}
        </span>
        <input
          className={inputClass}
          value={organisationName}
          onChange={(e) => setOrganisationName(e.target.value)}
          autoComplete="off"
        />
      </label>
      <Button type="submit" disabled={!ready || busy}>
        {busy
          ? t('settings.sync.connecting')
          : reconnect
            ? t('settings.sync.reconnect')
            : t('settings.sync.connect')}
      </Button>
    </form>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-border p-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}
