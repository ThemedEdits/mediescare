import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Monorepo: trace files from the repository root so workspace packages and native modules are copied.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@mediescare/config', '@mediescare/core', '@mediescare/db', '@mediescare/sync'],
  // Native modules must not be bundled. 'better-sqlite3' is the SQLCipher fork (npm alias, ADR-0001).
  serverExternalPackages: ['better-sqlite3', '@node-rs/argon2'],
  // Drizzle migration files are read from disk at start-up, so make sure they ship in the standalone output.
  outputFileTracingIncludes: {
    '/*': ['../../packages/db/migrations/**/*'],
  },
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
