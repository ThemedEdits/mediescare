import { and, eq, isNull } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { newId } from '@mediescare/sync';
import type { DbOrTx } from '../client';
import { sessions } from '../schema/sqlite';

export const DEFAULT_IDLE_MS = 30 * 60 * 1000;
export const SESSION_COOKIE = 'mediescare_session';

const encode = (secret: string) => new TextEncoder().encode(secret);

export interface SessionClaims {
  sid: string;
  uid: string;
}

/** Signed cookie value (HS256). The server-side row is the authority, so sessions are revocable. */
export async function signSessionToken(claims: SessionClaims, secret: string, ttlSeconds = 12 * 3600): Promise<string> {
  return new SignJWT({ sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.uid)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(encode(secret));
}

export async function verifySessionToken(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, encode(secret), { algorithms: ['HS256'] });
    if (typeof payload.sid !== 'string' || typeof payload.sub !== 'string') return null;
    return { sid: payload.sid, uid: payload.sub };
  } catch {
    return null;
  }
}

export interface CreateSessionInput {
  userId: string;
  branchId: string;
  deviceId: string | null;
  now: Date;
  ttlMs?: number;
}

export function createSession(tx: DbOrTx, input: CreateSessionInput): string {
  const id = newId();
  const nowIso = input.now.toISOString();
  tx.insert(sessions)
    .values({
      id,
      userId: input.userId,
      branchId: input.branchId,
      deviceId: input.deviceId,
      createdAt: nowIso,
      lastSeenAt: nowIso,
      expiresAt: new Date(input.now.getTime() + (input.ttlMs ?? 12 * 3600 * 1000)).toISOString(),
    })
    .run();
  return id;
}

/**
 * Returns the session if it exists, is not revoked or expired, and was active within the idle window.
 * A valid check also slides the idle timer forward.
 */
export function touchSession(tx: DbOrTx, sid: string, now: Date, idleMs = DEFAULT_IDLE_MS) {
  const row = tx.select().from(sessions).where(and(eq(sessions.id, sid), isNull(sessions.revokedAt))).get();
  if (!row) return null;
  if (new Date(row.expiresAt) <= now) return null;
  if (now.getTime() - new Date(row.lastSeenAt).getTime() > idleMs) return null;
  tx.update(sessions).set({ lastSeenAt: now.toISOString() }).where(eq(sessions.id, sid)).run();
  return row;
}

export function revokeSession(tx: DbOrTx, sid: string, now: Date): void {
  tx.update(sessions).set({ revokedAt: now.toISOString() }).where(eq(sessions.id, sid)).run();
}

export function revokeAllSessionsForUser(tx: DbOrTx, userId: string, now: Date): void {
  tx.update(sessions)
    .set({ revokedAt: now.toISOString() })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .run();
}
