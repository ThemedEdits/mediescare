import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  ENROLLMENT_CODE_TTL_HOURS,
  newId,
  type DeviceAuth,
  type DeviceErrorCode,
  type DeviceIdentity,
  type EnrollResult,
  type TokenPair,
} from '@mediescare/sync';
import type { SqlClient, SqlQueryable } from './sql-client';

/**
 * Device credentials for the cloud (docs/sync.md, "Device tokens"):
 *
 * - access token: JWT (HS256, signed with MEDIESCARE_CLOUD_JWT_SECRET), 15 minutes, claims
 *   `sub` (device id), `tid` (tenant id), `bid` (branch id). Checked against the `devices` table on
 *   every request, so revoking a device takes effect at once.
 * - refresh token: `<deviceId>.<random>`; only its SHA-256 is stored. Every refresh returns a NEW
 *   token and retires the old one. Presenting a retired token means it was copied: the device is
 *   revoked.
 * - enrollment code: random 80-bit code, stored as a hash, valid 24 hours, works once.
 */
export class DeviceAuthError extends Error {
  constructor(
    readonly code: DeviceErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DeviceAuthError';
  }
}

export interface CloudAuthOptions {
  sql: SqlClient;
  /** HS256 signing secret, at least 32 characters. */
  jwtSecret: string;
  now?: () => number;
  accessTtlSeconds?: number;
  enrollmentTtlHours?: number;
}

const ISSUER = 'mediescare-cloud';
const AUDIENCE = 'mediescare-sync';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const MAX_OPEN_CODES = 20;
const USED_HASHES_KEPT = 20;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

function newCode(): string {
  const bytes = randomBytes(16);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % 32] as string).join('');
  return chars.match(/.{4}/g)!.join('-');
}

const normaliseCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

interface DeviceRow extends Record<string, unknown> {
  id: string;
  tenant_id: string;
  branch_id: string;
  revoked_at: string | null;
  is_head_office: boolean;
}

export class CloudAuthService {
  private readonly sql: SqlClient;
  private readonly secret: Uint8Array;
  private readonly now: () => number;

  constructor(private readonly o: CloudAuthOptions) {
    if (o.jwtSecret.length < 32)
      throw new Error('MEDIESCARE_CLOUD_JWT_SECRET must be at least 32 characters');
    this.sql = o.sql;
    this.secret = new TextEncoder().encode(o.jwtSecret);
    this.now = o.now ?? Date.now;
  }

  // ------------------------------------------------------------ issuing

