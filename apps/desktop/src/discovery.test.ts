import { createSocket } from 'node:dgram';
import { afterEach, describe, expect, it } from 'vitest';
import {
  discoverServers,
  encodeAnnouncement,
  parseAnnouncement,
  startAnnouncer,
  type Announcer,
} from './discovery';
import { startLanAnnouncing } from './discovery-service';

const announcers: Announcer[] = [];
afterEach(() => {
  for (const a of announcers.splice(0)) a.stop();
});

/** Servers listen on loopback with an OS-chosen port, so tests never touch the real LAN. */
async function server(name: string, branchCode: string, httpPort: number) {
  const a = await startAnnouncer({
    announcement: { name, branchCode, port: httpPort },
    udpPort: 0,
    bindAddress: '127.0.0.1',
    broadcastAddress: '127.0.0.1', // the startup broadcast goes nowhere useful in tests
  });
  announcers.push(a);
  return a;
}

describe('packet parsing', () => {
  it('accepts a well formed announcement and builds the server url', () => {
    const parsed = parseAnnouncement(
      encodeAnnouncement({ name: 'Main Branch', branchCode: 'KHI01', port: 3210 }),
      '192.168.1.20',
    );
    expect(parsed).toEqual({
      name: 'Main Branch',
      branchCode: 'KHI01',
      port: 3210,
      host: '192.168.1.20',
      url: 'http://192.168.1.20:3210',
    });
  });

  it('drops anything malformed, oversized or from another app', () => {
    const bad = (o: unknown) => Buffer.from(JSON.stringify(o));
    expect(parseAnnouncement(Buffer.from('not json'), '10.0.0.1')).toBeNull();
    expect(
      parseAnnouncement(
        bad({ v: 1, t: 'announce', app: 'other', name: 'x', branchCode: 'A', port: 1 }),
        '10.0.0.1',
      ),
    ).toBeNull();
    expect(
      parseAnnouncement(
        bad({ v: 1, t: 'announce', app: 'mediescare', name: 'x', branchCode: 'A B', port: 1 }),
        '10.0.0.1',
      ),
    ).toBeNull();
    expect(
      parseAnnouncement(
        bad({ v: 1, t: 'announce', app: 'mediescare', name: 'x', branchCode: 'A', port: 70000 }),
        '10.0.0.1',
      ),
    ).toBeNull();
    expect(
      parseAnnouncement(
        bad({
          v: 1,
          t: 'announce',
          app: 'mediescare',
          name: 'x'.repeat(600),
          branchCode: 'A',
          port: 1,
        }),
        '10.0.0.1',
      ),
    ).toBeNull();
    expect(parseAnnouncement(bad(['array']), '10.0.0.1')).toBeNull();
  });
});

describe('discovery over loopback sockets', () => {
  it('a terminal finds every server that answers its probe', async () => {
    const a = await server('Main Branch', 'KHI01', 3210);
    const b = await server('Second Branch', 'KHI02', 3215);
    const found = await discoverServers({
      timeoutMs: 400,
      targets: [
        { address: '127.0.0.1', port: a.port },
        { address: '127.0.0.1', port: b.port },
      ],
    });
    expect(found.map((s) => s.branchCode).sort()).toEqual(['KHI01', 'KHI02']);
    expect(found.find((s) => s.branchCode === 'KHI02')?.url).toBe('http://127.0.0.1:3215');
  });

  it('finds nothing when no server answers', async () => {
    expect(
      await discoverServers({ timeoutMs: 200, targets: [{ address: '127.0.0.1', port: 9 }] }),
    ).toEqual([]);
  });

  it('ignores a probe-shaped packet from another app and never crashes on garbage', async () => {
    const a = await server('Main Branch', 'KHI01', 3210);
    const client = createSocket('udp4');
    const replies: Buffer[] = [];
    client.on('message', (m) => replies.push(m));
    await new Promise<void>((resolve) => client.bind(0, '127.0.0.1', resolve));
    client.send(Buffer.from('garbage'), a.port, '127.0.0.1');
    client.send(
      Buffer.from(JSON.stringify({ v: 1, t: 'probe', app: 'other' })),
      a.port,
      '127.0.0.1',
    );
    await new Promise((r) => setTimeout(r, 200));
    client.close();
    expect(replies).toHaveLength(0);
  });
});

describe('announce service', () => {
  it('retries until the branch is set up, then announces its name and code', async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls += 1;
      return calls < 3
        ? new Response('{}', { status: 404 })
        : new Response(JSON.stringify({ name: 'Main Branch', branchCode: 'KHI01' }), {
            status: 200,
          });
    }) as unknown as typeof fetch;
    const stop = startLanAnnouncing({
      origin: 'http://127.0.0.1:1',
      port: 3210,
      retryMs: 20,
      fetch: fakeFetch,
      udpPort: 0,
      broadcastAddress: '127.0.0.1',
    });
    await new Promise((r) => setTimeout(r, 400));
    stop();
    expect(calls).toBe(3);
  });
});
