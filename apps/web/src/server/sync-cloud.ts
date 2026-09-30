import {
  InMemoryCloudStore,
  StaleEpochError,
  type CloudStore,
  type DeviceAuth,
  type PullRequest,
  type PushRequest,
} from '@mediescare/sync';
import { MAX_SYNC_BODY_CHARS, PullBodySchema, PushBodySchema } from './sync-schemas';

/**
 * Cloud-mode request handling for `/api/sync/push` and `/api/sync/pull`. Kept free of Next types
 * so it is unit tested directly. Steps: size limit, bearer device token, rate limit, Zod validation,
 * then the `CloudStore` (which owns idempotency, epoch fencing and merge rules).
 */
export interface CloudHttpResult {
  status: number;
  body: unknown;
}

const fail = (
  status: number,
  code: string,
  extra: Record<string, unknown> = {},
): CloudHttpResult => ({
  status,
  body: { error: { code, ...extra } },
});

/** Sliding-window request limiter per device token. In memory: one cloud process, good enough for a brake. */
export class RequestLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now();
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(t);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.hits.clear(); // bound memory under a token-guessing flood
    return true;
  }
}

const limiter = new RequestLimiter(240, 60_000);

async function authorise(
  store: CloudStore,
  authorization: string | null | undefined,
  rateLimiter: RequestLimiter,
): Promise<DeviceAuth | CloudHttpResult> {
  const match = /^Bearer (\S{10,300})$/.exec(authorization ?? '');
  if (!match) return fail(401, 'UNAUTHENTICATED');
  const token = match[1] as string;
  const auth = await store.authenticate(token);
  if (!auth) return fail(401, 'UNAUTHENTICATED');
  if (!rateLimiter.allow(`${auth.tenantId}|${auth.deviceId}`)) return fail(429, 'RATE_LIMITED');
  return auth;
}

function parseBody(raw: string): unknown | CloudHttpResult {
  if (raw.length > MAX_SYNC_BODY_CHARS) return fail(413, 'PAYLOAD_TOO_LARGE');
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return fail(400, 'INVALID_INPUT');
  }
}

const isResult = (v: unknown): v is CloudHttpResult =>
  typeof v === 'object' && v !== null && 'status' in v && 'body' in v;

export async function handleCloudPush(
  store: CloudStore,
  authorization: string | null | undefined,
  rawBody: string,
  rateLimiter: RequestLimiter = limiter,
): Promise<CloudHttpResult> {
  const auth = await authorise(store, authorization, rateLimiter);
  if (isResult(auth)) return auth;
  const json = parseBody(rawBody);
  if (isResult(json)) return json;
  const request: PushRequest = PushBodySchema.parse(json);
  try {
    return { status: 200, body: await store.applyBatch(auth, request) };
  } catch (error) {
    if (error instanceof StaleEpochError) {
      return fail(409, 'STALE_EPOCH', {
        currentEpoch: error.currentEpoch,
        sentEpoch: error.sentEpoch,
      });
    }
    throw error;
  }
}

export async function handleCloudPull(
  store: CloudStore,
  authorization: string | null | undefined,
  rawBody: string,
  rateLimiter: RequestLimiter = limiter,
): Promise<CloudHttpResult> {
  const auth = await authorise(store, authorization, rateLimiter);
  if (isResult(auth)) return auth;
  const json = parseBody(rawBody);
  if (isResult(json)) return json;
  const request: PullRequest = PullBodySchema.parse(json);
  return { status: 200, body: await store.pull(auth, request) };
}

/**
 * PostgreSQL store: NOT IMPLEMENTED. Every method throws so that a cloud deployment without a real
 * store fails loudly (HTTP 501) instead of pretending to sync. The intended implementation:
 * one transaction per batch, `SELECT ... FOR UPDATE` on the branch epoch row (sync_epochs), an
 * `event_id` unique ledger for idempotency, the merge from `mergeMasterEvent`, and a bigserial
 * `change_seq` per tenant for pull cursors (docs/sync.md, "What remains").
 */
export class NotImplementedCloudStore implements CloudStore {
  authenticate(): Promise<DeviceAuth | null> {
    return Promise.reject(new CloudStoreNotImplementedError());
  }
  applyBatch(): Promise<never> {
    return Promise.reject(new CloudStoreNotImplementedError());
  }
  pull(): Promise<never> {
    return Promise.reject(new CloudStoreNotImplementedError());
  }
}

export class CloudStoreNotImplementedError extends Error {
  constructor() {
    super('The PostgreSQL cloud store is not implemented yet');
    this.name = 'CloudStoreNotImplementedError';
  }
}

interface DevDevice {
  token: string;
  tenantId: string;
  branchId: string;
  deviceId: string;
  headOffice?: boolean;
}

const holder = globalThis as unknown as { __mediescareCloudStore?: CloudStore };

/**
 * The store behind the cloud routes, or null when this process is not in cloud mode.
 * MEDIESCARE_CLOUD_STORE=memory selects the non-durable in-memory store for local development
 * (devices from MEDIESCARE_CLOUD_DEV_DEVICES, a JSON array). Anything else is the unimplemented
 * PostgreSQL store.
 */
export function getCloudStore(
  env: Record<string, string | undefined> = process.env,
): CloudStore | null {
  if ((env.MEDIESCARE_MODE ?? '').trim() !== 'cloud') return null;
  if (holder.__mediescareCloudStore) return holder.__mediescareCloudStore;
  let store: CloudStore;
  if (env.MEDIESCARE_CLOUD_STORE === 'memory') {
    const mem = new InMemoryCloudStore();
    const devices = JSON.parse(env.MEDIESCARE_CLOUD_DEV_DEVICES ?? '[]') as DevDevice[];
    for (const d of devices) {
      mem.registerDevice(d.token, {
        tenantId: d.tenantId,
        branchId: d.branchId,
        deviceId: d.deviceId,
        headOffice: d.headOffice === true,
      });
    }
    store = mem;
  } else {
    store = new NotImplementedCloudStore();
  }
  holder.__mediescareCloudStore = store;
  return store;
}
