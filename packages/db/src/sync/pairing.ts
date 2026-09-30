import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { branches, devices } from '../schema/sqlite';

/** Pairing failures the route maps to 429 (too many codes) and 403 (bad code). */
export class PairingError extends Error {
  constructor(
    readonly code: 'RATE_LIMITED' | 'INVALID_CODE',
    message: string,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

export const PAIRING_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses allowed against one live code before it is burned. */
export const MAX_WRONG_ATTEMPTS = 5;
/** New codes allowed per rolling TTL window (an admin mashing the button cannot flood the server). */
export const MAX_CODES_PER_WINDOW = 5;

export interface PairingCodesOptions {
  now?: () => number;
  ttlMs?: number;
  /** Injectable digits source, for tests. */
  randomDigits?: () => string;
}

export interface CreatedCode {
  /** Shown once on the server screen, for example "4821-9037". */
  code: string;
  expiresAt: string;
}

interface Active {
  hash: Buffer;
  expiresAtMs: number;
  wrong: number;
  createdBy: string | null;
}

const hashCode = (code: string, salt: string): Buffer =>
  createHash('sha256').update(`${salt}:${code}`).digest();
const normalise = (code: string): string => code.replace(/[\s-]/g, '');

/**
 * One-time pairing codes, held only in memory (never written to disk, so a restart voids them).
 * At most one code is live; creating a new one replaces it. A code works once, for 10 minutes,
 * and is burned after five wrong guesses, so brute forcing 8 digits is not practical.
 */
export class PairingCodes {
  private readonly now: () => number;
  private readonly ttl: number;
  private readonly salt = randomBytes(16).toString('hex');
  private active: Active | null = null;
  private created: number[] = [];

  constructor(private readonly options: PairingCodesOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttl = options.ttlMs ?? PAIRING_TTL_MS;
  }

  create(createdBy: string | null): CreatedCode {
    const now = this.now();
    this.created = this.created.filter((t) => now - t < this.ttl);
    if (this.created.length >= MAX_CODES_PER_WINDOW) {
      throw new PairingError(
        'RATE_LIMITED',
        'Too many pairing codes were created. Wait a few minutes and try again.',
      );
    }
    this.created.push(now);
    const digits =
      this.options.randomDigits?.() ?? String(randomInt(0, 100_000_000)).padStart(8, '0');
    this.active = {
      hash: hashCode(digits, this.salt),
      expiresAtMs: now + this.ttl,
      wrong: 0,
      createdBy,
    };
    return {
      code: `${digits.slice(0, 4)}-${digits.slice(4)}`,
      expiresAt: new Date(now + this.ttl).toISOString(),
    };
  }

  /** True if the code is right, live and unused. A right code is consumed. Never reveals why it failed. */
  redeem(code: string): { ok: true; createdBy: string | null } | { ok: false } {
    const active = this.active;
    if (!active || this.now() >= active.expiresAtMs) {
      this.active = null;
      return { ok: false };
    }
    const candidate = hashCode(normalise(code), this.salt);
    if (timingSafeEqual(candidate, active.hash)) {
      this.active = null; // single use
      return { ok: true, createdBy: active.createdBy };
    }
    active.wrong += 1;
    if (active.wrong >= MAX_WRONG_ATTEMPTS) this.active = null;
    return { ok: false };
  }

  /** Whether a code is currently live (for the admin screen). Does not reveal the code. */
  isActive(): boolean {
    return this.active !== null && this.now() < this.active.expiresAtMs;
  }
}

const sha256Hex = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface PairedDevice {
  deviceId: string;
  /** Bearer token for this terminal: `<deviceId>.<secret>`. Shown once, only its hash is stored. */
  token: string;
  tenantId: string;
  branchId: string;
  branchCode: string;
}

/**
 * Exchange a valid pairing code for a device token. Creates the terminal's `devices` row (role
 * 'terminal', token stored as a SHA-256 hash of a 256-bit secret), audits it and queues it for sync
 * without the hash. The caller applies the request rate limit per source address.
 */
export function pairTerminal(
  db: Db,
  ctx: WriteContext,
  codes: PairingCodes,
  input: { code: string; deviceName: string },
): PairedDevice {
  const name = input.deviceName.trim();
  if (name.length < 2 || name.length > 60)
    throw new DomainError('INVALID', 'Enter a device name of 2 to 60 characters');
  const redeemed = codes.redeem(input.code);
  if (!redeemed.ok)
    throw new PairingError('INVALID_CODE', 'The pairing code is wrong or has expired');

  const secret = randomBytes(32).toString('base64url');
  const deviceId = newId();
  const now = isoNow(ctx);
  return db.transaction((tx) => {
    const branch = tx
      .select({ code: branches.code })
      .from(branches)
      .where(eq(branches.id, ctx.branchId))
      .get();
    if (!branch) throw new DomainError('NOT_FOUND', 'Branch not found');
    const row = {
      id: deviceId,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      name,
      role: 'terminal',
      tokenHash: sha256Hex(secret),
      certFingerprint: null,
      lastSeenAt: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(devices).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'devices',
      entityId: deviceId,
      op: 'insert',
      payload: { ...row, tokenHash: null },
    });
    appendAudit(tx, ctx, {
      action: 'device.pair',
      entityType: 'device',
      entityId: deviceId,
      newValue: { name, role: 'terminal', authorisedBy: redeemed.createdBy },
    });
    return {
      deviceId,
      token: `${deviceId}.${secret}`,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      branchCode: branch.code,
    };
  });
}

export interface DeviceIdentity {
  deviceId: string;
  tenantId: string;
  branchId: string;
  role: string;
}

/** Resolve a device bearer token. Constant-time compare; revoked or unknown devices give null. */
export function verifyDeviceToken(db: Db, token: string): DeviceIdentity | null {
  const dot = token.indexOf('.');
  if (dot < 1 || token.length > 200) return null;
  const row = db
    .select()
    .from(devices)
    .where(eq(devices.id, token.slice(0, dot)))
    .get();
  if (!row || row.revokedAt || !row.tokenHash) return null;
  const a = Buffer.from(sha256Hex(token.slice(dot + 1)), 'hex');
  const b = Buffer.from(row.tokenHash, 'hex');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { deviceId: row.id, tenantId: row.tenantId, branchId: row.branchId, role: row.role };
}

/** Revoke a device (stolen or retired terminal). Its token stops working immediately. */
export function revokeDevice(db: Db, ctx: WriteContext, deviceId: string): void {
  db.transaction((tx) => {
    const row = tx.select().from(devices).where(eq(devices.id, deviceId)).get();
    if (!row) throw new DomainError('NOT_FOUND', 'Device not found');
    if (row.revokedAt) return;
    const now = isoNow(ctx);
    tx.update(devices)
      .set({ revokedAt: now, updatedAt: now, hlc: ctx.clock.tick(), version: row.version + 1 })
      .where(eq(devices.id, deviceId))
      .run();
    recordChange(tx, ctx, {
      entityType: 'devices',
      entityId: deviceId,
      op: 'update',
      payload: { id: deviceId, revokedAt: now },
    });
    appendAudit(tx, ctx, {
      action: 'device.revoke',
      entityType: 'device',
      entityId: deviceId,
      oldValue: { name: row.name },
    });
  });
}
