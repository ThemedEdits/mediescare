/** Expected business errors. Route handlers map `code` to an HTTP status and a safe message. */
export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID'
  | 'VERSION_CONFLICT'
  | 'LAST_SUPER_ADMIN'
  | 'IMMUTABLE_ROLE'
  | 'PRIVILEGE_ESCALATION'
  | 'OVERRIDE_INVALID'
  | 'INSUFFICIENT_STOCK'
  | 'EXPIRED_BATCH'
  | 'SHIFT_REQUIRED'
  | 'OVERRIDE_REQUIRED';

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const HTTP_STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID: 400,
  VERSION_CONFLICT: 409,
  LAST_SUPER_ADMIN: 409,
  IMMUTABLE_ROLE: 409,
  PRIVILEGE_ESCALATION: 403,
  OVERRIDE_INVALID: 403,
  INSUFFICIENT_STOCK: 409,
  EXPIRED_BATCH: 409,
  SHIFT_REQUIRED: 409,
  OVERRIDE_REQUIRED: 403,
};
