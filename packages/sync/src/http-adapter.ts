import type { TokenProvider } from './cloud-auth';
import {
  CloudAuthError,
  StaleEpochError,
  type CloudAdapter,
  type PullRequest,
  type PullResponse,
  type PushRequest,
  type PushResponse,
} from './outbox';

export interface HttpCloudOptions {
  /** Origin of a cloud-mode instance, for example https://cloud.example.pk */
  baseUrl: string;
  /** Returns a fresh access token before every request (see RefreshingTokenProvider). */
  tokenProvider?: TokenProvider;
  /** Called once after a 401: fetch a new token (refresh) and retry the request one time. */
  forceRefresh?: () => Promise<string>;
  /** A fixed token, for tests and the legacy static-token setup. Ignored when tokenProvider is set. */
  token?: string;
  /** Per request timeout. The worker runs off the request path, so a slow cloud only delays sync. */
  timeoutMs?: number;
  /** Plain http is refused except for loopback, unless this is set (tests, private networks). */
  allowInsecure?: boolean;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Validate the configured cloud address and return its origin. */
export function normaliseCloudUrl(input: string, allowInsecure = false): string {
  const url = new URL(input.trim());
  if (url.username || url.password)
    throw new Error('The cloud address must not contain credentials');
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && (allowInsecure || LOOPBACK.has(url.hostname)))
  ) {
    throw new Error('The cloud address must use https');
  }
  return url.origin;
}

/**
 * Talks to a cloud-mode instance of this same app: `POST /api/sync/push` and `POST /api/sync/pull`
 * with a device token. Maps the two typed failures (stale epoch, revoked token) to their errors;
 * every other failure is thrown as a plain error and treated as "offline" by the worker.
 */
export class HttpCloudAdapter implements CloudAdapter {
  private readonly base: string;
  private readonly doFetch: typeof fetch;

  constructor(private readonly options: HttpCloudOptions) {
    this.base = normaliseCloudUrl(options.baseUrl, options.allowInsecure);
    this.doFetch = options.fetch ?? fetch;
  }

  async push(request: PushRequest, signal?: AbortSignal): Promise<PushResponse> {
    const body = await this.post('/api/sync/push', request, signal, request.idempotencyKey);
    const parsed = body as Partial<PushResponse>;
    if (!parsed || !Array.isArray(parsed.results))
      throw new Error('Unexpected push response from the cloud');
    return { results: parsed.results, epoch: parsed.epoch };
  }

  async pull(request: PullRequest, signal?: AbortSignal): Promise<PullResponse> {
    const body = (await this.post('/api/sync/pull', request, signal)) as Partial<PullResponse>;
    if (
      !body ||
      !Array.isArray(body.changes) ||
      typeof body.cursors !== 'object' ||
      body.cursors === null
    ) {
      throw new Error('Unexpected pull response from the cloud');
    }
    return {
      changes: body.changes,
      cursors: body.cursors,
      hasMore: body.hasMore === true,
      epoch: body.epoch,
    };
  }

  private async token(): Promise<string> {
    if (this.options.tokenProvider) return this.options.tokenProvider();
    if (this.options.token) return this.options.token;
    throw new CloudAuthError('No cloud token is configured');
  }

  private async post(
    path: string,
    payload: unknown,
    signal?: AbortSignal,
    idempotencyKey?: string,
  ): Promise<unknown> {
    let res = await this.send(path, payload, await this.token(), signal, idempotencyKey);
    if ((res.status === 401 || res.status === 403) && this.options.forceRefresh) {
      // The access token may have expired or been replaced: refresh once and retry once.
      res = await this.send(
        path,
        payload,
        await this.options.forceRefresh(),
        signal,
        idempotencyKey,
      );
    }
    if (res.status === 401 || res.status === 403) throw new CloudAuthError();
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON (for example a proxy error page): handled below by status.
    }
    if (res.status === 409) {
      const err = (
        json as { error?: { code?: string; currentEpoch?: number; sentEpoch?: number } } | null
      )?.error;
      if (err?.code === 'STALE_EPOCH' && typeof err.currentEpoch === 'number') {
        const sent = (payload as { epoch?: number }).epoch ?? 0;
        throw new StaleEpochError(sent, err.currentEpoch);
      }
    }
    if (!res.ok) throw new Error(`Cloud responded with HTTP ${res.status}`);
    return json;
  }

  private send(
    path: string,
    payload: unknown,
    token: string,
    signal: AbortSignal | undefined,
    idempotencyKey: string | undefined,
  ): Promise<Response> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 30_000);
    return this.doFetch(`${this.base}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  }
}
