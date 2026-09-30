// Runs the cloud-mode app locally on port 3220 with a free in-process PostgreSQL (PGlite), so the
// whole cloud side can be tried with no Supabase account. Data is kept in data/cloud-pglite
// (git-ignored). Development values only: they replace anything in the repository .env on purpose,
// so local runs never use the real cloud secrets. Set MEDIESCARE_CLOUD_STORE=postgres to use the
// real database from MEDIESCARE_CLOUD_DATABASE_URL instead.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env };
env.MEDIESCARE_MODE = 'cloud';
env.MEDIESCARE_CLOUD_STORE ??= 'pglite';
if (env.MEDIESCARE_CLOUD_STORE === 'pglite') {
  env.MEDIESCARE_CLOUD_PGLITE_DIR ??= resolve(root, 'data', 'cloud-pglite');
  env.MEDIESCARE_CLOUD_JWT_SECRET ??= 'dev-only-jwt-secret-change-me-0123456789abcdef';
  env.MEDIESCARE_CLOUD_BOOTSTRAP_CODE ??= 'dev-bootstrap-code';
  console.log('[cloud:dev] PGlite store in data/cloud-pglite. Bootstrap code: dev-bootstrap-code');
}
const child = spawn(
  process.execPath,
  [
    resolve(root, 'scripts', 'electron-node.mjs'),
    resolve(root, 'node_modules', 'next', 'dist', 'bin', 'next'),
    'dev',
    '--port',
    '3220',
  ],
  { cwd: resolve(root, 'apps', 'web'), stdio: 'inherit', env },
);
child.on('exit', (code) => process.exit(code ?? 1));
