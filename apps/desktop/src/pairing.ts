import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normaliseServerUrl } from './config';

/**
 * Terminal side of LAN pairing, and the sealed store for device tokens.
 *
 * Flow: an admin creates a one-time code on the branch server (POST /api/sync/pairing-code,
 * valid 10 minutes). The terminal finds the server (discovery.ts) or is given its address, asks the
 * user for the code, and exchanges it for a device token at POST /api/sync/pair.
 */
export interface PairedTerminal {
  deviceId: string;
  token: string;
  tenantId: string;
  branchId: string;
  branchCode: string;
}

export class PairingFailedError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'PairingFailedError';
  }
}

export async function pairWithServer(input: {
  serverUrl: string;
  code: string;
  deviceName: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): Promise<PairedTerminal> {
  const base = normaliseServerUrl(input.serverUrl);
  const doFetch = input.fetch ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${base}/api/sync/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: input.code.trim(), deviceName: input.deviceName.trim() }),
      signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
    });
  } catch (error) {
    throw new PairingFailedError(
      `Could not reach the branch server (${error instanceof Error ? error.message : 'network error'})`,
      null,
    );
  }
  if (res.status === 403)
    throw new PairingFailedError('The pairing code is wrong or has expired', 403);
  if (res.status === 429)
    throw new PairingFailedError('Too many attempts. Wait a minute and try again.', 429);
  if (!res.ok)
    throw new PairingFailedError(
      `The branch server refused pairing (HTTP ${res.status})`,
      res.status,
    );
  const body = (await res.json()) as Partial<PairedTerminal>;
  const { deviceId, token, tenantId, branchId, branchCode } = body;
  if (
    ![deviceId, token, tenantId, branchId, branchCode].every(
      (v) => typeof v === 'string' && v.length > 0,
    )
  ) {
    throw new PairingFailedError('Unexpected answer from the branch server', res.status);
  }
  return { deviceId, token, tenantId, branchId, branchCode } as PairedTerminal;
}

/** Wraps a secret with the OS credential store. In the app this is Electron safeStorage. */
export interface Sealer {
  seal(plain: string): string;
  unseal(blob: string): string;
}

export type TokenKind = 'terminal' | 'cloud';

/**
 * Device tokens (this terminal's token for the branch server, or this server's token for the
 * cloud) are stored sealed in the user data folder, like the database key (secrets.ts). They are
 * useless if the file is copied to another PC or Windows user.
 */
export class DeviceTokenStore {
  constructor(
    private readonly userData: string,
    private readonly sealer: Sealer,
  ) {}

  private file(kind: TokenKind): string {
    return join(this.userData, `${kind}-token.json`);
  }

  save(kind: TokenKind, token: string): void {
    const file = this.file(kind);
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ v: 1, token: this.sealer.seal(token) }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    renameSync(tmp, file);
  }

  load(kind: TokenKind): string | null {
    const file = this.file(kind);
    if (!existsSync(file)) return null;
    try {
      const stored = JSON.parse(readFileSync(file, 'utf8')) as { v?: number; token?: string };
      return stored.v === 1 && stored.token ? this.sealer.unseal(stored.token) : null;
    } catch {
      return null; // unreadable (moved to another PC): treat as not paired
    }
  }
}
