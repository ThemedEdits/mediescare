import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../client';
import { appendAudit } from '../audit';
import { isoNow, type WriteContext } from '../context';
import { devices, users } from '../schema/sqlite';
import { AuthError, LOCK_MS, lockedMessage, MAX_FAILED_LOGINS, type LoginResult } from './login';
import { hashPassword, verifyPassword } from './password';
import { createSession, signSessionToken } from './session';

let dummyPinHash: Promise<string> | undefined;
const getDummyPinHash = () => (dummyPinHash ??= hashPassword('000000-timing-only'));

type Outcome =
  | { kind: 'ok'; sessionId: string; user: LoginResult['user'] }
  | { kind: 'fail'; code: 'INVALID_CREDENTIALS' | 'LOCKED' | 'DISABLED'; message: string };

/**
 * Quick PIN login for a POS counter. Works only from a registered, non-revoked device of this
 * branch and only for users who have a PIN. The session is limited (5 min idle lock, POS only:
 * the API guard refuses admin permissions for PIN sessions). Failures share the password lockout.
 */
export async function loginWithPin(
  db: Db,
  ctx: WriteContext,
  input: { username: string; pin: string },
  sessionSecret: string,
): Promise<LoginResult> {
  const device = db
    .select()
    .from(devices)
    .where(
      and(
        eq(devices.id, ctx.deviceId),
        eq(devices.branchId, ctx.branchId),
        isNull(devices.revokedAt),
      ),
    )
    .get();
  const user = device
    ? db
        .select()
        .from(users)
        .where(
          and(
            eq(users.tenantId, ctx.tenantId),
            eq(users.username, input.username),
            isNull(users.deletedAt),
          ),
        )
        .get()
    : undefined;

  const pinOk = await verifyPassword(user?.pinHash ?? (await getDummyPinHash()), input.pin);

  const outcome = db.transaction((tx): Outcome => {
    const nowIso = isoNow(ctx);
    const now = new Date(nowIso);
    const audit = (action: string, userId: string | null, detail: unknown) =>
      appendAudit(
        tx,
        { ...ctx, userId },
        { action, entityType: 'user', entityId: userId, newValue: detail },
      );
    const invalid: Outcome = {
      kind: 'fail',
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid username or PIN',
    };

    if (!device) {
      audit('auth.pin_login.failed', null, { reason: 'device_not_allowed' });
      return invalid;
    }
    if (!user || !user.pinHash) {
      audit('auth.pin_login.failed', user?.id ?? null, {
        reason: user ? 'no_pin' : 'unknown_user',
      });
      return invalid;
    }
    if (user.status !== 'active') {
      audit('auth.pin_login.failed', user.id, { reason: 'disabled' });
      return { kind: 'fail', code: 'DISABLED', message: 'This account is disabled' };
    }
    if (user.lockedUntil && new Date(user.lockedUntil) > now) {
      audit('auth.pin_login.failed', user.id, { reason: 'locked' });
      return { kind: 'fail', code: 'LOCKED', message: lockedMessage(user.lockedUntil, now) };
    }
    if (!pinOk) {
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
      audit('auth.pin_login.failed', user.id, { reason: 'wrong_pin', locked: lock });
      return invalid;
    }
    tx.update(users)
      .set({
        failedLogins: 0,
        lockedUntil: null,
        lastLoginAt: nowIso,
        updatedAt: nowIso,
        hlc: ctx.clock.tick(),
      })
      .where(eq(users.id, user.id))
      .run();
    const sessionId = createSession(tx, {
      userId: user.id,
      branchId: ctx.branchId,
      deviceId: ctx.deviceId,
      now,
      authMethod: 'pin',
    });
    audit('auth.pin_login.success', user.id, null);
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
  const token = await signSessionToken(
    { sid: outcome.sessionId, uid: outcome.user.id },
    sessionSecret,
    12 * 3600,
  );
  return { token, sessionId: outcome.sessionId, user: outcome.user };
}
