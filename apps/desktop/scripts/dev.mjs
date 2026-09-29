// Runs the desktop shell against the locally built web app: `pnpm build` (web) first, then `pnpm dev:desktop`.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

if (!existsSync(join(root, 'build/web/apps/web/server.js'))) {
  console.log('Preparing the web build copy…');
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(root, 'scripts/prepare-web.mjs')], { stdio: 'inherit' });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error('prepare-web failed'))));
  });
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // must not be set when launching the Electron GUI
const child = spawn(require('electron'), [root], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
