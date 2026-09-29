import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configPath, loadConfig, normaliseServerUrl, saveConfig } from './config';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('normaliseServerUrl', () => {
  it('adds http and keeps host and port', () => {
    expect(normaliseServerUrl('192.168.1.10:3210')).toBe('http://192.168.1.10:3210');
    expect(normaliseServerUrl(' http://SERVER-PC:3210/ ')).toBe('http://server-pc:3210');
    expect(normaliseServerUrl('https://branch.example.test')).toBe('https://branch.example.test');
  });

  it('rejects credentials, paths and garbage', () => {
    expect(() => normaliseServerUrl('http://user:pw@10.0.0.2:3210')).toThrow(/credentials/);
    expect(() => normaliseServerUrl('10.0.0.2:3210/admin')).toThrow(/only the server address/);
    expect(() => normaliseServerUrl('')).toThrow();
    expect(() => normaliseServerUrl('not a url ::')).toThrow();
  });
});

describe('config file', () => {
  it('round-trips and returns null when absent', () => {
    dir = mkdtempSync(join(tmpdir(), 'mediescare-cfg-'));
    expect(loadConfig(dir)).toBeNull();
    saveConfig(dir, { mode: 'terminal', serverUrl: 'http://10.0.0.2:3210', port: 3210 });
    expect(loadConfig(dir)).toEqual({ mode: 'terminal', serverUrl: 'http://10.0.0.2:3210', port: 3210 });
  });

  it('ignores a config with an unknown mode instead of crashing', () => {
    dir = mkdtempSync(join(tmpdir(), 'mediescare-cfg-'));
    writeFileSync(configPath(dir), JSON.stringify({ mode: 'banana' }));
    expect(loadConfig(dir)).toBeNull();
  });
});
