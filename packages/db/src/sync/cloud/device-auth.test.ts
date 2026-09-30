import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { CloudAuthService, DeviceAuthError } from './device-auth';
import { migratedClient, resetCloudTables, TEST_JWT_SECRET } from './cloud-test-support';
import { createPgliteClient, type SqlClient } from './sql-client';

let sql: SqlClient;
let clock = Date.parse('2026-10-01T09:00:00Z');
let auth: CloudAuthService;

beforeAll(async () => {
  sql = await migratedClient(() => createPgliteClient());
}, 60_000);
afterAll(async () => {
  await sql.close();
});
beforeEach(async () => {
  clock = Date.parse('2026-10-01T09:00:00Z');
  await resetCloudTables(sql);
  auth = new CloudAuthService({ sql, jwtSecret: TEST_JWT_SECRET, now: () => clock });
});

const HO = {
  organisationName: 'Demo Pharmacy Group',
  branchCode: 'HO01',
  branchName: 'Head Office',
  deviceName: 'HO PC',
};
const code = (e: unknown) => (e as DeviceAuthError).code;
const is = (expected: string) => (e: unknown) => code(e) === expected;

describe('bootstrap', () => {
  it('creates the organisation, Head Office branch and device, and issues working tokens', async () => {
    const r = await auth.bootstrap(HO);
    expect(r.branch).toMatchObject({ code: 'HO01', isHeadOffice: true });
    expect(r.tenantName).toBe('Demo Pharmacy Group');
    const who = await auth.verifyAccessToken(r.accessToken);
    expect(who).toEqual({
      tenantId: r.tenantId,
      branchId: r.branch.id,
      deviceId: r.deviceId,
      headOffice: true,
    });
    expect(Date.parse(r.accessExpiresAt) - clock).toBe(15 * 60 * 1000);
  });

  it('works once per organisation name (case and spacing insensitive)', async () => {
    await auth.bootstrap(HO);
    await expect(
      auth.bootstrap({ ...HO, organisationName: '  demo  PHARMACY group ' }),
    ).rejects.toSatisfy(is('ORGANISATION_EXISTS'));
  });

  it('lets the same PC attach again with its own ids (after Disconnect) and keeps one Head Office', async () => {
    const identity = {
      tenantId: 'tenant-aaaaaaaa',
      branchId: 'branch-aaaaaaaa',
      deviceId: 'device-aaaaaaaa',
    };
    const first = await auth.bootstrap({ ...HO, identity });
    const again = await auth.bootstrap({ ...HO, identity });
    expect(again.deviceId).toBe(first.deviceId);
    expect(again.branch.id).toBe(first.branch.id);
    // The old refresh token no longer works; the new one does.
    await expect(auth.refresh(first.refreshToken)).rejects.toBeInstanceOf(DeviceAuthError);
    await expect(auth.refresh(again.refreshToken)).resolves.toBeTruthy();
    // A stranger with a different tenant id cannot take it over.
    await expect(
      auth.bootstrap({ ...HO, identity: { ...identity, tenantId: 'tenant-bbbbbbbb' } }),
    ).rejects.toSatisfy(is('ORGANISATION_EXISTS'));
  });

  it('refuses malformed identifiers', async () => {
    await expect(
      auth.bootstrap({ ...HO, identity: { tenantId: 'x; drop table tenants' } }),
    ).rejects.toSatisfy(is('INVALID_INPUT'));
  });
});

