import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../client';
import { appendAudit } from '../audit';
import { isoNow, type WriteContext } from '../context';
import { users } from '../schema/sqlite';
import { hashPassword, verifyPassword } from './password';
import { createSession, signSessionToken } from './session';

export const MAX_FAILED_LOGINS = 5;
export const LOCK_MS = 15 * 60 * 1000;

export type AuthErrorCode = 'INVALID_CREDENTIALS' | 'LOCKED' | 'DISABLED';

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

// A real argon2 hash, verified against when the username does not exist, so response time does
// not reveal which usernames are valid.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('timing-equalisation-only'));

export interface LoginInput {
  username: string;
  password: string;
}

export interface LoginResult {
  token: string;
  sessionId: string;
  user: { id: string; username: string; fullName: string; language: string; mustChangePassword: boolean };
}

type Outcome =
  | { kind: 'ok'; sessionId: string; user: LoginResult['user'] }
  | { kind: 'fail'; code: AuthErrorCode; message: string };

/**
 * Password login. The (slow) hash check runs first, then every write for the outcome happens in
 * one synchronous transaction. Success and failure are both written to the audit chain.
 * Failure messages are identical for an unknown user and a wrong password.
 */
export async function login(db: Db, ctx: WriteContext, input: LoginInput, sessionSecret: string): Promise<LoginResult> {
  const user = db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, ctx.tenantId), eq(users.username, input.username), isNull(users.deletedAt)))
    .get();

  const passwordOk = await verifyPassword(user?.passwordHash ?? (await getDummyHash()), input.password);

  const outcome = db.transaction((tx): Outcome => {
    const nowIso = isoNow(ctx);
    const now = new Date(nowIso);
    const audit = (action: string, userId: string | null, detail: unknown) =>
      appendAudit(tx, { ...ctx, userId }, { action, entityType: 'user', entityId: userId, newValue: detail });
    const invalid: Outcome = { kind: 'fail', code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' };

    if (!user) {
      audit('auth.login.failed', null, { reason: 'unknown_user' });
      return invalid;
    }
    if (user.status !== 'active') {
      audit('auth.login.failed', user.id, { reason: 'disabled' });
      return { kind: 'fail', code: 'DISABLED', message: 'This account is disabled' };
    }
    if (user.lockedUntil && new Date(user.lockedUntil) > now) {
      audit('auth.login.failed', user.id, { reason: 'locked' });
      return { kind: 'fail', code: 'LOCKED', message: 'Too many failed attempts. Try again later' };
    }
    if (!passwordOk) {
      const failed = user.failedLogins + 1;
      const lock = failed >= MAX_FAILED_LOGINS;
      tx.update(users)
        .set({
          failedLogins: lock ? 0 : failed,
          lockedUntil: lock ? new Date(now.getTime() + LOCK_MS).toISOString() : null,
          updatedAt: nowIso,
          hlc: ctx.clock.tick(),
        })
        .where(eq(users.id, user.id))
        .run();
      audit('auth.login.failed', user.id, { reason: 'wrong_password', locked: lock });
      return invalid;
    }

    tx.update(users)
      .set({ failedLogins: 0, lockedUntil: null, lastLoginAt: nowIso, updatedAt: nowIso, hlc: ctx.clock.tick() })
      .where(eq(users.id, user.id))
      .run();
    const sessionId = createSession(tx, { userId: user.id, branchId: ctx.branchId, deviceId: ctx.deviceId, now });
    audit('auth.login.success', user.id, null);
    return {
      kind: 'ok',
      sessionId,
      user: {
        id: user.id,
        username: user.username,
        fullName: user.fullName,
        language: user.language,
        mustChangePassword: user.mustChangePassword,
      },
    };
  });

  if (outcome.kind === 'fail') throw new AuthError(outcome.code, outcome.message);
  const token = await signSessionToken({ sid: outcome.sessionId, uid: outcome.user.id }, sessionSecret);
  return { token, sessionId: outcome.sessionId, user: outcome.user };
}
