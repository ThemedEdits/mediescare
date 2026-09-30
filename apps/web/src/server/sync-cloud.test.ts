import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import {
  HttpCloudAdapter,
  HybridLogicalClock,
  InMemoryCloudStore,
  StaleEpochError,
  SYNC_SCHEMA_VERSION,
  newId,
  type SyncEvent,
} from '@mediescare/sync';
import {
  getCloudStore,
  handleCloudPull,
  handleCloudPush,
  NotImplementedCloudStore,
  RequestLimiter,
} from './sync-cloud';

const TENANT = '11111111-1111-7111-8111-111111111111';
const BRANCH = '33333333-3333-7333-8333-333333333333';
const DEVICE = '55555555-5555-7555-8555-555555550002';
const TOKEN = 'device-token-for-tests-0123456789';
const BEARER = `Bearer ${TOKEN}`;
const clock = new HybridLogicalClock('abcdef01', () => Date.parse('2026-10-01T09:00:00Z'));

function store() {
  const s = new InMemoryCloudStore({ now: () => Date.parse('2026-10-01T09:00:00Z') });
  s.registerDevice(TOKEN, {
    tenantId: TENANT,
    branchId: BRANCH,
    deviceId: DEVICE,
    headOffice: false,
  });
  return s;
}

const wireEvent = (over: Record<string, unknown> = {}) => ({
  id: newId(),
  seq: 1,
  entityType: 'sales',
  entityId: 'sale-1',
  op: 'insert',
  payload: { total: 10 },
  hlc: clock.tick(),
  deviceId: DEVICE,
  branchId: BRANCH,
  tenantId: TENANT,
  schemaVersion: SYNC_SCHEMA_VERSION,
  ...over,
});

const push = (
  s: InMemoryCloudStore,
  body: unknown,
  auth: string | null = BEARER,
  limiter?: RequestLimiter,
) => handleCloudPush(s, auth, typeof body === 'string' ? body : JSON.stringify(body), limiter);

describe('cloud push endpoint logic', () => {
  it('needs a valid device token', async () => {
    const s = store();
    const body = { idempotencyKey: 'k', epoch: 1, events: [] };
    expect((await push(s, body, null)).status).toBe(401);
    expect((await push(s, body, 'Bearer wrong-token-wrong-token')).status).toBe(401);
    expect((await push(s, body, 'Basic abc')).status).toBe(401);
  });

  it('applies idempotently: the same batch twice gives applied then duplicate', async () => {
    const s = store();
    const e = wireEvent();
    const body = { idempotencyKey: e.id, epoch: 1, events: [e] };
    const first = await push(s, body);
    const second = await push(s, body);
    expect(first.status).toBe(200);
    expect((first.body as { results: { status: string }[] }).results[0]?.status).toBe('applied');
    expect((second.body as { results: { status: string }[] }).results[0]?.status).toBe('duplicate');
    expect(s.appliedIds).toHaveLength(1);
  });

  it('answers 409 STALE_EPOCH with the current epoch', async () => {
    const s = store();
    await push(s, { idempotencyKey: 'a', epoch: 3, events: [] });
    const res = await push(s, { idempotencyKey: 'b', epoch: 2, events: [wireEvent()] });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { code: 'STALE_EPOCH', currentEpoch: 3, sentEpoch: 2 } });
    expect(s.appliedIds).toHaveLength(0);
  });

  it('validates the body with Zod and refuses oversized or non-JSON bodies', async () => {
    const s = store();
    await expect(push(s, { idempotencyKey: 'k', epoch: 0, events: [] })).rejects.toThrow(); // epoch >= 1
    await expect(
      push(s, { idempotencyKey: 'k', epoch: 1, events: [{ ...wireEvent(), hlc: 'bad' }] }),
    ).rejects.toThrow();
    await expect(
      push(s, { idempotencyKey: 'k', epoch: 1, events: [{ ...wireEvent(), op: 'delete' }] }),
    ).rejects.toThrow();
    expect((await push(s, 'not json')).status).toBe(400);
    expect((await push(s, 'x'.repeat(5_000_001))).status).toBe(413);
  });

  it('cannot post events for another branch (checked on the event, not the connection)', async () => {
    const s = store();
    const res = await push(s, {
      idempotencyKey: 'k',
      epoch: 1,
      events: [wireEvent({ branchId: '44444444-4444-7444-8444-444444444444' })],
    });
    expect(
      (res.body as { results: { status: string; reason?: string }[] }).results[0],
    ).toMatchObject({ status: 'rejected', reason: 'scope_mismatch_branch' });
  });

  it('rate limits a device', async () => {
    const s = store();
    const limiter = new RequestLimiter(2, 60_000);
    const body = { idempotencyKey: 'k', epoch: 1, events: [] };
    expect((await push(s, body, BEARER, limiter)).status).toBe(200);
    expect((await push(s, body, BEARER, limiter)).status).toBe(200);
    expect((await push(s, body, BEARER, limiter)).status).toBe(429);
  });
});

