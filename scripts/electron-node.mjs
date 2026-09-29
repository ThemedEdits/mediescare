// Runs a Node script using Electron's bundled Node runtime (ELECTRON_RUN_AS_NODE).
// Why: the database layer is a native module that ships prebuilds for the Electron runtime
// (better-sqlite3-multiple-ciphers 13.x, verified in the Phase 1 spike). Tests and CLI tools
// therefore run on the same runtime as the shipped app instead of the system Node.
//
// Usage: node scripts/electron-node.mjs [node args] script.js [script args]
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronBinary = require('electron'); // resolves to the electron executable path

const child = spawn(electronBinary, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true,
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
