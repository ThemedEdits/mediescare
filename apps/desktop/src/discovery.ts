import { createSocket, type RemoteInfo, type Socket } from 'node:dgram';

/**
 * LAN discovery of branch servers with Node's built-in UDP (no native dependency).
 *
 * Server: listens on a fixed port. It broadcasts one announcement at start and answers every
 * probe with a unicast announcement. Terminal: sends a probe to the broadcast address and collects
 * the answers for a short time. The packet carries only the display name, branch code and HTTP
 * port. It contains no secret and grants nothing: a terminal still needs a pairing code
 * (pairing.ts). Windows Firewall must allow inbound UDP on DISCOVERY_PORT on the server PC.
 */
export const DISCOVERY_PORT = 3211;
const MAX_PACKET = 512;

export interface ServerAnnouncement {
  name: string;
  branchCode: string;
  /** HTTP port of the branch server. */
  port: number;
}

export interface DiscoveredServer extends ServerAnnouncement {
  /** Address the reply came from, so the terminal can build the server URL. */
  host: string;
  url: string;
}

const APP = 'mediescare';

export function encodeAnnouncement(a: ServerAnnouncement): Buffer {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      t: 'announce',
      app: APP,
      name: a.name,
      branchCode: a.branchCode,
      port: a.port,
    }),
  );
}

const PROBE = Buffer.from(JSON.stringify({ v: 1, t: 'probe', app: APP }));

function parseJson(message: Buffer): Record<string, unknown> | null {
  if (message.length > MAX_PACKET) return null;
  try {
    const value: unknown = JSON.parse(message.toString('utf8'));
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Strictly validate an announcement from the network. Anything unexpected is dropped. */
export function parseAnnouncement(message: Buffer, from: string): DiscoveredServer | null {
  const p = parseJson(message);
  if (!p || p.v !== 1 || p.t !== 'announce' || p.app !== APP) return null;
  const { name, branchCode, port } = p;
  if (typeof name !== 'string' || name.length < 1 || name.length > 80) return null;
  if (typeof branchCode !== 'string' || !/^[A-Za-z0-9_-]{1,20}$/.test(branchCode)) return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const host = from.includes(':') ? `[${from}]` : from;
  return { name, branchCode, port, host: from, url: `http://${host}:${port}` };
}

export interface AnnouncerOptions {
  announcement: ServerAnnouncement;
  /** UDP port to listen on. Tests pass 0 or a free port. */
  udpPort?: number;
  /** Address of the initial broadcast. Default 255.255.255.255. */
  broadcastAddress?: string;
  /** Bind address. Default all interfaces. */
  bindAddress?: string;
}

export interface Announcer {
  /** The UDP port actually bound. */
  port: number;
  stop(): void;
}

/** Start answering probes (and announce once). Resolves when the socket is bound. */
export function startAnnouncer(options: AnnouncerOptions): Promise<Announcer> {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  const packet = encodeAnnouncement(options.announcement);
  const udpPort = options.udpPort ?? DISCOVERY_PORT;
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    socket.on('message', (message: Buffer, rinfo: RemoteInfo) => {
      const p = parseJson(message);
      if (p?.v === 1 && p.t === 'probe' && p.app === APP)
        socket.send(packet, rinfo.port, rinfo.address);
    });
    socket.bind(udpPort, options.bindAddress, () => {
      socket.off('error', reject);
      socket.on('error', () => undefined); // a UDP hiccup must never crash the shell
      try {
        socket.setBroadcast(true);
        socket.send(packet, udpPort, options.broadcastAddress ?? '255.255.255.255');
      } catch {
        // No network yet: probes still work once it is up.
      }
      resolve({ port: socket.address().port, stop: () => closeQuietly(socket) });
    });
  });
}

export interface DiscoverOptions {
  /** How long to collect answers. Default 1500 ms. */
  timeoutMs?: number;
  /** Where to send the probe. Default the LAN broadcast address on DISCOVERY_PORT. */
  targets?: { address: string; port: number }[];
}

/** Find branch servers on the LAN. Resolves after the timeout with the unique servers heard. */
export function discoverServers(options: DiscoverOptions = {}): Promise<DiscoveredServer[]> {
  const socket = createSocket('udp4');
  const found = new Map<string, DiscoveredServer>();
  const targets = options.targets ?? [{ address: '255.255.255.255', port: DISCOVERY_PORT }];
  return new Promise((resolve) => {
    const finish = () => {
      closeQuietly(socket);
      resolve([...found.values()]);
    };
    socket.on('error', finish);
    socket.on('message', (message: Buffer, rinfo: RemoteInfo) => {
      const server = parseAnnouncement(message, rinfo.address);
      if (server) found.set(`${server.host}:${server.port}`, server);
    });
    socket.bind(0, () => {
      try {
        socket.setBroadcast(true);
        for (const t of targets) socket.send(PROBE, t.port, t.address);
      } catch {
        finish();
        return;
      }
      setTimeout(finish, options.timeoutMs ?? 1500).unref();
    });
  });
}

function closeQuietly(socket: Socket): void {
  try {
    socket.close();
  } catch {
    // Already closed.
  }
}
