import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { generateRecoveryKey, wrapDbKey, type WrappedKey } from './recovery';

const fileFor = (dataDir: string) => join(dataDir, 'keyring.json');

export function readKeyring(dataDir: string): WrappedKey | null {
  const file = fileFor(dataDir);
  if (!existsSync(file)) return null;
  return (JSON.parse(readFileSync(file, 'utf8')) as { wrapped: WrappedKey }).wrapped;
}

/**
 * Create (or replace) the recovery key. Only the wrapped database key is stored, next to the
 * database. The returned recovery key is shown to the owner once and is not kept anywhere.
 */
export function issueRecoveryKey(dataDir: string, dbKeyHex: string): string {
  const recoveryKey = generateRecoveryKey();
  const file = fileFor(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ v: 1, wrapped: wrapDbKey(dbKeyHex, recoveryKey) }), 'utf8');
  renameSync(tmp, file);
  return recoveryKey;
}

/** Store an already wrapped key (used after a restore, so the same recovery key keeps working). */
export function saveKeyring(dataDir: string, wrapped: WrappedKey): void {
  const file = fileFor(dataDir);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ v: 1, wrapped }), 'utf8');
  renameSync(tmp, file);
}
