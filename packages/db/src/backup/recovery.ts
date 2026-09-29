/**
 * Recovery key (ADR-0001). The database key lives on the PC wrapped by Windows DPAPI. A copy of
 * that key is also wrapped with a human-held recovery key, so a backup can be restored on a
 * different PC or after the Windows profile is lost. The recovery key itself is never stored.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Crockford base32 (no I, L, O, U): easy to read out and to copy by hand.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const KEY_BYTES = 20; // 160 bits -> 32 characters
const KDF = { N: 2 ** 15, r: 8, p: 1 } as const;

export class RecoveryKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryKeyError';
  }
}

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** New random recovery key, shown to the owner once, formatted as 8 groups of 4. */
export function generateRecoveryKey(): string {
  const raw = encodeBase32(randomBytes(KEY_BYTES));
  return (raw.match(/.{4}/g) ?? []).join('-');
}

/** Accept what a person types: any case, spaces or dashes, and O/I/L typed instead of 0/1. */
export function normalizeRecoveryKey(input: string): string {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (clean.length !== 32 || [...clean].some((c) => !ALPHABET.includes(c))) {
    throw new RecoveryKeyError(
      'The recovery key must be 32 letters and digits (for example ABCD-EFGH-...)',
    );
  }
  return clean;
}

export interface WrappedKey {
  v: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  iv: string;
  tag: string;
  ct: string;
}

function deriveKey(
  recoveryKey: string,
  salt: Buffer,
  params: { N: number; r: number; p: number },
): Buffer {
  return scryptSync(normalizeRecoveryKey(recoveryKey), salt, 32, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: 128 * params.N * params.r * 2,
  });
}

/** Encrypt the 64-hex-character database key with the recovery key (scrypt + AES-256-GCM). */
export function wrapDbKey(dbKeyHex: string, recoveryKey: string): WrappedKey {
  if (!/^[0-9a-fA-F]{64}$/.test(dbKeyHex))
    throw new RecoveryKeyError('Database key must be 64 hex characters');
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(recoveryKey, salt, KDF), iv);
  const ct = Buffer.concat([cipher.update(dbKeyHex, 'utf8'), cipher.final()]);
  return {
    v: 1,
    kdf: 'scrypt',
    ...KDF,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  };
}

/** Decrypt the database key. A wrong recovery key fails authentication and throws. */
export function unwrapDbKey(wrapped: WrappedKey, recoveryKey: string): string {
  if (wrapped.v !== 1 || wrapped.kdf !== 'scrypt')
    throw new RecoveryKeyError('Unsupported key format');
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      deriveKey(recoveryKey, Buffer.from(wrapped.salt, 'base64'), wrapped),
      Buffer.from(wrapped.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(wrapped.tag, 'base64'));
    const out = Buffer.concat([
      decipher.update(Buffer.from(wrapped.ct, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    if (!/^[0-9a-fA-F]{64}$/.test(out)) throw new Error('bad payload');
    return out;
  } catch (error) {
    if (error instanceof RecoveryKeyError && /32 letters/.test(error.message)) throw error;
    throw new RecoveryKeyError('That recovery key does not match this backup');
  }
}
