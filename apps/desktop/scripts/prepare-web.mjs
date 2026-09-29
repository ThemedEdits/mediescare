// Assembles a self-contained copy of the Next.js standalone server for packaging:
//   build/web/apps/web/server.js + node_modules + .next/static + public + packages/db/migrations
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, '../web');
const standalone = join(web, '.next/standalone');
const out = join(root, 'build/web');

if (!existsSync(join(standalone, 'apps/web/server.js'))) {
  throw new Error('Run "pnpm --filter @mediescare/web build" first: .next/standalone/apps/web/server.js is missing.');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(standalone, out, { recursive: true, dereference: true });
// Next.js does not copy static assets into standalone output by default.
cpSync(join(web, '.next/static'), join(out, 'apps/web/.next/static'), { recursive: true });
if (existsSync(join(web, 'public'))) cpSync(join(web, 'public'), join(out, 'apps/web/public'), { recursive: true });
// Migrations are read from disk at start-up.
cpSync(join(root, '../../packages/db/migrations'), join(out, 'packages/db/migrations'), { recursive: true });
console.log(`Prepared ${out}`);
