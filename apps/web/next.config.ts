import path from 'node:path';
import type { NextConfig } from 'next';

/** Routes a cloud-mode deployment serves (everything else answers 404). */
const CLOUD_SERVED =
  'api/sync/(?:push|pull|bootstrap|enrollment-codes|enroll|token|health|landing|not-found)';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Lets a second build (for example a cloud-mode check) write somewhere other than .next.
  distDir: process.env.MEDIESCARE_NEXT_DIST_DIR || '.next',
  // Monorepo: trace files from the repository root so workspace packages and native modules are copied.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: [
    '@mediescare/config',
    '@mediescare/core',
    '@mediescare/db',
    '@mediescare/sync',
  ],
  // Native modules must not be bundled. 'better-sqlite3' is the SQLCipher fork (npm alias, ADR-0001).
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2', 'exceljs'],
  // Drizzle migration files are read from disk at start-up, so make sure they ship in the standalone output.
  outputFileTracingIncludes: {
    '/*': ['../../packages/db/migrations/**/*'],
    // Cloud migrations (only read by the local PGlite development store; Vercel uses `pnpm cloud:migrate`).
    '/api/sync/*': ['../../packages/db/cloud/**/*'],
  },
  poweredByHeader: false,
  // Cloud mode (Vercel): only the health probe, a landing page and the sync endpoints exist. Every other
  // page and API route is rewritten to a 404, so no branch screen or data route is reachable and SQLite is
  // never opened. Evaluated when the build runs, so MEDIESCARE_MODE=cloud must be set for the build.
  async rewrites() {
    if (process.env.MEDIESCARE_MODE?.trim() !== 'cloud') return [];
    return {
      beforeFiles: [
        { source: '/', destination: '/api/sync/landing' },
        { source: '/api/health', destination: '/api/sync/health' },
        {
          source: `/:path((?!${CLOUD_SERVED}$|_next/|icon\\.svg$).*)`,
          destination: '/api/sync/not-found',
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  reactStrictMode: true,
};

export default nextConfig;
