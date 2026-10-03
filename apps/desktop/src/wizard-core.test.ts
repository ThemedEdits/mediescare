import { createServer, type Server } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { elevationArgs, firewallCommands, firewallScript, lanAddresses } from './firewall';
import { DeviceTokenStore, type Sealer } from './pairing';
import { describePairingAnswer, serverAddressText } from './server-info';
import { cleanDeviceName, createWizardCore, normaliseCode } from './wizard-core';

const sealer: Sealer = {
  seal: (p) => Buffer.from(`sealed:${p}`).toString('base64'),
  unseal: (b) =>
    Buffer.from(b, 'base64')
      .toString('utf8')
      .replace(/^sealed:/, ''),
};

/** A loopback stand-in for the branch server: one live code, single use, wrong guesses get 403. */
function startFakeServer(
  mode: string,
  liveCode: string,
): Promise<{ server: Server; url: string; pairs: unknown[] }> {
  const pairs: unknown[] = [];
  let code: string | null = liveCode;
  const server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/api/health') return send(200, { status: 'ok', mode });
    if (req.url === '/api/sync/pair' && req.method === 'POST') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        if (mode !== 'branch-server') return send(404, { error: { code: 'NOT_BRANCH_SERVER' } });
        const body = JSON.parse(raw) as { code: string; deviceName: string };
        pairs.push(body);
        if (code === null || body.code.replace(/-/g, '') !== code) return send(403, {});
        code = null;
        return send(201, {
          deviceId: 'dev-1',
          token: 'dev-1.very-secret',
          tenantId: 't-1',
          branchId: 'b-1',
          branchCode: 'KHI01',
        });
      });
      return;
    }
    send(404, {});
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, pairs }),
    ),
  );
}

