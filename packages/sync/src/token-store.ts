import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** What a branch server keeps between runs to reach the cloud. Only the refresh token is secret. */
export interface StoredCloudAuth {
  cloudUrl: string;
  refreshToken: string;
  deviceId: string;
  tenantId: string;
  branchId: string;
  updatedAt: string;
}

/** Persistence of the cloud credentials. The refresh token rotates, so every refresh saves again. */
export interface TokenStore {
  load(): Promise<StoredCloudAuth | null>;
  save(value: StoredCloudAuth): Promise<void>;
  clear(): Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  constructor(private value: StoredCloudAuth | null = null) {}
  load(): Promise<StoredCloudAuth | null> {
    return Promise.resolve(this.value ? { ...this.value } : null);
  }
  save(value: StoredCloudAuth): Promise<void> {
    this.value = { ...value };
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.value = null;
    return Promise.resolve();
  }
}

interface FileFormat {
  v: 1;
  /** `aes-256-gcm` when a key was given, otherwise `none` (development only). */
  enc: 'aes-256-gcm' | 'none';
  iv?: string;
  tag?: string;
  data: string;
}

/**
 * Credential file in the branch data folder (`cloud-auth.json`).
 *
 * The branch server process runs with Electron's Node runtime, where the OS credential store
 * (safeStorage, used by `apps/desktop/src/secrets.ts`) is not available, and it must save the
 * rotated refresh token itself. So the file is encrypted with AES-256-GCM under a key derived
 * (HKDF-SHA256) from the database key that the desktop shell already keeps sealed with the OS
 * credential store and passes to the server. Copied to another PC or Windows user, the file is
 * useless, exactly like the database. In development there may be no key: then the file is plain
 * JSON with mode 0600 (ignored on Windows) and must be treated as a secret; never commit it.
 */
export class FileTokenStore implements TokenStore {
  private readonly key: Buffer | null;

  constructor(
    private readonly file: string,
    options: { secretHex?: string | null } = {},
  ) {
    this.key = options.secretHex
      ? Buffer.from(
          hkdfSync(
            'sha256',
            Buffer.from(options.secretHex, 'hex'),
            Buffer.from('mediescare-cloud-auth'),
            Buffer.from('cloud-auth-file-v1'),
            32,
          ),
        )
      : null;
  }

  loadSync(): StoredCloudAuth | null {
    if (!existsSync(this.file)) return null;
    try {
      const f = JSON.parse(readFileSync(this.file, 'utf8')) as FileFormat;
      if (f.v !== 1) return null;
      let plain: string;
      if (f.enc === 'aes-256-gcm') {
        if (!this.key || !f.iv || !f.tag) return null;
        const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(f.iv, 'base64'));
        d.setAuthTag(Buffer.from(f.tag, 'base64'));
        plain = Buffer.concat([d.update(Buffer.from(f.data, 'base64')), d.final()]).toString(
          'utf8',
        );
      } else {
        plain = f.data;
      }
      const v = JSON.parse(plain) as Partial<StoredCloudAuth>;
      if (typeof v.cloudUrl !== 'string' || typeof v.refreshToken !== 'string') return null;
      return v as StoredCloudAuth;
    } catch {
      return null; // unreadable (other PC, wrong key, damaged): treated as not connected
    }
  }

  saveSync(value: StoredCloudAuth): void {
    const plain = JSON.stringify(value);
    let out: FileFormat;
    if (this.key) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', this.key, iv);
      const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
      out = {
        v: 1,
        enc: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: c.getAuthTag().toString('base64'),
        data: data.toString('base64'),
      };
    } else {
      out = { v: 1, enc: 'none', data: plain };
    }
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(out), { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, this.file);
  }

  clearSync(): void {
    rmSync(this.file, { force: true });
  }

  load(): Promise<StoredCloudAuth | null> {
    return Promise.resolve(this.loadSync());
  }
  save(value: StoredCloudAuth): Promise<void> {
    this.saveSync(value);
    return Promise.resolve();
  }
  clear(): Promise<void> {
    this.clearSync();
    return Promise.resolve();
  }
}
