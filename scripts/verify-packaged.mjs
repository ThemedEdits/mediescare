// One command for the release gate: build the web app, bundle the desktop shell, package the
// Windows app (unpacked) and run the packaged-app smoke test against it.
// Usage: pnpm verify:packaged
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
delete env.ELECTRON_RUN_AS_NODE; // must not leak into the Electron GUI launch

function step(name, command, args, cwd) {
  console.log(`\n=== ${name}`);
  const r = spawnSync(command, args, {
    cwd,
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(`\nFAILED: ${name}`);
    process.exit(r.status ?? 1);
  }
}

rmSync(join(root, 'apps/web/.next'), { recursive: true, force: true });
rmSync(join(root, 'release'), { recursive: true, force: true });
step('Build web app', 'pnpm', ['--filter', '@mediescare/web', 'build'], root);
step(
  'Package desktop app (unpacked)',
  'pnpm',
  ['--filter', '@mediescare/desktop', 'package:dir'],
  root,
);
step('Packaged-app smoke test', 'pnpm', ['--filter', '@mediescare/desktop', 'smoke'], root);
console.log('\nverify:packaged passed');
