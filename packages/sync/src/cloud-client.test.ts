import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CloudRequestError, DeviceRevokedError, type EnrollResult } from './cloud-auth';
import { bootstrapHeadOffice, createEnrollmentCode, enroll, refreshTokens } from './cloud-client';
import { HttpCloudAdapter } from './http-adapter';
import { CloudAuthError } from './outbox';
import { RefreshingTokenProvider } from './refreshing-token-provider';
import { FileTokenStore, MemoryTokenStore, type StoredCloudAuth } from './token-store';

const enrolled: EnrollResult = {
  deviceId: 'device-00000001',
  tenantId: 'tenant-00000001',
  tenantName: 'Demo Group',
  branch: { id: 'branch-00000001', code: 'HO01', name: 'Head Office', isHeadOffice: true },
  accessToken: 'access-1',
  refreshToken: 'device-00000001.refresh-secret-1',
  accessExpiresAt: '2026-10-01T09:15:00.000Z',
};

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

interface Call {
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    const call: Call = {
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as unknown,
    };
    calls.push(call);
    return handler(call, calls.length);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('enroll, bootstrapHeadOffice and createEnrollmentCode', () => {
  it('bootstrapHeadOffice posts the organisation and returns the tokens', async () => {
    const { impl, calls } = fakeFetch(() => reply(201, enrolled));
    const r = await bootstrapHeadOffice({
      cloudUrl: 'https://cloud.example.test/',
      bootstrapCode: ' code-123 ',
      organisationName: 'Demo Group',
      branchCode: 'HO01',
      branchName: 'Head Office',
      deviceName: 'HO PC',
      fetchImpl: impl,
    });
    expect(r).toEqual(enrolled);
    expect(calls[0]?.url).toBe('https://cloud.example.test/api/sync/bootstrap');
    expect(calls[0]?.body).toMatchObject({
      bootstrapCode: 'code-123',
      organisationName: 'Demo Group',
    });
  });

  it('enroll posts the code, and a wrong code gives a friendly error without the code in it', async () => {
    const ok = fakeFetch(() =>
      reply(201, { ...enrolled, branch: { ...enrolled.branch, isHeadOffice: false } }),
    );
    const r = await enroll({
      cloudUrl: 'https://cloud.example.test',
      code: 'ABCD-EFGH-JKLM-NPQR',
      deviceName: 'Clifton PC',
      fetchImpl: ok.impl,
    });
    expect(r.branch.isHeadOffice).toBe(false);
    expect(ok.calls[0]?.url).toBe('https://cloud.example.test/api/sync/enroll');

    const bad = fakeFetch(() => reply(403, { error: { code: 'INVALID_CODE' } }));
    const err = (await enroll({
      cloudUrl: 'https://cloud.example.test',
      code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ',
      deviceName: 'PC',
      fetchImpl: bad.impl,
    }).then(
      () => null,
      (e: unknown) => e,
    )) as CloudRequestError;
    expect(err).toBeInstanceOf(CloudRequestError);
    expect(err.message).toMatch(/wrong, expired or already used/);
    expect(err.message).not.toContain('ZZZZ');
    expect(err.code).toBe('INVALID_CODE');
  });

  it('reports an unreachable cloud plainly, and refuses plain http to a remote host', async () => {
    const down = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    await expect(
      enroll({
        cloudUrl: 'https://cloud.example.test',
        code: 'A',
        deviceName: 'PC',
        fetchImpl: down.impl,
      }),
    ).rejects.toThrow(/Could not reach the cloud at cloud\.example\.test/);
    await expect(
      enroll({
        cloudUrl: 'http://cloud.example.test',
        code: 'A',
        deviceName: 'PC',
        fetchImpl: down.impl,
      }),
    ).rejects.toThrow(/https/);
  });

  it('rejects an answer that is not a token result', async () => {
    const odd = fakeFetch(() => reply(200, { hello: 'world' }));
    await expect(
      enroll({
        cloudUrl: 'https://cloud.example.test',
        code: 'A',
        deviceName: 'PC',
        fetchImpl: odd.impl,
      }),
    ).rejects.toThrow(/Unexpected answer/);
  });

  it('createEnrollmentCode sends a fresh access token from the provider', async () => {
    const { impl, calls } = fakeFetch(() =>
      reply(201, { code: 'ABCD-EFGH-JKLM-NPQR', expiresAt: '2026-10-02T09:00:00.000Z' }),
    );
    const out = await createEnrollmentCode(() => Promise.resolve('live-access-token'), {
      cloudUrl: 'https://cloud.example.test',
      branchCode: 'KHI01',
      branchName: 'Clifton',
      fetchImpl: impl,
    });
    expect(out.code).toBe('ABCD-EFGH-JKLM-NPQR');
    expect(calls[0]?.headers.authorization).toBe('Bearer live-access-token');
    expect(calls[0]?.body).toEqual({ branchCode: 'KHI01', branchName: 'Clifton' });
  });

  it('refreshTokens maps a revoked device and an unusable token to DeviceRevokedError', async () => {
    for (const code of ['DEVICE_REVOKED', 'INVALID_REFRESH']) {
      const { impl } = fakeFetch(() => reply(401, { error: { code } }));
      await expect(
        refreshTokens({
          cloudUrl: 'https://cloud.example.test',
          refreshToken: 'x.y',
          fetchImpl: impl,
        }),
      ).rejects.toBeInstanceOf(DeviceRevokedError);
    }
    const server = fakeFetch(() => reply(503, { error: { code: 'CLOUD_DB_UNREACHABLE' } }));
    const err = await refreshTokens({
      cloudUrl: 'https://cloud.example.test',
      refreshToken: 'x.y',
      fetchImpl: server.impl,
    }).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(DeviceRevokedError); // a sick cloud is offline, not revoked
  });
});

describe('RefreshingTokenProvider', () => {
  const stored: StoredCloudAuth = {
    cloudUrl: 'https://cloud.example.test',
    refreshToken: 'device-00000001.refresh-secret-1',
    deviceId: 'device-00000001',
    tenantId: 'tenant-00000001',
    branchId: 'branch-00000001',
    updatedAt: '2026-10-01T09:00:00.000Z',
  };
  let clock = Date.parse('2026-10-01T09:00:00Z');
  const now = () => clock;

  /** A cloud that rotates: every refresh returns access-N and refresh-(N+1), valid 15 minutes. */
  function rotatingCloud(opts: { revokeAt?: number } = {}) {
    let n = 0;
    return fakeFetch((call) => {
      n += 1;
      if (opts.revokeAt && n >= opts.revokeAt)
        return reply(401, { error: { code: 'DEVICE_REVOKED' } });
      const body = call.body as { refreshToken: string };
      return reply(200, {
        accessToken: `access-${n}`,
        refreshToken: `device-00000001.rotated-${n}`,
        accessExpiresAt: new Date(clock + 15 * 60_000).toISOString(),
        seen: body.refreshToken,
      });
    });
  }

  it('refreshes on first use, reuses the token until shortly before expiry, then refreshes again', async () => {
    clock = Date.parse('2026-10-01T09:00:00Z');
    const cloud = rotatingCloud();
    const store = new MemoryTokenStore(stored);
    const p = new RefreshingTokenProvider({ store, fetchImpl: cloud.impl, now });
    expect(await p.getAccessToken()).toBe('access-1');
    expect(await p.getAccessToken()).toBe('access-1');
    expect(cloud.calls).toHaveLength(1);
    clock += 13 * 60_000;
    expect(await p.getAccessToken()).toBe('access-1'); // 2 minutes left, margin is 1 minute
    clock += 90_000;
    expect(await p.getAccessToken()).toBe('access-2'); // inside the margin: refreshed early
    expect(cloud.calls).toHaveLength(2);
    // Each refresh sent the newest refresh token, and the store holds the newest one.
    expect((cloud.calls[0]?.body as { refreshToken: string }).refreshToken).toBe(
      stored.refreshToken,
    );
    expect((cloud.calls[1]?.body as { refreshToken: string }).refreshToken).toBe(
      'device-00000001.rotated-1',
    );
    expect((await store.load())?.refreshToken).toBe('device-00000001.rotated-2');
  });

  it('shares one refresh between concurrent callers', async () => {
    const cloud = rotatingCloud();
    const p = new RefreshingTokenProvider({
      store: new MemoryTokenStore(stored),
      fetchImpl: cloud.impl,
      now,
    });
    const tokens = await Promise.all([p.getAccessToken(), p.getAccessToken(), p.getAccessToken()]);
    expect(new Set(tokens).size).toBe(1);
    expect(cloud.calls).toHaveLength(1);
  });

  it('uses the access token from enrolment without a refresh, and forceRefresh replaces it', async () => {
    clock = Date.parse('2026-10-01T09:00:00Z');
    const cloud = rotatingCloud();
    const p = new RefreshingTokenProvider({
      store: new MemoryTokenStore(stored),
      initial: {
        accessToken: 'from-enroll',
        accessExpiresAt: new Date(clock + 900_000).toISOString(),
      },
      fetchImpl: cloud.impl,
      now,
    });
    expect(await p.getAccessToken()).toBe('from-enroll');
    expect(cloud.calls).toHaveLength(0);
    expect(await p.forceRefresh()).toBe('access-1');
  });

  it('remembers a revoked device and never asks again', async () => {
    const cloud = rotatingCloud({ revokeAt: 1 });
    const p = new RefreshingTokenProvider({
      store: new MemoryTokenStore(stored),
      fetchImpl: cloud.impl,
      now,
    });
    await expect(p.ensureFresh()).rejects.toBeInstanceOf(DeviceRevokedError);
    expect(p.revoked).toBe(true);
    await expect(p.getAccessToken()).rejects.toBeInstanceOf(DeviceRevokedError);
    await expect(p.forceRefresh()).rejects.toBeInstanceOf(DeviceRevokedError);
    expect(cloud.calls).toHaveLength(1);
  });

  it('treats a missing store as not connected', async () => {
    const p = new RefreshingTokenProvider({
      store: new MemoryTokenStore(null),
      fetchImpl: rotatingCloud().impl,
      now,
    });
    await expect(p.getAccessToken()).rejects.toBeInstanceOf(DeviceRevokedError);
  });

  it('a network failure during refresh is not a revocation', async () => {
    const down = fakeFetch(() => {
      throw new TypeError('fetch failed');
    });
    const p = new RefreshingTokenProvider({
      store: new MemoryTokenStore(stored),
      fetchImpl: down.impl,
      now,
    });
    const err = await p.getAccessToken().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CloudRequestError);
    expect(p.revoked).toBe(false);
  });
});

