import { json, publicRoute } from '@/server/sync-http';

export const dynamic = 'force-dynamic';

/**
 * Target of the catch-all rewrite in cloud mode (next.config.ts): every page and API route that is
 * not cloud sync answers 404.
 */
const notFound = publicRoute(() => json({ error: { code: 'NOT_FOUND' } }, 404));
export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
