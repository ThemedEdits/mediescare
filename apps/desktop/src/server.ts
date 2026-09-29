import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import type { RuntimeMode } from '@mediescare/config';
import type { Secrets } from './secrets';

export interface ServerOptions {
  /** Path to the Next.js standalone server.js. */
  serverJs: string;
  /** Folder holding the packages/db/migrations files that ship with the server. */
  migrationsDir: string;
  dataDir: string;
  logDir: string;
  mode: RuntimeMode;
  port: number;
  secrets: Secrets;
}

const MAX_RESTARTS = 5;

/** True if something is already listening on the port (on any interface). */
function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
      .once('error', () => resolve(true))
      .once('listening', () => probe.close(() => resolve(false)))
      .listen(port, '0.0.0.0');
  });
}

export async function pickPort(preferred: number): Promise<number> {
  for (let port = preferred; port < preferred + 20; port++) {
    if (!(await portInUse(port))) return port;
  }
  throw new Error(`No free port found from ${preferred}`);
}

export async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'unknown';
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `The local server did not become ready within ${timeoutMs / 1000}s (${lastError})`,
  );
}

/**
 * Runs the Next.js standalone server as a child process using Electron's own Node runtime
 * (ELECTRON_RUN_AS_NODE), so the native database module matches the runtime. Restarts on crash.
 */
export class ServerProcess {
  private child: ChildProcess | null = null;
  private log: WriteStream | null = null;
  private restarts = 0;
  private stopping = false;

  constructor(private readonly options: ServerOptions) {}

  get url(): string {
    const host = '127.0.0.1';
    return `http://${host}:${this.options.port}`;
  }

  start(): void {
    const o = this.options;
    mkdirSync(o.logDir, { recursive: true });
    mkdirSync(o.dataDir, { recursive: true });
    this.log ??= createWriteStream(join(o.logDir, 'server.log'), { flags: 'a' });
    const child = spawn(process.execPath, [o.serverJs], {
      cwd: join(o.serverJs, '..'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: String(o.port),
        // single: this PC only. branch-server: reachable by terminals on the LAN.
        HOSTNAME: o.mode === 'single' ? '127.0.0.1' : '0.0.0.0',
        MEDIESCARE_MODE: o.mode,
        MEDIESCARE_DATA_DIR: o.dataDir,
        MEDIESCARE_MIGRATIONS_DIR: o.migrationsDir,
        MEDIESCARE_DB_KEY: o.secrets.dbKeyHex,
        MEDIESCARE_SESSION_SECRET: o.secrets.sessionSecret,
      },
    });
    this.child = child;
    child.stdout?.pipe(this.log, { end: false });
    child.stderr?.pipe(this.log, { end: false });
    child.once('exit', (code, signal) => {
      this.log?.write(`[shell] server exited code=${code} signal=${signal}\n`);
      this.child = null;
      if (this.stopping) return;
      if (this.restarts >= MAX_RESTARTS) {
        this.log?.write('[shell] restart limit reached, giving up\n');
        return;
      }
      this.restarts += 1;
      setTimeout(() => !this.stopping && this.start(), Math.min(1000 * 2 ** this.restarts, 15_000));
    });
  }

  stop(): void {
    this.stopping = true;
    this.child?.kill();
    this.log?.end();
  }

  /** Stop the server and wait until the process has exited, so its files are released. */
  async stopAndWait(timeoutMs = 10_000): Promise<void> {
    const child = this.child;
    this.stopping = true;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, timeoutMs);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill();
    });
  }
}