describe('HttpCloudAdapter with a token provider', () => {
  it('uses a fresh token for every request, and on a 401 refreshes once and retries once', async () => {
    const seen: string[] = [];
    const cloud = fakeFetch((call) => {
      seen.push(call.headers.authorization as string);
      return call.headers.authorization === 'Bearer stale'
        ? reply(401, { error: { code: 'UNAUTHENTICATED' } })
        : reply(200, { results: [], epoch: 1 });
    });
    const adapter = new HttpCloudAdapter({
      baseUrl: 'https://cloud.example.test',
      tokenProvider: () => Promise.resolve('stale'),
      forceRefresh: () => Promise.resolve('fresh'),
      fetch: cloud.impl,
    });
    await adapter.push({ idempotencyKey: 'k', epoch: 1, events: [] });
    expect(seen).toEqual(['Bearer stale', 'Bearer fresh']);
  });

  it('gives up with an auth error when the retry is refused too (no loop)', async () => {
    const cloud = fakeFetch(() => reply(401, {}));
    const adapter = new HttpCloudAdapter({
      baseUrl: 'https://cloud.example.test',
      tokenProvider: () => Promise.resolve('a'),
      forceRefresh: () => Promise.resolve('b'),
      fetch: cloud.impl,
    });
    await expect(adapter.pull({ cursors: {}, limit: 1 })).rejects.toBeInstanceOf(CloudAuthError);
    expect(cloud.calls).toHaveLength(2);
  });

  it('propagates a revoked device from the provider without calling the cloud', async () => {
    const cloud = fakeFetch(() => reply(200, {}));
    const adapter = new HttpCloudAdapter({
      baseUrl: 'https://cloud.example.test',
      tokenProvider: () => Promise.reject(new DeviceRevokedError()),
      fetch: cloud.impl,
    });
    await expect(
      adapter.push({ idempotencyKey: 'k', epoch: 1, events: [] }),
    ).rejects.toBeInstanceOf(DeviceRevokedError);
    expect(cloud.calls).toHaveLength(0);
  });
});

