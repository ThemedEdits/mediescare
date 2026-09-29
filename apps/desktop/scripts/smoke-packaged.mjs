// Packaged-app smoke test (CLAUDE.md §9: test the installer output, not only `dev`).
// Launches release/win-unpacked/Mediescare.exe with a throwaway data folder, then:
//   health -> first-run setup -> login -> guarded routes -> encrypted DB on disk -> clean shutdown.
// Usage: pnpm --filter @mediescare/desktop package:dir && pnpm --filter @mediescare/desktop smoke
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const exe = process.env.MEDIESCARE_EXE ?? join(root, 'release', 'win-unpacked', 'Mediescare.exe');
if (!existsSync(exe)) throw new Error(`Packaged app not found: ${exe}. Run "pnpm --filter @mediescare/desktop package:dir" first.`);

const userData = mkdtempSync(join(tmpdir(), 'mediescare-smoke-'));
const port = 3390 + Math.floor(Math.random() * 50);
mkdirSync(userData, { recursive: true });
// Pre-seed the wizard answer so the test needs no GUI interaction.
writeFileSync(join(userData, 'config.json'), JSON.stringify({ mode: 'single', port }));

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) throw new Error(`Smoke test failed: ${name}`);
};

const env = { ...process.env, MEDIESCARE_USER_DATA: userData };
delete env.ELECTRON_RUN_AS_NODE;
const startedAt = Date.now();
const app = spawn(exe, [], { env, stdio: 'ignore', windowsHide: false });
let exited = false;
app.once('exit', () => (exited = true));

const base = () => `http://127.0.0.1:${port}`;
async function waitHealthy(timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${base()}/api/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) return await r.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return null;
}

try {
  const health = await waitHealthy(60_000);
  check('server starts and answers /api/health', !!health && health.status === 'ok', `${((Date.now() - startedAt) / 1000).toFixed(1)}s cold start`);
  check('mode is single and DB is not initialised yet', health.mode === 'single' && health.initialized === false);

  const post = (path, body, cookie) =>
    fetch(`${base()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });

  const password = 'smoke-Test-Password-77';
  const setup = await post('/api/setup', {
    tenantName: 'Smoke Test Group',
    branchCode: 'SMK01',
    branchName: 'Smoke Branch',
    isHeadOffice: true,
    admin: { username: 'smokeadmin', fullName: 'Smoke Admin', password },
  });
  check('first-run setup succeeds (argon2 native module works)', setup.status === 201, `HTTP ${setup.status}`);
  const again = await post('/api/setup', { tenantName: 'x' });
  check('setup cannot be run a second time', again.status === 409);

  const bad = await post('/api/auth/login', { username: 'smokeadmin', password: 'wrong-wrong-wrong' });
  check('wrong password is rejected', bad.status === 401);
  const login = await post('/api/auth/login', { username: 'smokeadmin', password });
  check('login succeeds', login.status === 200);
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  check('session cookie is HttpOnly', /HttpOnly/i.test((login.headers.getSetCookie?.() ?? []).join(';')));

  const anon = await fetch(`${base()}/api/sync/status`);
  check('guarded route refuses anonymous callers', anon.status === 401);
  const sync = await fetch(`${base()}/api/sync/status`, { headers: { Cookie: cookie } });
  const syncBody = await sync.json();
  check('guarded route works with a session and shows queued sync events', sync.status === 200 && syncBody.pending > 0, `pending=${syncBody.pending}`);
  const audit = await fetch(`${base()}/api/audit/verify`, { headers: { Cookie: cookie } });
  const auditBody = await audit.json();
  check('audit hash chain verifies', audit.status === 200 && auditBody.ok === true, `entries=${auditBody.count}`);

  const page = await fetch(`${base()}/`, { headers: { Cookie: cookie } });
  const html = await page.text();
  check('dashboard page renders for the signed-in user', page.status === 200 && html.includes('Mediescare') && html.includes('smokeadmin'));

  const dbFile = join(userData, 'data', 'mediescare.db');
  check('database file exists', existsSync(dbFile));
  const bytes = readFileSync(dbFile);
  check('database is encrypted (no SQLite header)', bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3');
  check('no readable data in the database file', !bytes.includes(Buffer.from('Smoke Test Group')));
} finally {
  // Ask the running app to quit cleanly (same path as closing the last window), then confirm the
  // app and its server child are gone. A forced kill is only the fallback so the test never leaks.
  spawn(exe, ['--quit'], { env, stdio: 'ignore' });
  const end = Date.now() + 20_000;
  while (!exited && Date.now() < end) await new Promise((r) => setTimeout(r, 200));
}

const quitCleanly = exited;
if (!quitCleanly) spawn('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
let serverStillUp;
try {
  const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
  serverStillUp = r.ok;
} catch {
  serverStillUp = false;
}
console.log(`${quitCleanly ? 'PASS' : 'FAIL'}  app quits cleanly on request (--quit)`);
console.log(`${serverStillUp ? 'FAIL' : 'PASS'}  server process stops when the app closes`);
try {
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch {
  console.log('note: could not delete the temporary data folder (still locked); it is in the OS temp folder');
}
if (!quitCleanly || serverStillUp) {
  process.exitCode = 1;
  console.log('\nSmoke test FAILED at shutdown.');
} else {
  console.log(`\nAll ${checks.length + 2} smoke checks passed.`);
}