describe('cloud pull endpoint logic', () => {
  it('requires auth and validates cursors', async () => {
    const s = store();
    expect((await handleCloudPull(s, null, '{}')).status).toBe(401);
    await expect(
      handleCloudPull(s, BEARER, JSON.stringify({ cursors: { items: 'abc' }, limit: 10 })),
    ).rejects.toThrow();
    const ok = await handleCloudPull(
      s,
      BEARER,
      JSON.stringify({ cursors: { items: '0' }, limit: 10 }),
    );
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ changes: [], hasMore: false });
  });
});

describe('cloud store selection', () => {
  it('is off outside cloud mode', () => {
    expect(getCloudStore({ MEDIESCARE_MODE: 'branch-server' })).toBeNull();
    expect(getCloudStore({})).toBeNull();
  });

  it('cloud mode without a real store fails loudly instead of pretending to sync', async () => {
    const s = new NotImplementedCloudStore();
    await expect(handleCloudPush(s, BEARER, '{}')).rejects.toThrow(/not implemented/);
  });
});

describe('HttpCloudAdapter against the real endpoint logic', () => {
  async function withServer<T>(
    s: InMemoryCloudStore,
    run: (adapter: HttpCloudAdapter) => Promise<T>,
  ): Promise<T> {
    const http = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        const handler = req.url === '/api/sync/pull' ? handleCloudPull : handleCloudPush;
        handler(s, req.headers.authorization, body)
          .then((r) => {
            res.writeHead(r.status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(r.body));
          })
          .catch(() => {
            res.writeHead(400);
            res.end('{}');
          });
      });
    });
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = http.address() as AddressInfo;
      return await run(new HttpCloudAdapter({ baseUrl: `http://127.0.0.1:${port}`, token: TOKEN }));
    } finally {
      http.close();
    }
  }

  it('round-trips push and pull, including composite entity ids like the real outbox emits', async () => {
    const s = store();
    const composite = wireEvent({
      entityType: 'user_roles',
      entityId: `${newId()}:${newId()}`,
    }) as unknown as SyncEvent;
    await withServer(s, async (adapter) => {
      const res = await adapter.push({
        idempotencyKey: composite.id,
        epoch: 1,
        events: [composite],
      });
      expect(res.results).toEqual([{ id: composite.id, status: 'applied' }]);
      const again = await adapter.push({
        idempotencyKey: composite.id,
        epoch: 1,
        events: [composite],
      });
      expect(again.results[0]?.status).toBe('duplicate');
      const pulled = await adapter.pull?.({ cursors: { user_roles: '0' }, limit: 10 });
      expect(pulled?.cursors.user_roles).toBe('1');
      expect(pulled?.changes).toHaveLength(0); // its own event is not echoed back
    });
  });

  it('surfaces a stale epoch as the typed error', async () => {
    const s = store();
    await withServer(s, async (adapter) => {
      await adapter.push({ idempotencyKey: 'a', epoch: 2, events: [] });
      await expect(
        adapter.push({ idempotencyKey: 'b', epoch: 1, events: [] }),
      ).rejects.toBeInstanceOf(StaleEpochError);
    });
  });
});
