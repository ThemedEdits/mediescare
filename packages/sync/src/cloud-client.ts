import {
  CloudRequestError,
  DeviceRevokedError,
  type DeviceIdentity,
  type EnrollResult,
  type TokenPair,
  type TokenProvider,
} from './cloud-auth';
import { normaliseCloudUrl } from './http-adapter';

/**
 * Client side of the device endpoints: `enroll`, `bootstrapHeadOffice`, `createEnrollmentCode` and
 * the token refresh. Plain `fetch`, no cloud SDK. Secrets (codes, tokens) are never put in error
 * messages.
 */

const DEFAULT_TIMEOUT_MS = 20_000;

interface PostOptions {
  cloudUrl: string;
  path: string;
  body: unknown;
  bearer?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function post(o: PostOptions): Promise<unknown> {
  const base = normaliseCloudUrl(o.cloudUrl);
  const doFetch = o.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(`${base}${o.path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(o.bearer ? { authorization: `Bearer ${o.bearer}` } : {}),
      },
      body: JSON.stringify(o.body),
      signal: AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new CloudRequestError(
      `Could not reach the cloud at ${new URL(base).host} (${error instanceof Error ? error.message : 'network error'})`,
      null,
      null,
    );
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Not JSON (a proxy error page): handled by status below.
  }
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | null)?.error;
    throw new CloudRequestError(
      err?.message ?? friendlyStatus(res.status, err?.code),
      res.status,
      err?.code ?? null,
    );
  }
  return json;
}

function friendlyStatus(status: number, code: string | undefined): string {
  if (code === 'BOOTSTRAP_CODE_WRONG') return 'The bootstrap code is wrong';
  if (code === 'BOOTSTRAP_DISABLED') return 'This cloud has no bootstrap code configured';
  if (code === 'ORGANISATION_EXISTS')
    return 'This organisation already exists in the cloud. Use an enrollment code for a new branch.';
  if (code === 'INVALID_CODE') return 'The enrollment code is wrong, expired or already used';
  if (code === 'RATE_LIMITED' || status === 429)
    return 'Too many attempts. Wait a minute and try again.';
  if (code === 'FORBIDDEN') return 'Only a Head Office device can create enrollment codes';
  if (code === 'CLOUD_DB_UNREACHABLE' || code === 'CLOUD_NOT_MIGRATED')
    return 'The cloud database is not ready. Ask the administrator to check the cloud setup.';
  if (status === 404) return 'This address is not a Mediescare cloud endpoint';
  return `The cloud refused the request (HTTP ${status})`;
}

function isEnrollResult(v: unknown): v is EnrollResult {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<EnrollResult>;
  const b = r.branch as Partial<EnrollResult['branch']> | undefined;
  return (
    typeof r.deviceId === 'string' &&
    typeof r.tenantId === 'string' &&
    typeof r.tenantName === 'string' &&
    typeof r.accessToken === 'string' &&
    typeof r.refreshToken === 'string' &&
    typeof r.accessExpiresAt === 'string' &&
    !!b &&
    typeof b.id === 'string' &&
    typeof b.code === 'string' &&
    typeof b.name === 'string' &&
    typeof b.isHeadOffice === 'boolean'
  );
}

function isTokenPair(v: unknown): v is TokenPair {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Partial<TokenPair>;
  return (
    typeof r.accessToken === 'string' &&
    typeof r.refreshToken === 'string' &&
    typeof r.accessExpiresAt === 'string'
  );
}

/** A new branch joins with the one-time code a Head Office admin created. */
export async function enroll(input: {
  cloudUrl: string;
  code: string;
  deviceName: string;
  fetchImpl?: typeof fetch;
  /** An existing branch database asks the cloud to adopt its ids (see `DeviceIdentity`). */
  identity?: Pick<DeviceIdentity, 'branchId' | 'deviceId'>;
}): Promise<EnrollResult> {
  const json = await post({
    cloudUrl: input.cloudUrl,
    path: '/api/sync/enroll',
    body: {
      code: input.code.trim(),
      deviceName: input.deviceName.trim(),
      ...(input.identity ? { identity: input.identity } : {}),
    },
    fetchImpl: input.fetchImpl,
  });
  if (!isEnrollResult(json))
    throw new CloudRequestError('Unexpected answer from the cloud', 200, null);
  return json;
}

/** The first Head Office PC creates the organisation in the cloud (needs the cloud's bootstrap code). */
export async function bootstrapHeadOffice(input: {
  cloudUrl: string;
  bootstrapCode: string;
  organisationName: string;
  branchCode: string;
  branchName: string;
  deviceName: string;
  fetchImpl?: typeof fetch;
  /** The ids already used by this PC's database, so its existing events are accepted. */
  identity?: DeviceIdentity;
}): Promise<EnrollResult> {
  const json = await post({
    cloudUrl: input.cloudUrl,
    path: '/api/sync/bootstrap',
    body: {
      bootstrapCode: input.bootstrapCode.trim(),
      organisationName: input.organisationName.trim(),
      branchCode: input.branchCode.trim(),
      branchName: input.branchName.trim(),
      deviceName: input.deviceName.trim(),
      ...(input.identity ? { identity: input.identity } : {}),
    },
    fetchImpl: input.fetchImpl,
  });
  if (!isEnrollResult(json))
    throw new CloudRequestError('Unexpected answer from the cloud', 200, null);
  return json;
}

/**
 * A Head Office device creates a one-time code (valid 24 hours) for a new branch. `branchId` is the id
 * Head Office already gave the branch row locally: `enroll` then returns exactly that id as
 * `branch.id` (the cloud only generates one when none is given).
 */
export async function createEnrollmentCode(
  provider: TokenProvider,
  input: {
    cloudUrl: string;
    branchCode: string;
    branchName: string;
    branchId?: string;
    fetchImpl?: typeof fetch;
  },
): Promise<{ code: string; expiresAt: string }> {
  const json = (await post({
    cloudUrl: input.cloudUrl,
    path: '/api/sync/enrollment-codes',
    body: {
      branchCode: input.branchCode.trim(),
      branchName: input.branchName.trim(),
      ...(input.branchId ? { branchId: input.branchId } : {}),
    },
    bearer: await provider(),
    fetchImpl: input.fetchImpl,
  })) as { code?: unknown; expiresAt?: unknown } | null;
  if (typeof json?.code !== 'string' || typeof json.expiresAt !== 'string')
    throw new CloudRequestError('Unexpected answer from the cloud', 200, null);
  return { code: json.code, expiresAt: json.expiresAt };
}

/**
 * Trade a refresh token for a new pair. A revoked device, or a refresh token that was already
 * used, throws `DeviceRevokedError`; any other failure is a plain error (treated as offline).
 */
export async function refreshTokens(input: {
  cloudUrl: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<TokenPair> {
  try {
    const json = await post({
      cloudUrl: input.cloudUrl,
      path: '/api/sync/token',
      body: { refreshToken: input.refreshToken },
      fetchImpl: input.fetchImpl,
    });
    if (!isTokenPair(json)) throw new Error('Unexpected answer from the cloud');
    return json;
  } catch (error) {
    if (
      error instanceof CloudRequestError &&
      (error.code === 'DEVICE_REVOKED' || error.code === 'INVALID_REFRESH')
    ) {
      throw new DeviceRevokedError();
    }
    throw error;
  }
}
