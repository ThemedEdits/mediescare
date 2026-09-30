import { DeviceRevokedError, type TokenPair, type TokenProvider } from './cloud-auth';
import { refreshTokens } from './cloud-client';
import type { StoredCloudAuth, TokenStore } from './token-store';

/** What the sync runner needs from a token source besides the token itself. */
export interface TokenSession {
  /** Refresh now if there is no usable access token. Throws `DeviceRevokedError` when revoked. */
  ensureFresh(): Promise<void>;
  /** True once the cloud refused the refresh token for good. */
  readonly revoked: boolean;
}

export interface RefreshingTokenProviderOptions {
  store: TokenStore;
  /** Already loaded credentials (the caller usually loaded them to find the cloud URL). */
  stored?: StoredCloudAuth;
  /** An access token that is still valid (right after enrolling), to skip the first refresh. */
  initial?: { accessToken: string; accessExpiresAt: string };
  /** Refresh this long before the access token expires. Default 60 s. */
  marginMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Keeps a valid access token for the sync adapter:
 * - refreshes on first use (runner start), and again shortly before expiry;
 * - `forceRefresh()` is called once after a 401;
 * - every refresh returns a NEW refresh token that is saved before the old one is forgotten;
 * - when the cloud says the device is revoked (or the refresh token is unusable) it remembers that
 *   and throws `DeviceRevokedError` forever after, so the runner can stop instead of looping.
 *
 * Concurrent callers share one in-flight refresh (a second refresh with the old token would look
 * like token theft to the cloud).
 */
export class RefreshingTokenProvider implements TokenSession {
  private access: string | null;
  private expiresAtMs = 0;
  private inFlight: Promise<string> | null = null;
  private revokedFlag = false;
  private current: StoredCloudAuth | null;

  constructor(private readonly o: RefreshingTokenProviderOptions) {
    this.current = o.stored ?? null;
    this.access = o.initial?.accessToken ?? null;
    this.expiresAtMs = o.initial ? Date.parse(o.initial.accessExpiresAt) : 0;
  }

  private now(): number {
    return (this.o.now ?? Date.now)();
  }

  get revoked(): boolean {
    return this.revokedFlag;
  }

  /** The function to hand to `HttpCloudAdapter` and `createEnrollmentCode`. */
  provider(): TokenProvider {
    return () => this.getAccessToken();
  }

  async getAccessToken(): Promise<string> {
    if (this.revokedFlag) throw new DeviceRevokedError();
    if (this.access && this.now() < this.expiresAtMs - (this.o.marginMs ?? 60_000)) {
      return this.access;
    }
    return this.refresh();
  }

  async ensureFresh(): Promise<void> {
    await this.getAccessToken();
  }

  /** Refresh regardless of expiry (after the cloud answered 401 to a token we thought was valid). */
  forceRefresh(): Promise<string> {
    if (this.revokedFlag) return Promise.reject(new DeviceRevokedError());
    return this.refresh();
  }

  private refresh(): Promise<string> {
    this.inFlight ??= this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(): Promise<string> {
    this.current ??= await this.o.store.load();
    if (!this.current) {
      this.revokedFlag = true;
      throw new DeviceRevokedError('This PC is not connected to the cloud.');
    }
    let pair: TokenPair;
    try {
      pair = await refreshTokens({
        cloudUrl: this.current.cloudUrl,
        refreshToken: this.current.refreshToken,
        fetchImpl: this.o.fetchImpl,
      });
    } catch (error) {
      if (error instanceof DeviceRevokedError) this.revokedFlag = true;
      throw error;
    }
    const next: StoredCloudAuth = {
      ...this.current,
      refreshToken: pair.refreshToken,
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.current = next;
    this.access = pair.accessToken;
    this.expiresAtMs = Date.parse(pair.accessExpiresAt);
    try {
      await this.o.store.save(next);
    } catch (error) {
      // The old refresh token is already dead in the cloud, so keep working from memory and say so
      // loudly: after a restart this device would need to be reconnected.
      console.error(
        '[sync] could not save the rotated cloud credentials:',
        error instanceof Error ? error.message : 'unknown error',
      );
    }
    return pair.accessToken;
  }
}