describe('wizard core', () => {
  let dir: string;
  let fake: Awaited<ReturnType<typeof startFakeServer>>;
  const make = (discover = async () => []) => createWizardCore({ userData: dir, sealer, discover });
  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mediescare-wizard-'));
    fake = await startFakeServer('branch-server', '48219037');
  });
  afterEach(async () => {
    await new Promise((r) => fake.server.close(r));
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists discovered servers and never throws when discovery fails', async () => {
    const found = [
      {
        name: 'Test Branch',
        branchCode: 'KHI01',
        port: 3210,
        host: '192.168.1.5',
        url: 'http://192.168.1.5:3210',
      },
    ];
    expect(await make(async () => found as never).discover()).toEqual(found);
    const broken = make(async () => {
      throw new Error('socket error');
    });
    expect(await broken.discover()).toEqual([]);
  });

  it('refuses invalid addresses and servers that are not a branch server', async () => {
    const core = make();
    for (const bad of ['', 'http://user:pw@192.168.1.5', '192.168.1.5/admin', 'ftp://x y']) {
      const r = await core.checkAddress(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.kind).toBe('bad-address');
    }
    const single = await startFakeServer('single', '00000000');
    const notServer = await core.checkAddress(single.url);
    await new Promise((r) => single.server.close(r));
    expect(notServer).toMatchObject({ ok: false, kind: 'not-branch-server' });
    const down = await core.checkAddress('127.0.0.1:1');
    expect(down).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('accepts a reachable branch server address (typed without http)', async () => {
    const r = await make().checkAddress(fake.url.replace('http://', ''));
    expect(r).toEqual({ ok: true, url: fake.url });
  });

  it('pairs, stores the token sealed and writes the terminal config', async () => {
    const r = await make().pairTerminal({
      serverUrl: fake.url,
      code: '4821-9037',
      deviceName: ' Counter 2 ',
    });
    expect(r).toMatchObject({ ok: true, deviceId: 'dev-1', branchCode: 'KHI01' });
    expect(fake.pairs).toEqual([{ code: '48219037', deviceName: 'Counter 2' }]);
    expect(loadConfig(dir)).toMatchObject({ mode: 'terminal', serverUrl: fake.url });
    // The token is on disk only in sealed form, and readable back through the store.
    const file = readFileSync(join(dir, 'terminal-token.json'), 'utf8');
    expect(file).not.toContain('very-secret');
    expect(new DeviceTokenStore(dir, sealer).load('terminal')).toBe('dev-1.very-secret');
    // Written atomically: no temporary files are left behind.
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('a wrong code changes nothing and a used code cannot be reused', async () => {
    const core = make();
    const wrong = await core.pairTerminal({
      serverUrl: fake.url,
      code: '1111-2222',
      deviceName: 'C2',
    });
    expect(wrong).toMatchObject({ ok: false, kind: 'bad-code' });
    expect(loadConfig(dir)).toBeNull();
    expect(new DeviceTokenStore(dir, sealer).load('terminal')).toBeNull();
    expect(
      (await core.pairTerminal({ serverUrl: fake.url, code: '48219037', deviceName: 'C2' })).ok,
    ).toBe(true);
    const again = await core.pairTerminal({
      serverUrl: fake.url,
      code: '48219037',
      deviceName: 'C3',
    });
    expect(again).toMatchObject({ ok: false, kind: 'bad-code' });
  });

  it('refuses a malformed code or address before contacting the server', async () => {
    const core = make();
    expect(
      await core.pairTerminal({ serverUrl: fake.url, code: '12-34', deviceName: 'C' }),
    ).toMatchObject({
      ok: false,
      kind: 'bad-code',
    });
    expect(
      await core.pairTerminal({ serverUrl: 'http://a:b@host', code: '48219037', deviceName: 'C' }),
    ).toMatchObject({
      ok: false,
      kind: 'bad-address',
    });
    expect(fake.pairs).toEqual([]);
    expect(loadConfig(dir)).toBeNull();
  });

  it('reports an unreachable server and a PC that is not a branch server', async () => {
    const core = make();
    expect(
      await core.pairTerminal({
        serverUrl: 'http://127.0.0.1:1',
        code: '48219037',
        deviceName: 'C2',
      }),
    ).toMatchObject({ ok: false, kind: 'unreachable' });
    const single = await startFakeServer('single', '48219037');
    const r = await core.pairTerminal({
      serverUrl: single.url,
      code: '48219037',
      deviceName: 'C2',
    });
    await new Promise((res) => single.server.close(res));
    expect(r).toMatchObject({ ok: false, kind: 'not-branch-server' });
    expect(loadConfig(dir)).toBeNull();
  });

  it('maps rate limiting to its own kind', async () => {
    const core = createWizardCore({
      userData: dir,
      sealer,
      discover: async () => [],
      pair: async () => {
        const { PairingFailedError } = await import('./pairing');
        throw new PairingFailedError('Too many attempts. Wait a minute and try again.', 429);
      },
    });
    expect(
      await core.pairTerminal({ serverUrl: fake.url, code: '48219037', deviceName: 'C2' }),
    ).toMatchObject({
      ok: false,
      kind: 'rate-limited',
    });
  });

  it('single and branch server just save the choice; terminal cannot skip pairing', () => {
    const core = make();
    expect(core.chooseLocal('terminal')).toMatchObject({ ok: false });
    expect(core.chooseLocal('cloud')).toMatchObject({ ok: false });
    expect(loadConfig(dir)).toBeNull();
    expect(core.chooseLocal('branch-server')).toMatchObject({ ok: true });
    expect(loadConfig(dir)).toMatchObject({ mode: 'branch-server', port: 3210 });
  });

  it('cleans codes and device names', () => {
    expect(normaliseCode(' 4821-9037 ')).toBe('48219037');
    expect(normaliseCode('4821')).toBeNull();
    expect(normaliseCode('abcd-efgh')).toBeNull();
    expect(cleanDeviceName('  ')).toBe('Counter');
    expect(cleanDeviceName('X')).toBe('Counter');
    expect(cleanDeviceName('Front desk')).toBe('Front desk');
    expect(cleanDeviceName('a'.repeat(100))).toHaveLength(60);
  });
});

describe('firewall helper', () => {
  it('shows exact commands for the app port and the discovery port, local subnet only', () => {
    const [tcp, udp] = firewallCommands(3210);
    expect(tcp).toBe(
      'netsh advfirewall firewall add rule name=Mediescare-Server-TCP dir=in action=allow protocol=TCP localport=3210 remoteip=localsubnet profile=private,domain',
    );
    expect(udp).toContain('protocol=UDP localport=3211');
    expect(udp).toContain('remoteip=localsubnet');
  });

  it('replaces older copies of its rules and asks Windows for administrator rights', () => {
    const script = firewallScript(3211);
    expect(
      script.startsWith('netsh advfirewall firewall delete rule name=Mediescare-Server-TCP'),
    ).toBe(true);
    const args = elevationArgs(3210);
    expect(args.at(-1)).toContain('-Verb RunAs');
    expect(args.at(-1)).toContain('/c netsh');
  });

  it('lists private LAN addresses first and skips loopback', () => {
    const nic = (address: string, internal = false) => ({
      address,
      family: 'IPv4' as const,
      internal,
      netmask: '',
      mac: '',
      cidr: null,
    });
    expect(
      lanAddresses({ lo: [nic('127.0.0.1', true)], a: [nic('8.8.4.4')], b: [nic('192.168.1.7')] }),
    ).toEqual(['192.168.1.7', '8.8.4.4']);
  });
});

describe('server dialog texts', () => {
  it('lists every address with the port', () => {
    const text = serverAddressText(3210, ['192.168.1.7']);
    expect(text).toContain('http://192.168.1.7:3210');
    expect(serverAddressText(3210, [])).toContain('No network address');
  });

  it('understands the answers of the pairing code route', () => {
    expect(describePairingAnswer({ status: 201, body: { code: '4821-9037' } })).toEqual({
      ok: true,
      code: '4821-9037',
    });
    expect(describePairingAnswer({ status: 403, body: null })).toMatchObject({ ok: false });
    expect(
      describePairingAnswer({
        status: 429,
        body: { error: { message: 'Too many pairing codes' } },
      }),
    ).toEqual({ ok: false, message: 'Too many pairing codes' });
  });
});
