'use client';

import { useEffect, useState } from 'react';
import { api, Badge, Button, ErrorText, inputClass, Modal, useAsync } from '@/components/ui';

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

const age = (s: number | null) =>
  s === null
    ? '–'
    : s < 90
      ? `${s} s`
      : s < 5400
        ? `${Math.floor(s / 60)} min`
        : `${Math.floor(s / 3600)} h`;

/**
 * Cloud sync: connection, progress of the first upload, "sync now", connect (Head Office PC) and
 * disconnect, and a one-time code for pairing a terminal to this server. Tokens, codes and
 * passwords never appear here; only the cloud host is shown.
 */
export function SyncPanel({ canSync, canPair }: { canSync: boolean; canPair: boolean }) {
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
      setProblem(e instanceof Error ? e.message : 'Something went wrong');
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
                ? 'Not connected'
                : data.state === 'revoked'
                  ? 'Disconnected by cloud'
                  : data.state}
            </Badge>
            <span className="text-muted">
              {data.enabled
                ? `Cloud: ${data.cloudHost ?? '–'}`
                : 'Everything is saved on this PC. Connect to a cloud to back up and share data between branches.'}
            </span>
          </div>
          {data.initialUpload ? <InitialUpload progress={data.initialUpload} /> : null}
          {data.enabled ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Waiting to send" value={String(data.pending)} />
              <Stat label="Oldest waiting" value={age(data.oldestPendingAgeSeconds)} />
              <Stat label="Refused by cloud" value={String(data.rejected)} />
              <Stat
                label="Last success"
                value={data.lastSuccessAt ? data.lastSuccessAt.slice(0, 16).replace('T', ' ') : '–'}
              />
            </div>
          ) : null}
          {data.lastError ? (
            <p className="text-danger">Last problem: {data.lastError.message}</p>
          ) : null}
          {data.clockSkewSuspected ? (
            <p className="text-warning">
              This PC&apos;s clock looks wrong. Correct the date and time.
            </p>
          ) : null}
          {data.enabled ? (
            <p className="text-xs text-muted">
              Server epoch {data.serverEpoch}. It rises when a standby PC is promoted, so an old
              server cannot push stale data.
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
                setMsg('Sync started.');
                reload();
              })
            }
          >
            Sync now
          </Button>
        ) : null}
        {canSync && data?.enabled ? (
          <Button variant="ghost" onClick={() => setConfirmDisconnect(true)}>
            Disconnect
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
            New terminal pairing code
          </Button>
        ) : null}
      </div>
      {code ? (
        <div className="rounded-[10px] border border-primary-600 bg-primary-50 p-3 text-center">
          <p className="text-xs text-muted">
            Enter this on the terminal within 10 minutes. It works once.
          </p>
          <p className="font-mono text-3xl font-bold tracking-widest" data-testid="pairing-code">
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
        <Modal title="Disconnect from the cloud?" onClose={() => setConfirmDisconnect(false)}>
          <p className="text-sm">
            This PC stops syncing and forgets the cloud login. Nothing on this PC is deleted: all
            sales, items and stock stay. Changes not yet uploaded wait until you connect again.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() =>
                void run(async () => {
                  await api('/api/sync/disconnect', { body: {} });
                  setConfirmDisconnect(false);
                  setMsg('Disconnected. Your data on this PC is unchanged.');
                  reload();
                })
              }
            >
              Disconnect
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
  const pct =
    progress.total === 0 ? 0 : Math.min(100, Math.floor((progress.sent / progress.total) * 100));
  return (
    <div className="rounded-[10px] border border-border p-3" data-testid="initial-upload">
      <p className="font-medium">
        Uploading everything saved so far
        {progress.active ? '…' : ' (paused)'}
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
        {progress.sent.toLocaleString()} of {progress.total.toLocaleString()} records ({pct}%). You
        can keep working; if the internet drops, it continues from where it stopped.
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
      onDone('Connected. Uploading your data in the background.');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not connect');
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
          {reconnect ? 'Reconnect to the cloud' : 'Connect to cloud'}
        </h3>
        <p className="text-xs text-muted">
          For the Head Office PC. Use the cloud address and the bootstrap code you were given. A
          branch PC joins from its setup screen with a code created at Head Office instead.
        </p>
      </div>
      <ErrorText message={problem} />
      <label className="block">
        <span className="mb-1 block text-xs font-medium">Cloud address</span>
        <input
          className={inputClass}
          placeholder="https://your-cloud.vercel.app"
          value={cloudUrl}
          onChange={(e) => setCloudUrl(e.target.value)}
          autoComplete="off"
          inputMode="url"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium">Bootstrap code</span>
        <input
          className={inputClass}
          type="password"
          value={bootstrapCode}
          onChange={(e) => setBootstrapCode(e.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium">Organisation name</span>
        <input
          className={inputClass}
          value={organisationName}
          onChange={(e) => setOrganisationName(e.target.value)}
          autoComplete="off"
        />
      </label>
      <Button type="submit" disabled={!ready || busy}>
        {busy ? 'Connecting…' : reconnect ? 'Reconnect' : 'Connect'}
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
