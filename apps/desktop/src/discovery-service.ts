import { startAnnouncer, type Announcer } from './discovery';

/**
 * Keeps this branch server visible on the LAN. The name and branch code come from the local
 * server (GET /api/sync/announce), which only answers after first-run setup, so the announcer
 * retries until the branch exists. Returns a stop function. Never throws: discovery is a
 * convenience, and a terminal can always be given the address by hand.
 */
export function startLanAnnouncing(input: {
  /** Local server origin, for example http://127.0.0.1:3210 */
  origin: string;
  /** Port the server listens on for the LAN. */
  port: number;
  retryMs?: number;
  fetch?: typeof fetch;
  udpPort?: number;
  broadcastAddress?: string;
  onError?: (message: string) => void;
}): () => void {
  const doFetch = input.fetch ?? fetch;
  let announcer: Announcer | null = null;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const attempt = async (): Promise<void> => {
    if (stopped) return;
    try {
      const res = await doFetch(`${input.origin}/api/sync/announce`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const info = (await res.json()) as { name?: unknown; branchCode?: unknown };
        if (typeof info.name === 'string' && typeof info.branchCode === 'string') {
          const started = await startAnnouncer({
            announcement: { name: info.name, branchCode: info.branchCode, port: input.port },
            udpPort: input.udpPort,
            broadcastAddress: input.broadcastAddress,
          });
          if (stopped) started.stop();
          else announcer = started;
          return;
        }
      }
    } catch (error) {
      input.onError?.(error instanceof Error ? error.message : 'announce failed');
    }
    if (!stopped) {
      timer = setTimeout(() => void attempt(), input.retryMs ?? 30_000);
      timer.unref();
    }
  };
  void attempt();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    announcer?.stop();
  };
}
