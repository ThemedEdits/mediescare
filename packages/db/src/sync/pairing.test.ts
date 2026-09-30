import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../audit';
import { auditLog, devices, syncOutbox } from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import {
  MAX_CODES_PER_WINDOW,
  MAX_WRONG_ATTEMPTS,
  PairingCodes,
  PairingError,
  pairTerminal,
  revokeDevice,
  verifyDeviceToken,
} from './pairing';

describe('PairingCodes', () => {
  const clock = { ms: 1_000_000 };
  const codes = () => new PairingCodes({ now: () => clock.ms, randomDigits: () => '48219037' });

  it('formats an 8 digit code and accepts it once, with or without the dash', () => {
    const c = codes();
    const created = c.create('admin-1');
    expect(created.code).toBe('4821-9037');
    expect(c.redeem('4821-9037')).toEqual({ ok: true, createdBy: 'admin-1' });
    expect(c.redeem('4821-9037')).toEqual({ ok: false }); // single use
    c.create(null);
    expect(c.redeem('48219037').ok).toBe(true);
  });

  it('expires after 10 minutes', () => {
    const c = codes();
    const { expiresAt } = c.create(null);
    expect(Date.parse(expiresAt) - clock.ms).toBe(10 * 60 * 1000);
    clock.ms += 10 * 60 * 1000;
    expect(c.isActive()).toBe(false);
    expect(c.redeem('4821-9037').ok).toBe(false);
  });

  it('burns the code after five wrong guesses, even if the right one follows', () => {
    const c = codes();
    c.create(null);
    for (let i = 0; i < MAX_WRONG_ATTEMPTS; i++) expect(c.redeem('0000-0000').ok).toBe(false);
    expect(c.redeem('4821-9037').ok).toBe(false);
  });

  it('a new code replaces the old one, and creating codes is rate limited', () => {
    let n = 0;
    const c = new PairingCodes({
      now: () => clock.ms,
      randomDigits: () => String(10_000_000 + n++),
    });
    const first = c.create(null);
    c.create(null);
    expect(c.redeem(first.code).ok).toBe(false);
    for (let i = 2; i < MAX_CODES_PER_WINDOW; i++) c.create(null);
    expect(() => c.create(null)).toThrow(PairingError);
    clock.ms += 10 * 60 * 1000 + 1;
    expect(() => c.create(null)).not.toThrow();
  });
});

describe('pairing a terminal', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
  });
  afterEach(() => env.cleanup());

  it('creates a terminal device with a hashed token, audits it, and never syncs the hash', () => {
    const codes = new PairingCodes({ randomDigits: () => '12345678' });
    const { code } = codes.create(env.setup.adminUserId);
    const paired = pairTerminal(env.db, env.ctx(null), codes, { code, deviceName: 'Counter 2' });

    expect(paired.token.startsWith(`${paired.deviceId}.`)).toBe(true);
    const row = env.db.select().from(devices).where(eq(devices.id, paired.deviceId)).get();
    expect(row).toMatchObject({
      role: 'terminal',
      name: 'Counter 2',
      branchId: env.setup.branchId,
    });
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(paired.token.split('.')[1]);

    const event = env.db
      .select()
      .from(syncOutbox)
      .all()
      .find((r) => r.entityId === paired.deviceId);
    expect(JSON.parse(event?.payloadJson ?? '{}')).toMatchObject({ tokenHash: null });
    expect(
      env.db
        .select()
        .from(auditLog)
        .all()
        .some((a) => a.action === 'device.pair'),
    ).toBe(true);
    expect(verifyAuditChain(env.db, env.setup.branchId).ok).toBe(true);

    // The code is spent.
    expect(() =>
      pairTerminal(env.db, env.ctx(null), codes, { code, deviceName: 'Counter 3' }),
    ).toThrow(PairingError);
  });

  it('verifies the token in constant time, and refuses wrong, malformed and revoked tokens', () => {
    const codes = new PairingCodes({ randomDigits: () => '87654321' });
    const paired = pairTerminal(env.db, env.ctx(null), codes, {
      code: codes.create(null).code,
      deviceName: 'Counter 2',
    });
    expect(verifyDeviceToken(env.db, paired.token)).toMatchObject({
      deviceId: paired.deviceId,
      role: 'terminal',
      branchId: env.setup.branchId,
    });
    expect(verifyDeviceToken(env.db, `${paired.deviceId}.wrong-secret`)).toBeNull();
    expect(verifyDeviceToken(env.db, 'garbage')).toBeNull();
    expect(verifyDeviceToken(env.db, `nope.${paired.token.split('.')[1]}`)).toBeNull();

    revokeDevice(env.db, env.ctx(env.setup.adminUserId), paired.deviceId);
    expect(verifyDeviceToken(env.db, paired.token)).toBeNull();
    expect(
      env.db
        .select()
        .from(auditLog)
        .all()
        .some((a) => a.action === 'device.revoke'),
    ).toBe(true);
  });

  it('rejects a bad code and a silly device name without creating anything', () => {
    const codes = new PairingCodes({ randomDigits: () => '11112222' });
    codes.create(null);
    const before = env.db.select().from(devices).all().length;
    expect(() =>
      pairTerminal(env.db, env.ctx(null), codes, { code: '0000-0000', deviceName: 'Counter 2' }),
    ).toThrow(PairingError);
    expect(() =>
      pairTerminal(env.db, env.ctx(null), codes, { code: '1111-2222', deviceName: 'x' }),
    ).toThrow(/device name/);
    expect(env.db.select().from(devices).all().length).toBe(before);
  });
});
