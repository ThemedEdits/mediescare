import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { safeStorage } from 'electron';

export interface Secrets {
  /** 64 hex characters: the SQLCipher database key (ADR-0001). */
  dbKeyHex: string;
  /** Signs session cookies (ADR-0003). */
  sessionSecret: string;
}

interface StoredSecrets {
  v: 1;
  dbKey: string; // base64 of the OS-encrypted value
  sessionSecret: string;
}

const seal = (plain: string): string => safeStorage.encryptString(plain).toString('base64');
const unseal = (blob: string): string => safeStorage.decryptString(Buffer.from(blob, 'base64'));

/**
 * Load or create the install's secrets. They are wrapped with the OS credential store
 * (Windows DPAPI via Electron safeStorage), so the files are useless if copied to another PC or user.
 * Fails closed: without OS encryption the app refuses to create a database key.
 */
export function loadOrCreateSecrets(userData: string): Secrets {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('OS secure storage is not available on this machine, so the database key cannot be protected.');
  }
  const file = join(userData, 'secrets.json');
  if (existsSync(file)) {
    const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredSecrets;
    return { dbKeyHex: unseal(stored.dbKey), sessionSecret: unseal(stored.sessionSecret) };
  }
  const secrets: Secrets = {
    dbKeyHex: randomBytes(32).toString('hex'),
    sessionSecret: randomBytes(48).toString('base64url'),
  };
  const stored: StoredSecrets = { v: 1, dbKey: seal(secrets.dbKeyHex), sessionSecret: seal(secrets.sessionSecret) };
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(stored), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, file);
  return secrets;
}