  private async issueAccess(device: { id: string; tenant_id: string; branch_id: string }) {
    const ttl = this.o.accessTtlSeconds ?? ACCESS_TOKEN_TTL_SECONDS;
    const issued = Math.floor(this.now() / 1000);
    const accessToken = await new SignJWT({ tid: device.tenant_id, bid: device.branch_id })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(device.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(issued)
      .setExpirationTime(issued + ttl)
      .sign(this.secret);
    return { accessToken, accessExpiresAt: new Date((issued + ttl) * 1000).toISOString() };
  }

  private newRefresh(deviceId: string): { token: string; hash: string } {
    const secret = randomBytes(32).toString('base64url');
    return { token: `${deviceId}.${secret}`, hash: sha256(secret) };
  }

  private checkIdentity(identity: DeviceIdentity | undefined): void {
    for (const v of [identity?.tenantId, identity?.branchId, identity?.deviceId]) {
      if (v !== undefined && !ID_PATTERN.test(v))
        throw new DeviceAuthError('INVALID_INPUT', 400, 'Invalid identifier');
    }
  }

  // ------------------------------------------------------------ bootstrap

  /**
   * First Head Office PC: creates the organisation, its Head Office branch and this device. Works
   * once per organisation name. The same PC may attach again (after "Disconnect") by sending the
   * ids it used the first time: it then gets fresh credentials for its existing device.
   * The caller has already checked the bootstrap code.
   */
  async bootstrap(input: {
    organisationName: string;
    branchCode: string;
    branchName: string;
    deviceName: string;
    identity?: DeviceIdentity;
  }): Promise<EnrollResult> {
    this.checkIdentity(input.identity);
    const key = nameKey(input.organisationName);
    try {
      const out = await this.sql.transaction(async (tx) => {
        const tenant = (
          await tx.query<{ id: string; name: string }>(
            'SELECT id, name FROM tenants WHERE name_key = $1 FOR UPDATE',
            [key],
          )
        )[0];
        if (tenant) return this.reattach(tx, tenant, input);
        const tenantId = input.identity?.tenantId ?? newId();
        const branchId = input.identity?.branchId ?? newId();
        const deviceId = input.identity?.deviceId ?? newId();
        await tx.query('INSERT INTO tenants (id, name, name_key) VALUES ($1, $2, $3)', [
          tenantId,
          input.organisationName.trim(),
          key,
        ]);
        await tx.query(
          `INSERT INTO branches (id, tenant_id, code, name, is_head_office)
           VALUES ($1, $2, $3, $4, true)`,
          [branchId, tenantId, input.branchCode.trim(), input.branchName.trim()],
        );
        const refresh = this.newRefresh(deviceId);
        await tx.query(
          `INSERT INTO devices (id, tenant_id, branch_id, name, refresh_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [deviceId, tenantId, branchId, input.deviceName.trim(), refresh.hash],
        );
        return {
          tenantId,
          tenantName: input.organisationName.trim(),
          branch: {
            id: branchId,
            code: input.branchCode.trim(),
            name: input.branchName.trim(),
            isHeadOffice: true,
          },
          deviceId,
          refreshToken: refresh.token,
        };
      });
      return { ...out, ...(await this.issueAccess(toRow(out))) };
    } catch (error) {
      throw mapUnique(error);
    }
  }

  private async reattach(
    tx: SqlQueryable,
    tenant: { id: string; name: string },
    input: {
      branchCode: string;
      branchName: string;
      deviceName: string;
      identity?: DeviceIdentity;
    },
  ) {
    const exists = () =>
      new DeviceAuthError(
        'ORGANISATION_EXISTS',
        409,
        'This organisation already exists in the cloud. Use an enrollment code for a new branch.',
      );
    if (!input.identity?.tenantId || input.identity.tenantId !== tenant.id) throw exists();
    const ho = (
      await tx.query<{ id: string; code: string; name: string }>(
        'SELECT id, code, name FROM branches WHERE tenant_id = $1 AND is_head_office',
        [tenant.id],
      )
    )[0];
    if (!ho || (input.identity.branchId && input.identity.branchId !== ho.id)) throw exists();
    const deviceId = input.identity.deviceId ?? newId();
    const refresh = this.newRefresh(deviceId);
    const dev = (
      await tx.query<{ branch_id: string }>(
        'SELECT branch_id FROM devices WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [deviceId, tenant.id],
      )
    )[0];
    if (dev) {
      if (dev.branch_id !== ho.id) throw exists();
      await tx.query(
        `UPDATE devices SET refresh_hash = $2, refresh_used = '{}', revoked_at = NULL,
                name = $3, refreshed_at = now() WHERE id = $1`,
        [deviceId, refresh.hash, input.deviceName.trim()],
      );
    } else {
      await tx.query(
        `INSERT INTO devices (id, tenant_id, branch_id, name, refresh_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [deviceId, tenant.id, ho.id, input.deviceName.trim(), refresh.hash],
      );
    }
    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      branch: { id: ho.id, code: ho.code, name: ho.name, isHeadOffice: true },
      deviceId,
      refreshToken: refresh.token,
    };
  }

  // ------------------------------------------------------------ enrollment codes

  /** A Head Office device creates a one-time code for a new branch. */
  async createEnrollmentCode(
    auth: DeviceAuth,
    input: { branchCode: string; branchName: string; branchId?: string },
  ): Promise<{ code: string; expiresAt: string }> {
    this.checkIdentity({ branchId: input.branchId });
    if (!auth.headOffice)
      throw new DeviceAuthError(
        'FORBIDDEN',
        403,
        'Only a Head Office device can create enrollment codes',
      );
    const nowIso = new Date(this.now()).toISOString();
    const expiresAt = new Date(
      this.now() + (this.o.enrollmentTtlHours ?? ENROLLMENT_CODE_TTL_HOURS) * 3_600_000,
    ).toISOString();
    const code = newCode();
    try {
      await this.sql.transaction(async (tx) => {
        const taken = await tx.query('SELECT 1 FROM branches WHERE tenant_id = $1 AND code = $2', [
          auth.tenantId,
          input.branchCode.trim(),
        ]);
        if (taken.length > 0)
          throw new DeviceAuthError('CONFLICT', 409, 'A branch with this code already exists');
        if (input.branchId) {
          const idTaken = await tx.query('SELECT 1 FROM branches WHERE id = $1', [input.branchId]);
          if (idTaken.length > 0)
            throw new DeviceAuthError('CONFLICT', 409, 'A branch with this id already exists');
        }
        const open = await tx.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM enrollment_codes
            WHERE tenant_id = $1 AND used_at IS NULL AND expires_at > $2::timestamptz`,
          [auth.tenantId, nowIso],
        );
        if (Number(open[0]?.n ?? 0) >= MAX_OPEN_CODES)
          throw new DeviceAuthError(
            'RATE_LIMITED',
            429,
            'Too many unused enrollment codes; wait or use them',
          );
        await tx.query(
          `INSERT INTO enrollment_codes
             (code_hash, tenant_id, branch_code, branch_name, branch_id, created_by_device, created_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)`,
          [
            sha256(normaliseCode(code)),
            auth.tenantId,
            input.branchCode.trim(),
            input.branchName.trim(),
            input.branchId ?? null,
            auth.deviceId,
            nowIso,
            expiresAt,
          ],
        );
      });
    } catch (error) {
      throw mapUnique(error);
    }
    return { code, expiresAt };
  }

  /** A new branch trades a code for its device. Wrong, expired and used codes all answer the same. */
  async enroll(input: {
    code: string;
    deviceName: string;
    identity?: Pick<DeviceIdentity, 'branchId' | 'deviceId'>;
  }): Promise<EnrollResult> {
    this.checkIdentity(input.identity);
    const nowIso = new Date(this.now()).toISOString();
    try {
      const out = await this.sql.transaction(async (tx) => {
        const deviceId = input.identity?.deviceId ?? newId();
        const claimed = await tx.query<{
          tenant_id: string;
          branch_code: string;
          branch_name: string;
          branch_id: string | null;
          is_head_office: boolean;
        }>(
          `UPDATE enrollment_codes SET used_at = $2::timestamptz, used_by_device = $3
            WHERE code_hash = $1 AND used_at IS NULL AND expires_at > $2::timestamptz
          RETURNING tenant_id, branch_code, branch_name, branch_id, is_head_office`,
          [sha256(normaliseCode(input.code)), nowIso, deviceId],
        );
        const code = claimed[0];
        if (!code)
          throw new DeviceAuthError(
            'INVALID_CODE',
            403,
            'The enrollment code is wrong, expired or already used',
          );
        const tenant = (
          await tx.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [
            code.tenant_id,
          ])
        )[0];
        // The id Head Office reserved in the code wins: it already created the branch row with it.
        if (
          code.branch_id &&
          input.identity?.branchId &&
          input.identity.branchId !== code.branch_id
        )
          throw new DeviceAuthError('CONFLICT', 409, 'This code is for a different branch id');
        const branchId = code.branch_id ?? input.identity?.branchId ?? newId();
        await tx.query(
          `INSERT INTO branches (id, tenant_id, code, name, is_head_office)
           VALUES ($1, $2, $3, $4, false)`,
          [branchId, code.tenant_id, code.branch_code, code.branch_name],
        );
        const refresh = this.newRefresh(deviceId);
        await tx.query(
          `INSERT INTO devices (id, tenant_id, branch_id, name, refresh_hash)
           VALUES ($1, $2, $3, $4, $5)`,
          [deviceId, code.tenant_id, branchId, input.deviceName.trim(), refresh.hash],
        );
        return {
          tenantId: code.tenant_id,
          tenantName: tenant?.name ?? '',
          branch: {
            id: branchId,
            code: code.branch_code,
            name: code.branch_name,
            isHeadOffice: false,
          },
          deviceId,
          refreshToken: refresh.token,
        };
      });
      return { ...out, ...(await this.issueAccess(toRow(out))) };
    } catch (error) {
      throw mapUnique(error);
    }
  }

  // ------------------------------------------------------------ refresh

  /** Trade a refresh token for a new pair. Reuse of a retired token revokes the device. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const dot = refreshToken.indexOf('.');
    const deviceId = dot > 0 ? refreshToken.slice(0, dot) : '';
    const secret = dot > 0 ? refreshToken.slice(dot + 1) : '';
    if (!ID_PATTERN.test(deviceId) || secret.length < 20 || secret.length > 200)
      throw new DeviceAuthError('INVALID_REFRESH', 401, 'Invalid refresh token');
    const hash = sha256(secret);
    const nowIso = new Date(this.now()).toISOString();

    const outcome = await this.sql.transaction(async (tx) => {
      const row = (
        await tx.query<{
          id: string;
          tenant_id: string;
          branch_id: string;
          revoked_at: string | null;
          is_current: boolean;
          was_used: boolean;
        }>(
          `SELECT id, tenant_id, branch_id, revoked_at,
                  (refresh_hash = $2) AS is_current, ($2 = ANY (refresh_used)) AS was_used
             FROM devices WHERE id = $1 FOR UPDATE`,
          [deviceId, hash],
        )
      )[0];
      if (!row) return { kind: 'invalid' as const };
      if (row.revoked_at) return { kind: 'revoked' as const };
      if (row.was_used) {
        await tx.query('UPDATE devices SET revoked_at = $2::timestamptz WHERE id = $1', [
          deviceId,
          nowIso,
        ]);
        return { kind: 'reused' as const };
      }
      if (!row.is_current) return { kind: 'invalid' as const };
      const next = this.newRefresh(deviceId);
      await tx.query(
        `UPDATE devices
            SET refresh_hash = $2,
                refresh_used = (ARRAY[$3::text] || refresh_used)[1:${USED_HASHES_KEPT}],
                refreshed_at = $4::timestamptz, last_seen_at = $4::timestamptz
          WHERE id = $1`,
        [deviceId, next.hash, hash, nowIso],
      );
      return { kind: 'ok' as const, row, token: next.token };
    });

    if (outcome.kind === 'ok') {
      return { ...(await this.issueAccess(outcome.row)), refreshToken: outcome.token };
    }
    if (outcome.kind === 'invalid')
      throw new DeviceAuthError('INVALID_REFRESH', 401, 'Invalid refresh token');
    throw new DeviceAuthError(
      'DEVICE_REVOKED',
      401,
      outcome.kind === 'reused'
        ? 'This refresh token was already used, so the device was revoked'
        : 'This device was revoked',
    );
  }

  // ------------------------------------------------------------ verification

  /** Resolve an access token to its device, or null (bad signature, expired, unknown, revoked). */
  async verifyAccessToken(token: string): Promise<DeviceAuth | null> {
    let claims: { sub?: string; tid?: unknown; bid?: unknown };
    try {
      const res = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
        currentDate: new Date(this.now()),
      });
      claims = res.payload as typeof claims;
    } catch {
      return null;
    }
    if (!claims.sub || typeof claims.tid !== 'string' || typeof claims.bid !== 'string')
      return null;
    const rows = await this.sql.query<DeviceRow>(
      `SELECT d.id, d.tenant_id, d.branch_id, d.revoked_at, b.is_head_office
         FROM devices d JOIN branches b ON b.id = d.branch_id
        WHERE d.id = $1`,
      [claims.sub],
    );
    const d = rows[0];
    if (!d || d.revoked_at || d.tenant_id !== claims.tid || d.branch_id !== claims.bid) return null;
    return {
      tenantId: d.tenant_id,
      branchId: d.branch_id,
      deviceId: d.id,
      headOffice: d.is_head_office === true,
    };
  }

  async revokeDevice(deviceId: string): Promise<boolean> {
    const rows = await this.sql.query(
      `UPDATE devices SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
      [deviceId],
    );
    return rows.length > 0;
  }
}

function toRow(o: { deviceId: string; tenantId: string; branch: { id: string } }) {
  return { id: o.deviceId, tenant_id: o.tenantId, branch_id: o.branch.id };
}

/** A unique violation means the ids or code the caller asked for are taken. */
function mapUnique(error: unknown): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === '23505')
    return new DeviceAuthError(
      'CONFLICT',
      409,
      'That identifier or branch code is already registered',
    );
  return error;
}
