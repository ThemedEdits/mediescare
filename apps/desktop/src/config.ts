import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_PORT, RUNTIME_MODES, type RuntimeMode } from '@mediescare/config';

export interface DesktopConfig {
  mode: RuntimeMode;
  /** Terminal mode: address of the branch server, for example http://192.168.1.10:3210 */
  serverUrl?: string;
  port: number;
}

export function configPath(userData: string): string {
  return join(userData, 'config.json');
}

export function loadConfig(userData: string): DesktopConfig | null {
  const file = configPath(userData);
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<DesktopConfig>;
  if (!raw.mode || !(RUNTIME_MODES as readonly string[]).includes(raw.mode)) return null;
  return { mode: raw.mode, serverUrl: raw.serverUrl, port: raw.port ?? DEFAULT_PORT };
}

/** Write atomically so a power cut cannot leave a half-written config. */
export function saveConfig(userData: string, config: DesktopConfig): void {
  const file = configPath(userData);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
  renameSync(tmp, file);
}

/** Validate a terminal's server address: http(s) URL, no path, no credentials. */
export function normaliseServerUrl(input: string): string {
  const url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `http://${input.trim()}`);
  if (url.username || url.password)
    throw new Error('The server address must not contain credentials');
  if (url.pathname !== '/' || url.search || url.hash)
    throw new Error('Enter only the server address, for example 192.168.1.10:3210');
  return url.origin;
}