describe('FileTokenStore', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const value: StoredCloudAuth = {
    cloudUrl: 'https://cloud.example.test',
    refreshToken: 'device-00000001.very-secret-refresh-token',
    deviceId: 'd',
    tenantId: 't',
    branchId: 'b',
    updatedAt: '2026-10-01T09:00:00.000Z',
  };
  const key = 'ab'.repeat(32);

  it('round-trips, and the file does not contain the token when a key is given', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-tokens-'));
    dirs.push(dir);
    const file = join(dir, 'cloud-auth.json');
    const store = new FileTokenStore(file, { secretHex: key });
    await store.save(value);
    expect(readFileSync(file, 'utf8')).not.toContain('very-secret-refresh-token');
    expect(await store.load()).toEqual(value);
    await store.clear();
    expect(await store.load()).toBeNull();
  });

  it('cannot be read with a different key (another PC) or after tampering', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-tokens-'));
    dirs.push(dir);
    const file = join(dir, 'cloud-auth.json');
    await new FileTokenStore(file, { secretHex: key }).save(value);
    expect(await new FileTokenStore(file, { secretHex: 'cd'.repeat(32) }).load()).toBeNull();
    expect(await new FileTokenStore(file).load()).toBeNull();
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { data: string };
    writeFileSync(
      file,
      JSON.stringify({ ...raw, data: Buffer.from('tampered').toString('base64') }),
    );
    expect(await new FileTokenStore(file, { secretHex: key }).load()).toBeNull();
  });

  it('without a key (development) it still works and overwrites atomically', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-tokens-'));
    dirs.push(dir);
    const store = new FileTokenStore(join(dir, 'nested', 'cloud-auth.json'));
    await store.save(value);
    await store.save({ ...value, refreshToken: 'device-00000001.second-token-value' });
    expect((await store.load())?.refreshToken).toBe('device-00000001.second-token-value');
  });
});
