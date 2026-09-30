import { CloudAuthError } from './outbox';

/**
 * Device authentication shared by the cloud endpoints and the branch client.
 *
 * A device holds a long-lived, rotating **refresh token** and trades it for a short-lived
 * (15 minutes) **access token** (JWT, HS256). Only the access token is sent with push and pull.
 */

/** Returns a fresh access token. Called before every cloud request. */
export type TokenProvider = () => Promise<string>;

export interface BranchInfo {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
}

export interface EnrollResult {
  deviceId: string;
  tenantId: string;
  tenantName: string;
  branch: BranchInfo;
  accessToken: string;
  refreshToken: string;
  /** ISO time the access token stops working. */
  accessExpiresAt: string;
}

/** What a refresh returns: a new access token and a NEW refresh token (the old one is dead). */
export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: string;
}

/**
 * Optional ids an existing branch database asks the cloud to adopt, so the events already in its
 * outbox (which carry these ids) are accepted. A brand-new branch leaves this out and uses the ids
 * the cloud issues.
 */
export interface DeviceIdentity {
  tenantId?: string;
  branchId?: string;
  deviceId?: string;
}

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const ENROLLMENT_CODE_TTL_HOURS = 24;

/** Error codes of the device endpoints, returned as `{ error: { code } }`. */
export const DEVICE_ERROR_CODES = [
  'INVALID_INPUT',
  'BOOTSTRAP_DISABLED',
  'BOOTSTRAP_CODE_WRONG',
  'ORGANISATION_EXISTS',
  'INVALID_CODE',
  'CONFLICT',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'INVALID_REFRESH',
  'DEVICE_REVOKED',
  'RATE_LIMITED',
  'NOT_CLOUD_MODE',
  'CLOUD_DB_UNREACHABLE',
  'CLOUD_NOT_MIGRATED',
] as const;
export type DeviceErrorCode = (typeof DEVICE_ERROR_CODES)[number];

/** A device endpoint refused the request (wrong code, rate limit, unreachable cloud, ...). */
export class CloudRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'CloudRequestError';
  }
}

/**
 * The cloud revoked this device, or the refresh token can no longer be used (for example it was
 * used twice). The sync runner stops in state `revoked` instead of retrying forever.
 */
export class DeviceRevokedError extends CloudAuthError {
  constructor(
    message = 'This device was disconnected from the cloud. Reconnect it from Settings.',
  ) {
    super(message);
    this.name = 'DeviceRevokedError';
  }
}