describe('access tokens', () => {
  it('expire after 15 minutes, reject tampering and other secrets, and stop at revocation', async () => {
    const r = await auth.bootstrap(HO);
    clock += 14 * 60 * 1000;
    expect(await auth.verifyAccessToken(r.accessToken)).not.toBeNull();
    clock += 2 * 60 * 1000;
    expect(await auth.verifyAccessToken(r.accessToken)).toBeNull();

    clock = Date.parse('2026-10-01T09:00:00Z');
    const fresh = (await auth.bootstrap({ ...HO, organisationName: 'Other Org' })).accessToken;
    expect(await auth.verifyAccessToken(`${fresh}x`)).toBeNull();
    const foreign = await new SignJWT({ tid: 't', bid: 'b' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('d')
      .setIssuer('mediescare-cloud')
      .setAudience('mediescare-sync')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('another-secret-0123456789-0123456789'));
    expect(await auth.verifyAccessToken(foreign)).toBeNull();
    expect(await auth.verifyAccessToken('garbage')).toBeNull();

    const who = await auth.verifyAccessToken(fresh);
    await auth.revokeDevice(who!.deviceId);
    expect(await auth.verifyAccessToken(fresh)).toBeNull();
  });

  it('requires a signing secret of at least 32 characters', () => {
    expect(() => new CloudAuthService({ sql, jwtSecret: 'short' })).toThrow(/32/);
  });
});

describe('refresh token rotation', () => {
  it('returns a new refresh token every time and retires the old one', async () => {
    const r = await auth.bootstrap(HO);
    const p1 = await auth.refresh(r.refreshToken);
    const p2 = await auth.refresh(p1.refreshToken);
    expect(new Set([r.refreshToken, p1.refreshToken, p2.refreshToken]).size).toBe(3);
    expect(await auth.verifyAccessToken(p2.accessToken)).not.toBeNull();
  });

  it('presenting an already used refresh token revokes the device, and the newest token dies with it', async () => {
    const r = await auth.bootstrap(HO);
    const p1 = await auth.refresh(r.refreshToken);
    const reuse = await auth.refresh(r.refreshToken).then(
      () => null,
      (e: unknown) => e,
    );
    expect(code(reuse)).toBe('DEVICE_REVOKED');
    await expect(auth.refresh(p1.refreshToken)).rejects.toSatisfy(is('DEVICE_REVOKED'));
    expect(await auth.verifyAccessToken(p1.accessToken)).toBeNull();
    expect(await auth.verifyAccessToken(r.accessToken)).toBeNull();
  });

  it('detects reuse of a token that is several rotations old', async () => {
    const r = await auth.bootstrap(HO);
    let latest = r.refreshToken;
    for (let i = 0; i < 5; i++) latest = (await auth.refresh(latest)).refreshToken;
    await expect(auth.refresh(r.refreshToken)).rejects.toSatisfy(is('DEVICE_REVOKED'));
  });

  it('rejects garbage and unknown tokens without revoking anything', async () => {
    const r = await auth.bootstrap(HO);
    const bad = [
      '',
      'nodot',
      `${r.deviceId}.short`,
      `${r.deviceId}.${'x'.repeat(40)}`,
      `unknown-device.${'y'.repeat(40)}`,
    ];
    for (const token of bad) {
      await expect(auth.refresh(token)).rejects.toSatisfy(is('INVALID_REFRESH'));
    }
    await expect(auth.refresh(r.refreshToken)).resolves.toBeTruthy();
  });

  it('stores only hashes of refresh tokens', async () => {
    const r = await auth.bootstrap(HO);
    const secret = r.refreshToken.slice(r.refreshToken.indexOf('.') + 1);
    const rows = await sql.query<{ refresh_hash: string }>('SELECT refresh_hash FROM devices');
    expect(JSON.stringify(rows)).not.toContain(secret);
    expect(rows[0]?.refresh_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('enrollment codes', () => {
  async function ho() {
    const r = await auth.bootstrap(HO);
    return { r, who: (await auth.verifyAccessToken(r.accessToken))! };
  }
  const branch = { branchCode: 'KHI01', branchName: 'Clifton' };

  it('only a Head Office device may create codes', async () => {
    const { r, who } = await ho();
    const c = await auth.createEnrollmentCode(who, branch);
    const enrolled = await auth.enroll({ code: c.code, deviceName: 'Clifton PC' });
    const branchWho = (await auth.verifyAccessToken(enrolled.accessToken))!;
    expect(branchWho.headOffice).toBe(false);
    await expect(
      auth.createEnrollmentCode(branchWho, { branchCode: 'KHI02', branchName: 'X' }),
    ).rejects.toSatisfy(is('FORBIDDEN'));
    expect(enrolled.tenantId).toBe(r.tenantId);
    expect(enrolled.branch).toMatchObject({ code: 'KHI01', name: 'Clifton', isHeadOffice: false });
  });

  it('a code works exactly once', async () => {
    const { who } = await ho();
    const c = await auth.createEnrollmentCode(who, branch);
    await auth.enroll({ code: c.code, deviceName: 'PC' });
    await expect(auth.enroll({ code: c.code, deviceName: 'PC 2' })).rejects.toSatisfy(
      is('INVALID_CODE'),
    );
  });

  it('two simultaneous enrolments with one code: one wins', async () => {
    const { who } = await ho();
    const c = await auth.createEnrollmentCode(who, branch);
    const results = await Promise.allSettled([
      auth.enroll({ code: c.code, deviceName: 'PC 1' }),
      auth.enroll({ code: c.code, deviceName: 'PC 2' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('expires after 24 hours and wrong codes get the same answer', async () => {
    const { who } = await ho();
    const c = await auth.createEnrollmentCode(who, branch);
    expect(Date.parse(c.expiresAt) - clock).toBe(24 * 3600 * 1000);
    clock += 24 * 3600 * 1000 + 1000;
    await expect(auth.enroll({ code: c.code, deviceName: 'PC' })).rejects.toSatisfy(
      is('INVALID_CODE'),
    );
    await expect(auth.enroll({ code: 'AAAA-BBBB-CCCC-DDDD', deviceName: 'PC' })).rejects.toSatisfy(
      is('INVALID_CODE'),
    );
  });

  it('accepts the code typed in lower case without dashes, and stores only a hash', async () => {
    const { who } = await ho();
    const c = await auth.createEnrollmentCode(who, branch);
    const stored = await sql.query<{ code_hash: string }>('SELECT code_hash FROM enrollment_codes');
    expect(JSON.stringify(stored)).not.toContain(c.code.replace(/-/g, ''));
    await expect(
      auth.enroll({ code: c.code.replace(/-/g, '').toLowerCase(), deviceName: 'PC' }),
    ).resolves.toBeTruthy();
  });

  it('enroll returns exactly the branch id Head Office reserved in the code', async () => {
    const { who } = await ho();
    const c = await auth.createEnrollmentCode(who, { ...branch, branchId: 'branch-reserved-1' });
    const enrolled = await auth.enroll({ code: c.code, deviceName: 'PC' });
    expect(enrolled.branch.id).toBe('branch-reserved-1');
    const row = await sql.query<{ code: string }>('SELECT code FROM branches WHERE id = $1', [
      'branch-reserved-1',
    ]);
    expect(row[0]?.code).toBe('KHI01');
    expect((await auth.verifyAccessToken(enrolled.accessToken))?.branchId).toBe(
      'branch-reserved-1',
    );
  });

  it('a reserved branch id that is taken, malformed or contradicted by the caller is refused', async () => {
    const { r, who } = await ho();
    await expect(
      auth.createEnrollmentCode(who, { ...branch, branchId: r.branch.id }),
    ).rejects.toSatisfy(is('CONFLICT'));
    await expect(
      auth.createEnrollmentCode(who, { ...branch, branchId: 'bad id!' }),
    ).rejects.toSatisfy(is('INVALID_INPUT'));
    const c = await auth.createEnrollmentCode(who, { ...branch, branchId: 'branch-reserved-2' });
    await expect(
      auth.enroll({ code: c.code, deviceName: 'PC', identity: { branchId: 'branch-other-99' } }),
    ).rejects.toSatisfy(is('CONFLICT'));
    // The failed attempt burned nothing: the same code still works, and gives the reserved id.
    await expect(auth.enroll({ code: c.code, deviceName: 'PC' })).resolves.toMatchObject({
      branch: { id: 'branch-reserved-2' },
    });
  });

  it('refuses a branch code that already exists; a failed enrolment burns nothing', async () => {
    const { who } = await ho();
    await expect(
      auth.createEnrollmentCode(who, { branchCode: 'HO01', branchName: 'Again' }),
    ).rejects.toSatisfy(is('CONFLICT'));
    const c = await auth.createEnrollmentCode(who, branch);
    await auth.enroll({ code: c.code, deviceName: 'PC', identity: { deviceId: 'device-taken-1' } });
    const c2 = await auth.createEnrollmentCode(who, { branchCode: 'KHI02', branchName: 'Other' });
    // Same device id again: the unique violation rolls the whole enrolment back, the code stays usable.
    await expect(
      auth.enroll({ code: c2.code, deviceName: 'PC', identity: { deviceId: 'device-taken-1' } }),
    ).rejects.toSatisfy(is('CONFLICT'));
    await expect(auth.enroll({ code: c2.code, deviceName: 'PC' })).resolves.toBeTruthy();
  });
});
