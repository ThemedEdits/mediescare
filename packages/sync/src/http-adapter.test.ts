import { describe, expect, it } from 'vitest';
import { HttpCloudAdapter, normaliseCloudUrl } from './http-adapter';
import { CloudAuthError, StaleEpochError } from './outbox';

const reply = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const adapter = (fetchImpl: typeof fetch) =>
  new HttpCloudAdapter({
    baseUrl: 'https://cloud.example.test',
    token: 'device-token-0123456789',
    fetch: fetchImpl,
  });

describe('cloud url', () => {
  it('requires https except for loopback, and forbids credentials', () => {
    expect(normaliseCloudUrl('https://cloud.example.test/')).toBe('https://cloud.example.test');
    expect(normaliseCloudUrl('http://localhost:4000')).toBe('http://localhost:4000');
    expect(() => normaliseCloudUrl('http://cloud.example.test')).toThrow(/https/);
    expect(normaliseCloudUrl('http://10.0.0.5:4000', true)).toBe('http://10.0.0.5:4000');
    expect(() => normaliseCloudUrl('https://user:pw@cloud.example.test')).toThrow(/credentials/);
  });
});

describe('HttpCloudAdapter', () => {
  it('sends the bearer token, idempotency key and epoch, and returns the results', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(
        JSON.stringify({ results: [{ id: 'e1', status: 'applied' }], epoch: 2 }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const res = await adapter(f).push({ idempotencyKey: 'batch-1', epoch: 2, events: [] });
    expect(res).toEqual({ results: [{ id: 'e1', status: 'applied' }], epoch: 2 });
    const headers = (seen as unknown as { init: { headers: Record<string, string> } }).init.headers;
    expect(headers.authorization).toBe('Bearer device-token-0123456789');
    expect(headers['idempotency-key']).toBe('batch-1');
    expect((seen as unknown as { url: string }).url).toBe(
      'https://cloud.example.test/api/sync/push',
    );
  });

  it('maps 409 STALE_EPOCH and 401 to typed errors, and other failures to plain errors', async () => {
    await expect(
      adapter(reply(409, { error: { code: 'STALE_EPOCH', currentEpoch: 4 } })).push({
        idempotencyKey: 'k',
        epoch: 2,
        events: [],
      }),
    ).rejects.toMatchObject({
      name: 'StaleEpochError',
      currentEpoch: 4,
      sentEpoch: 2,
    });
    await expect(
      adapter(reply(401, {})).push({ idempotencyKey: 'k', epoch: 1, events: [] }),
    ).rejects.toBeInstanceOf(CloudAuthError);
    await expect(
      adapter(reply(502, {})).push({ idempotencyKey: 'k', epoch: 1, events: [] }),
    ).rejects.toThrow(/502/);
    await expect(
      adapter(reply(200, { nope: true })).push({ idempotencyKey: 'k', epoch: 1, events: [] }),
    ).rejects.toThrow(/Unexpected/);
    expect(new StaleEpochError(1, 2).message).toContain('epoch');
  });

  it('pulls with cursors', async () => {
    const res = await adapter(
      reply(200, { changes: [], cursors: { items: '5' }, hasMore: false, epoch: 1 }),
    ).pull({ cursors: { items: '5' }, limit: 10 });
    expect(res.cursors.items).toBe('5');
  });
});
