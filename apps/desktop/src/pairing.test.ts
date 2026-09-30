import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeviceTokenStore, pairWithServer, PairingFailedError, type Sealer } from './pairing';

const ok = {
  deviceId: 'dev-1',
  token: 'dev-1.secret',
  tenantId: 't-1',
  branchId: 'b-1',
  branchCode: 'KHI01',
};
const reply = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('pairWithServer', () => {
  it('posts the code and device name and returns the paired terminal', async () => {
    let call: { url: string; body: string } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      call = { url, body: String(init.body) };
      return new Response(JSON.stringify(ok), { status: 201 });
    }) as unknown as typeof fetch;
    const paired = await pairWithServer({
      serverUrl: '192.168.1.20:3210',
      code: ' 4821-9037 ',
      deviceName: ' Counter 2 ',
      fetch: f,
    });
    expect(paired).toEqual(ok);
    expect(call).toEqual({
      url: 'http://192.168.1.20:3210/api/sync/pair',
      body: JSON.stringify({ code: '4821-9037', deviceName: 'Counter 2' }),
    });
  });

  it('turns server answers into clear messages', async () => {
    const args = { serverUrl: 'http://192.168.1.20:3210', code: '1', deviceName: 'C' };
    await expect(pairWithServer({ ...args, fetch: reply(403, {}) })).rejects.toThrow(
      /wrong or has expired/,
    );
    await expect(pairWithServer({ ...args, fetch: reply(429, {}) })).rejects.toThrow(/Too many/);
    await expect(pairWithServer({ ...args, fetch: reply(500, {}) })).rejects.toBeInstanceOf(
      PairingFailedError,
    );
    await expect(pairWithServer({ ...args, fetch: reply(201, { deviceId: 'x' }) })).rejects.toThrow(
      /Unexpected/,
    );
    const down = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    await expect(pairWithServer({ ...args, fetch: down })).rejects.toThrow(/Could not reach/);
  });

  it('refuses an address with credentials', async () => {
    await expect(
      pairWithServer({
        serverUrl: 'http://user:pw@host',
        code: '1',
        deviceName: 'C',
        fetch: reply(201, ok),
      }),
    ).rejects.toThrow(/credentials/);
  });
});

describe('DeviceTokenStore', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mediescare-tokens-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // A reversible stand-in for the OS credential store.
  const sealer: Sealer = {
    seal: (p) => Buffer.from(p).toString('base64'),
    unseal: (b) => Buffer.from(b, 'base64').toString('utf8'),
  };

  it('stores tokens sealed, never in clear text, and reads them back', () => {
    const store = new DeviceTokenStore(dir, sealer);
    expect(store.load('cloud')).toBeNull();
    store.save('cloud', 'super-secret-token');
    expect(readFileSync(join(dir, 'cloud-token.json'), 'utf8')).not.toContain('super-secret-token');
    expect(store.load('cloud')).toBe('super-secret-token');
    expect(store.load('terminal')).toBeNull();
  });

  it('treats an unreadable token file (copied to another PC) as not paired', () => {
    const store = new DeviceTokenStore(dir, sealer);
    store.save('terminal', 'abc');
    const other = new DeviceTokenStore(dir, {
      seal: sealer.seal,
      unseal: () => {
        throw new Error('cannot decrypt');
      },
    });
    expect(other.load('terminal')).toBeNull();
  });
});
