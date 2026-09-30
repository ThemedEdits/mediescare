import { createHash, timingSafeEqual } from 'node:crypto';
import type { CloudAuthService } from '@mediescare/db/cloud';
import {
  authorise,
  fail,
  isResult,
  parseBody,
  RequestLimiter,
  type CloudHttpResult,
} from './sync-cloud';
import {
  BootstrapBodySchema,
  EnrollBodySchema,
  EnrollmentCodeBodySchema,
  MAX_DEVICE_BODY_CHARS,
  TokenBodySchema,
} from './sync-schemas';

/**
 * Cloud-mode request handling for the device endpoints (`bootstrap`, `enrollment-codes`, `enroll`,
 * `token`). Free of Next types so it is unit tested directly. Every endpoint is size limited,
 * Zod validated and rate limited; none of them ever returns or logs a secret except the one token
 * or code it exists to hand out, once, in the response body.
 *
 * The limiters live in process memory. On serverless hosting each warm instance has its own, so
 * they are a brake against a single client hammering one instance, not a global quota.
 */
export interface DeviceEndpointDeps {
  auth: CloudAuthService;
  /** MEDIESCARE_CLOUD_BOOTSTRAP_CODE; undefined switches bootstrap off. */
  bootstrapCode: string | undefined;
}

export class DeviceLimiters {
  /** First Head Office PC: 5 tries per 10 minutes per client address. */
  readonly bootstrap = new RequestLimiter(5, 10 * 60_000);
  /** Enrolment with a code: 10 tries a minute per client address. */
  readonly enroll = new RequestLimiter(10, 60_000);
  /** Token refresh: 30 a minute per client address (a healthy device refreshes every 14 minutes). */
  readonly token = new RequestLimiter(30, 60_000);
  /** Creating enrollment codes: 10 a minute per device. */
  readonly codes = new RequestLimiter(10, 60_000);
}

const defaultLimiters = new DeviceLimiters();

const sha = (s: string) => createHash('sha256').update(s).digest();
const sameSecret = (a: string, b: string) => timingSafeEqual(sha(a), sha(b));

function read<T>(raw: string, parse: (json: unknown) => T): T | CloudHttpResult {
  const json = parseBody(raw, MAX_DEVICE_BODY_CHARS);
  if (isResult(json)) return json;
  return parse(json);
}

export async function handleBootstrap(
  deps: DeviceEndpointDeps,
  client: string,
  rawBody: string,
  limiters: DeviceLimiters = defaultLimiters,
): Promise<CloudHttpResult> {
  if (!deps.bootstrapCode) return fail(403, 'BOOTSTRAP_DISABLED');
  if (!limiters.bootstrap.allow(client)) return fail(429, 'RATE_LIMITED');
  const body = read(rawBody, (j) => BootstrapBodySchema.parse(j));
  if (isResult(body)) return body;
  if (!sameSecret(body.bootstrapCode, deps.bootstrapCode)) return fail(403, 'BOOTSTRAP_CODE_WRONG');
  const { bootstrapCode: _code, ...input } = body;
  return { status: 201, body: await deps.auth.bootstrap(input) };
}

export async function handleEnroll(
  deps: DeviceEndpointDeps,
  client: string,
  rawBody: string,
  limiters: DeviceLimiters = defaultLimiters,
): Promise<CloudHttpResult> {
  if (!limiters.enroll.allow(client)) return fail(429, 'RATE_LIMITED');
  const body = read(rawBody, (j) => EnrollBodySchema.parse(j));
  if (isResult(body)) return body;
  return { status: 201, body: await deps.auth.enroll(body) };
}

export async function handleRefresh(
  deps: DeviceEndpointDeps,
  client: string,
  rawBody: string,
  limiters: DeviceLimiters = defaultLimiters,
): Promise<CloudHttpResult> {
  if (!limiters.token.allow(client)) return fail(429, 'RATE_LIMITED');
  const body = read(rawBody, (j) => TokenBodySchema.parse(j));
  if (isResult(body)) return body;
  return { status: 200, body: await deps.auth.refresh(body.refreshToken) };
}

export async function handleCreateEnrollmentCode(
  deps: DeviceEndpointDeps,
  authorization: string | null | undefined,
  rawBody: string,
  limiters: DeviceLimiters = defaultLimiters,
): Promise<CloudHttpResult> {
  const device = await authorise(
    { authenticate: (t) => deps.auth.verifyAccessToken(t) },
    authorization,
    limiters.codes,
  );
  if (isResult(device)) return device;
  if (!device.headOffice) return fail(403, 'FORBIDDEN');
  const body = read(rawBody, (j) => EnrollmentCodeBodySchema.parse(j));
  if (isResult(body)) return body;
  return { status: 201, body: await deps.auth.createEnrollmentCode(device, body) };
}
