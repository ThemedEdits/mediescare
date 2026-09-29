import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { ZodError } from 'zod';
import {
  assertCan,
  ForbiddenError,
  type AccessContext,
  type PermissionKey,
} from '@mediescare/core';
import {
  AlreadyInitializedError,
  AuthError,
  DomainError,
  HTTP_STATUS,
  loadAccessContext,
  RecoveryKeyError,
  schema,
  SESSION_COOKIE,
  touchSession,
  verifySessionToken,
  type AuthMethod,
} from '@mediescare/db';
import { getDb, getSessionSecret } from './runtime';

export class UnauthorizedError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'UnauthorizedError';
  }
}

export interface AuthedRequest {
  access: AccessContext;
  userId: string;
  sessionId: string;
  branchId: string | null;
  method: AuthMethod;
  /** True until the user replaces a temporary password. Most routes refuse while this is set. */
  mustChangePassword: boolean;
}

/** Resolve the signed-in user from the session cookie. Server-side only: never trust the client. */
export async function authenticate(request: NextRequest): Promise<AuthedRequest> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new UnauthorizedError();
  const claims = await verifySessionToken(token, getSessionSecret());
  if (!claims) throw new UnauthorizedError();
  const db = getDb();
  const session = touchSession(db, claims.sid, new Date());
  if (!session || session.userId !== claims.uid) throw new UnauthorizedError();
  const access = loadAccessContext(db, claims.uid);
  if (!access) throw new UnauthorizedError();
  const user = db
    .select({ must: schema.users.mustChangePassword })
    .from(schema.users)
    .where(eq(schema.users.id, claims.uid))
    .get();
  return {
    access,
    userId: claims.uid,
    sessionId: claims.sid,
    branchId: session.branchId,
    method: session.authMethod as AuthMethod,
    mustChangePassword: user?.must ?? false,
  };
}

export interface RouteOptions {
  /** Allow the call while a temporary password is still pending (only the change-password route). */
  allowPendingPasswordChange?: boolean;
}

/**
 * Wrap a route handler: authenticate, require the permission, then run. Every protected route
 * declares its permission here, so a missing check is visible in review (and in routes.test.ts).
 */
export function withPermission<Ctx>(
  permission: PermissionKey,
  handler: (request: NextRequest, auth: AuthedRequest, ctx: Ctx) => Promise<Response> | Response,
  options: RouteOptions = {},
) {
  return (request: NextRequest, ctx: Ctx) =>
    respond(async () => {
      const auth = await authenticate(request);
      if (auth.mustChangePassword && !options.allowPendingPasswordChange) {
        return json(
          {
            error: {
              code: 'PASSWORD_CHANGE_REQUIRED',
              message: 'Change your temporary password first',
            },
          },
          428,
        );
      }
      // Quick-PIN sessions are for the counter. Administration needs the full password login.
      if (auth.method === 'pin' && permission.startsWith('admin.')) {
        return json(
          {
            error: { code: 'PIN_SESSION_LIMITED', message: 'Sign in with your password for this' },
          },
          403,
        );
      }
      assertCan(auth.access, permission, auth.branchId ?? undefined);
      return handler(request, auth, ctx);
    });
}

/** Handler for routes that need no permission (health, login, first-run setup, or that authenticate themselves). */
export function publicRoute<Ctx>(
  handler: (request: NextRequest, ctx: Ctx) => Promise<Response> | Response,
) {
  return (request: NextRequest, ctx: Ctx) => respond(() => handler(request, ctx));
}

/** Map domain errors to safe JSON responses. Internal errors are logged, never leaked. */
export async function respond(run: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof UnauthorizedError)
      return json({ error: { code: 'UNAUTHENTICATED' } }, 401);
    if (error instanceof ForbiddenError)
      return json({ error: { code: 'FORBIDDEN', permission: error.permission } }, 403);
    if (error instanceof AuthError)
      return json(
        { error: { code: error.code, message: error.message } },
        error.code === 'LOCKED' ? 429 : 401,
      );
    if (error instanceof DomainError)
      return json(
        { error: { code: error.code, message: error.message, details: error.details } },
        HTTP_STATUS[error.code],
      );
    if (error instanceof RecoveryKeyError)
      return json({ error: { code: 'INVALID', message: error.message } }, 400);
    if (error instanceof AlreadyInitializedError)
      return json({ error: { code: 'ALREADY_INITIALIZED' } }, 409);
    if (error instanceof ZodError) {
      return json(
        {
          error: {
            code: 'INVALID_INPUT',
            issues: error.issues.map((i) => ({ path: i.path, message: i.message })),
          },
        },
        400,
      );
    }
    console.error('[api] unhandled error', error instanceof Error ? error.message : 'unknown');
    return json({ error: { code: 'INTERNAL' } }, 500);
  }
}

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
