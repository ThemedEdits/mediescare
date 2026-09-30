'use client';

import { useState } from 'react';
import { api, Badge, Button, ErrorText, useAsync } from '@/components/ui';

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
}

const age = (s: number | null) =>
  s === null
    ? '–'
    : s < 90
      ? `${s} s`
      : s < 5400
        ? `${Math.floor(s / 60)} min`
        : `${Math.floor(s / 3600)} h`;

/** Cloud sync status, "sync now", and a one-time code for pairing a terminal to this server. */
export function SyncPanel({ canSync, canPair }: { canSync: boolean; canPair: boolean }) {
  const { data, error, reload } = useAsync(() => api<Status>('/api/sync/status'));
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setProblem(null);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Something went wrong');
    }
  }

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
                  : data.rejected > 0 || data.lastError
                    ? 'danger'
                    : data.pending > 0
                      ? 'warning'
                      : 'success'
              }
            >
              {data.enabled ? data.state : 'cloud sync is off'}
            </Badge>
            <span className="text-muted">
              {data.enabled
                ? `Cloud: ${data.cloudHost ?? '–'}`
                : 'Everything is saved on this PC. Set the cloud address to turn syncing on.'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Waiting to send" value={String(data.pending)} />
            <Stat label="Oldest waiting" value={age(data.oldestPendingAgeSeconds)} />
            <Stat label="Refused by cloud" value={String(data.rejected)} />
            <Stat
              label="Last success"
              value={data.lastSuccessAt ? data.lastSuccessAt.slice(0, 16).replace('T', ' ') : '–'}
            />
          </div>
          {data.lastError ? (
            <p className="text-danger">Last problem: {data.lastError.message}</p>
          ) : null}
          {data.clockSkewSuspected ? (
            <p className="text-warning">
              This PC&apos;s clock looks wrong. Correct the date and time.
            </p>
          ) : null}
          <p className="text-xs text-muted">
            Server epoch {data.serverEpoch}. It rises when a standby PC is promoted, so an old
            server cannot push stale data.
          </p>
        </>
      ) : null}
      {msg ? (
        <p role="status" className="text-success">
          {msg}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canSync && data?.enabled ? (
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
    </div>
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
