// Runs a Node script using Electron's bundled Node runtime (ELECTRON_RUN_AS_NODE).
// Why: the database layer is a native module that ships prebuilds for the Electron runtime
// (better-sqlite3-multiple-ciphers 13.x, verified in the Phase 1 spike). Tests and CLI tools
// therefore run on the same runtime as the shipped app instead of the system Node.
//
// Usage: node scripts/electron-node.mjs [node args] script.js [script args]
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electronBinary = require('electron'); // resolves to the electron executable path

// Development: the single .env lives at the repository root, but the tools start in a package folder.
// Values already set in the shell win. Nothing here is used by the packaged app.
function rootEnv() {
  const file = fileURLToPath(new URL('../.env', import.meta.url));
  if (!existsSync(file)) return {};
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

const child = spawn(electronBinary, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...rootEnv(), ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
