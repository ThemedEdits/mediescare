// Manual check of the LAN terminal pairing wizard on ONE PC (not part of the gate).
//
//   pnpm --filter @mediescare/desktop build   (once, so dist/ is current)
//   node apps/desktop/scripts/manual-lan-check.mjs
//
// It starts a Branch Server (temp data folder, free port) and a fresh Terminal (second temp folder),
// drives the terminal's real wizard window (discovery, address check, pairing code), and checks that
// the terminal window then shows the server's login page. It also checks the offline page. It only
// closes the Electron apps it started itself. Real second-PC and firewall behaviour cannot be
// verified this way.
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from '@playwright/test';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const electronExe = require('electron');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const freePort = () =>
  new Promise((resolve) => {
    const s = createServer().listen(0, '0.0.0.0', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function launch(userData, extraEnv = {}) {
  const env = { ...process.env, MEDIESCARE_USER_DATA: userData, ...extraEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return electron.launch({ executablePath: electronExe, args: [root], env });
}

async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out: ${label}`);
}

async function cookieClient(base) {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  return { get: (p) => call('GET', p), post: (p, b = {}) => call('POST', p, b) };
}

const apps = [];
try {
  // ---- Branch Server ----
  const serverData = mkdtempSync(join(tmpdir(), 'mediescare-lan-server-'));
  const serverPort = await freePort();
  writeFileSync(
    join(serverData, 'config.json'),
    JSON.stringify({ mode: 'branch-server', port: serverPort }),
  );
  const serverApp = await launch(serverData);
  apps.push(serverApp);
  const base = `http://127.0.0.1:${serverPort}`;
  const health = await waitFor(
    async () => (await fetch(`${base}/api/health`)).json(),
    90_000,
    'server health',
  );
  check('branch server starts', health.mode === 'branch-server', `port ${serverPort}`);

  const admin = await cookieClient(base);
  const setup = await admin.post('/api/setup', {
    tenantName: 'LAN Check Group',
    branchCode: 'LAN01',
    branchName: 'LAN Check Branch',
    isHeadOffice: true,
    admin: { username: 'lanadmin', fullName: 'Lan Admin', password: 'lan-Check-Password-77' },
  });
  check('server first-run setup', setup.status === 201, `HTTP ${setup.status}`);
  const login = await admin.post('/api/auth/login', {
    username: 'lanadmin',
    password: 'lan-Check-Password-77',
  });
  check('admin signs in on the server', login.status === 200, `HTTP ${login.status}`);

  // ---- Terminal: real wizard ----
  const termData = mkdtempSync(join(tmpdir(), 'mediescare-lan-terminal-'));
  const termApp = await launch(termData);
  apps.push(termApp);
  const wizard = await termApp.firstWindow();
  await wizard.waitForLoadState('domcontentloaded');
  await wizard.locator('input[value=terminal]').check();
  await wizard.locator('#mode-go').click();

  // The announcer starts once /api/sync/announce answers (right after setup), so allow a few searches.
  let discovered = false;
  for (let i = 0; i < 4 && !discovered; i++) {
    await wizard
      .locator('#found-status')
      .filter({ hasText: /Choose your Branch Server|No Branch Server/ })
      .waitFor({ timeout: 10_000 });
    discovered = (await wizard.locator('#found-list .server').count()) > 0;
    if (!discovered) await wizard.locator('#search-again').click();
  }
  check(
    'UDP discovery lists the branch server in the wizard',
    discovered,
    discovered ? '' : 'none heard (UDP broadcast may be blocked on this PC)',
  );
  if (discovered) {
    const text = await wizard.locator('#found-list .server').first().innerText();
    check(
      'discovered entry shows name, branch code and address',
      /LAN01/.test(text) && /:\d+/.test(text),
      text.replace(/\s+/g, ' '),
    );
  }

  // Manual address path: invalid then valid.
  await wizard.locator('#address').fill('http://user:pw@127.0.0.1');
  await wizard.locator('#use-address').click();
  await wizard
    .locator('#find-error')
    .filter({ hasText: /address/i })
    .waitFor({ timeout: 5000 });
  check('an invalid address is refused with a message', true);
  await wizard.locator('#address').fill(`127.0.0.1:${await freePort()}`);
  await wizard.locator('#use-address').click();
  await wizard.locator('#find-hint .box code').first().waitFor({ timeout: 10_000 });
  check('an unreachable address shows the firewall commands', true);
  await wizard.locator('#address').fill(`127.0.0.1:${serverPort}`);
  await wizard.locator('#use-address').click();
  await wizard.locator('#step-code').waitFor({ state: 'visible', timeout: 10_000 });
  check('a reachable branch server address is accepted', true);

  // Wrong code, then the real code created on the server.
  await wizard.locator('#code').fill('00000000');
  await wizard.locator('#pair-go').click();
  await wizard
    .locator('#code-error')
    .filter({ hasText: /wrong or has expired/ })
    .waitFor({ timeout: 10_000 });
  check('a wrong code shows a friendly error', true);
  const created = await admin.post('/api/sync/pairing-code');
  check(
    'admin creates a pairing code on the server',
    created.status === 201 && /^\d{4}-\d{4}$/.test(created.data.code),
  );
  await wizard.locator('#code').fill(created.data.code);
  await wizard.locator('#device-name').fill('Counter 2');
  const windowOpened = termApp.waitForEvent('window', { timeout: 30_000 }).catch(() => null);
  await wizard.locator('#pair-go').click();
  const main = await windowOpened;
  check('terminal opens a main window after pairing', !!main);
  if (main) {
    await main.waitForURL(new RegExp(`127\\.0\\.0\\.1:${serverPort}`), { timeout: 30_000 });
    await main.waitForLoadState('domcontentloaded');
    await waitFor(
      async () => (await main.locator('input').count()) > 0,
      30_000,
      'login page inputs',
    );
    check('terminal window shows the server login page', true, main.url());
  }
  const cfg = JSON.parse(readFileSync(join(termData, 'config.json'), 'utf8'));
  check(
    'terminal config saved',
    cfg.mode === 'terminal' && cfg.serverUrl === `http://127.0.0.1:${serverPort}`,
  );
  const tokenFile = join(termData, 'terminal-token.json');
  const tokenRaw = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8') : '';
  check(
    'device token stored sealed (not readable in the file)',
    tokenRaw.includes('"v":1') && !/[0-9a-f]{8}-[0-9a-f-]{20,}\.[A-Za-z0-9_-]{20,}/.test(tokenRaw),
  );
  check(
    'no temp files left in the terminal data folder',
    !readdirSync(termData).some((f) => f.endsWith('.tmp')),
  );
  const reuse = await (
    await fetch(`${base}/api/sync/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: created.data.code, deviceName: 'Counter 3' }),
    })
  ).status;
  check('the used code cannot be used again', reuse === 403, `HTTP ${reuse}`);
  await termApp.close();

  // ---- Terminal offline page ----
  const offData = mkdtempSync(join(tmpdir(), 'mediescare-lan-offline-'));
  const deadPort = await freePort();
  writeFileSync(
    join(offData, 'config.json'),
    JSON.stringify({ mode: 'terminal', serverUrl: `http://127.0.0.1:${deadPort}`, port: 3210 }),
  );
  const offApp = await launch(offData);
  apps.push(offApp);
  const off = await offApp.firstWindow();
  await off.waitForLoadState('domcontentloaded');
  await off.locator('#retry').waitFor({ timeout: 30_000 });
  check(
    'unreachable server shows the offline page with Retry, Re-pair and Change server',
    (await off.locator('#repair').count()) === 1 && (await off.locator('#change').count()) === 1,
  );
  await off.locator('#retry').click();
  await off
    .locator('#status')
    .filter({ hasText: /Still not reachable/ })
    .waitFor({ timeout: 15_000 });
  check('Retry reports the server is still not reachable', true);
  await off.locator('#change').click();
  const offWizard = await waitFor(
    async () => offApp.windows().find((w) => w.url().includes('wizard.html')),
    15_000,
    'wizard after Change server',
  );
  check('Change server opens the terminal wizard', !!offWizard);
  await offApp.close();
} catch (error) {
  check(`unexpected error: ${error instanceof Error ? error.message : error}`, false);
} finally {
  for (const a of apps) await a.close().catch(() => undefined);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
