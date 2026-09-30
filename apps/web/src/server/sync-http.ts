import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import {
  CloudDatabaseAuthError,
  CloudDatabaseUnreachableError,
  DeviceAuthError,
  scrubSecrets,
} from '@mediescare/db/cloud';

/**
 * HTTP helpers for the cloud-mode routes. They must NOT import `./guard` or `./runtime`: those load
 * the SQLite runtime, and the cloud deployment (Vercel) never opens a local database and has no
 * native SQLite module. Everything here depends only on zod, next/server and the cloud modules.
 */
export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** The cloud is missing configuration (an environment variable). The message names variables only. */
export class CloudConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CloudConfigError';
  }
}

/** Map errors to safe JSON answers. Passwords, tokens and internals never leave the process. */
export async function cloudRespond(run: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await run();
  } catch (error) {
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
    if (error instanceof DeviceAuthError) {
      return json({ error: { code: error.code, message: error.message } }, error.status);
    }
    if (error instanceof CloudConfigError) {
      return json({ error: { code: 'CLOUD_NOT_CONFIGURED', message: error.message } }, 503);
    }
    if (error instanceof CloudDatabaseUnreachableError || error instanceof CloudDatabaseAuthError) {
      console.error('[cloud]', scrubSecrets(error.message));
      return json({ error: { code: 'CLOUD_DB_UNREACHABLE', message: error.message } }, 503);
    }
    const code = (error as { code?: unknown } | null)?.code;
    if (code === '42P01') {
      return json(
        {
          error: {
            code: 'CLOUD_NOT_MIGRATED',
            message: 'The cloud database has no tables yet. Run "pnpm cloud:migrate" once.',
          },
        },
        503,
      );
    }
    const message = error instanceof Error ? scrubSecrets(error.message) : 'unknown';
    console.error('[cloud] unhandled error', message);
    return json({ error: { code: 'INTERNAL' } }, 500);
  }
}

/** Route wrapper for cloud routes that authenticate themselves (device token, code or refresh token). */
export function publicRoute<Ctx>(
  handler: (request: NextRequest, ctx: Ctx) => Promise<Response> | Response,
) {
  return (request: NextRequest, ctx: Ctx) => cloudRespond(() => handler(request, ctx));
}

/** Best effort client address for rate limiting (Vercel sets x-forwarded-for itself). */
export function clientKey(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'unknown';
}
