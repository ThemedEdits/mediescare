// Packaged-app smoke test (CLAUDE.md §9: test the installer output, not only `dev`).
// Launches release/win-unpacked/Mediescare.exe with a throwaway data folder, then exercises:
//   health -> first-run setup + recovery key -> login -> RBAC guards -> users, temporary password,
//   quick PIN limits, manager override -> backups (create, verify, export, rotate key) ->
//   encrypted DB on disk -> clean shutdown -> packaged restore tool (right key, wrong key).
// Usage: pnpm --filter @mediescare/desktop package:dir && pnpm --filter @mediescare/desktop smoke
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const exe = process.env.MEDIESCARE_EXE ?? join(root, 'release', 'win-unpacked', 'Mediescare.exe');
if (!existsSync(exe))
  throw new Error(
    `Packaged app not found: ${exe}. Run "pnpm --filter @mediescare/desktop package:dir" first.`,
  );

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

/** Minimal client with its own cookie jar, so several users can be signed in at once. */
function client() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(`${base()}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.getSetCookie?.() ?? [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
    return { status: res.status, data, setCookie: set.join(';') };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b = {}) => call('POST', p, b),
    put: (p, b) => call('PUT', p, b),
  };
}

let recoveryKey;
let backupPath;
try {
  const health = await waitHealthy(60_000);
  check(
    'server starts and answers /api/health',
    !!health && health.status === 'ok',
    `${((Date.now() - startedAt) / 1000).toFixed(1)}s cold start`,
  );
  check(
    'mode is single and DB is not initialised yet',
    health.mode === 'single' && health.initialized === false,
  );

  const admin = client();
  const password = 'smoke-Test-Password-77';
  const setup = await admin.post('/api/setup', {
    tenantName: 'Smoke Test Group',
    branchCode: 'SMK01',
    branchName: 'Smoke Branch',
    isHeadOffice: true,
    admin: { username: 'smokeadmin', fullName: 'Smoke Admin', password },
  });
  check(
    'first-run setup succeeds (argon2 native module works)',
    setup.status === 201,
    `HTTP ${setup.status}`,
  );
  recoveryKey = setup.data.recoveryKey;
  check('setup returns a recovery key once', /^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/.test(recoveryKey));
  check(
    'setup cannot be run a second time',
    (await admin.post('/api/setup', { tenantName: 'x' })).status === 409,
  );
  const keyring = readFileSync(join(userData, 'data', 'keyring.json'), 'utf8');
  check(
    'keyring holds only the wrapped key, never the recovery key',
    !keyring.includes(recoveryKey.replace(/-/g, '')),
  );

  check(
    'wrong password is rejected',
    (
      await client().post('/api/auth/login', {
        username: 'smokeadmin',
        password: 'wrong-wrong-wrong',
      })
    ).status === 401,
  );
  const login = await admin.post('/api/auth/login', { username: 'smokeadmin', password });
  check(
    'login succeeds with an HttpOnly cookie',
    login.status === 200 && /HttpOnly/i.test(login.setCookie),
  );
  check(
    'guarded route refuses anonymous callers',
    (await client().get('/api/sync/status')).status === 401,
  );
  const sync = await admin.get('/api/sync/status');
  check(
    'guarded route works with a session and shows queued sync events',
    sync.status === 200 && sync.data.pending > 0,
    `pending=${sync.data.pending}`,
  );
  const audit = await admin.get('/api/audit/verify');
  check(
    'audit hash chain verifies',
    audit.status === 200 && audit.data.ok === true,
    `entries=${audit.data.count}`,
  );
  const page = await admin.get('/');
  check(
    'dashboard page renders for the signed-in user',
    page.status === 200 &&
      page.data.raw.includes('Mediescare') &&
      page.data.raw.includes('smokeadmin'),
  );
  for (const path of ['/users', '/roles', '/backups']) {
    const p = await admin.get(path);
    check(
      `page ${path} renders for a Super Admin`,
      p.status === 200 && p.data.raw.includes('Mediescare'),
    );
  }

  // --- users, roles, temporary password ---
  const { roles } = (await admin.get('/api/roles')).data;
  const roleId = (code) => roles.find((r) => r.code === code).id;
  const { branches } = (await admin.get('/api/branches')).data;
  check('12 built-in roles are present', roles.filter((r) => r.isSystem).length === 12);

  const newCashier = await admin.post('/api/users', {
    username: 'smoke.cashier',
    fullName: 'Smoke Cashier',
    roleIds: [roleId('cashier')],
    branchIds: [branches[0].id],
  });
  check(
    'admin creates a cashier and gets a temporary password once',
    newCashier.status === 201 && newCashier.data.temporaryPassword?.length === 14,
  );
  const newManager = await admin.post('/api/users', {
    username: 'smoke.manager',
    fullName: 'Smoke Manager',
    roleIds: [roleId('branch_manager')],
    branchIds: [branches[0].id],
    password: 'manager-Password-2026',
  });
  check('admin creates a branch manager', newManager.status === 201);
  check(
    'duplicate username is refused',
    (
      await admin.post('/api/users', {
        username: 'smoke.cashier',
        fullName: 'Dup Person',
        roleIds: [roleId('cashier')],
        branchIds: [branches[0].id],
      })
    ).status === 409,
  );

  const cashier = client();
  check(
    'cashier signs in with the temporary password',
    (
      await cashier.post('/api/auth/login', {
        username: 'smoke.cashier',
        password: newCashier.data.temporaryPassword,
      })
    ).status === 200,
  );
  check(
    'a pending temporary password blocks everything except changing it',
    (await cashier.get('/api/users')).status === 428,
  );
  check(
    'cashier changes the temporary password',
    (
      await cashier.post('/api/auth/change-password', {
        currentPassword: newCashier.data.temporaryPassword,
        newPassword: 'cashier-New-Password-55',
      })
    ).status === 200,
  );
  check(
    'cashier still cannot list users (no permission)',
    (await cashier.get('/api/users')).status === 403,
  );
  check(
    'cashier cannot read the audit chain or backups',
    (await cashier.get('/api/audit/verify')).status === 403 &&
      (await cashier.get('/api/backups')).status === 403,
  );
  check(
    'cashier cannot create users or roles',
    (await cashier.post('/api/users', {})).status === 403 &&
      (await cashier.post('/api/roles', {})).status === 403,
  );

  const manager = client();
  await manager.post('/api/auth/login', {
    username: 'smoke.manager',
    password: 'manager-Password-2026',
  });
  await manager.post('/api/auth/change-password', {
    currentPassword: 'manager-Password-2026',
    newPassword: 'manager-New-Password-66',
  });
  const escalate = await manager.post('/api/users', {
    username: 'evil.admin',
    fullName: 'Evil Admin',
    roleIds: [roleId('super_admin')],
    branchIds: [branches[0].id],
    password: 'evil-Password-2026',
  });
  check(
    'a branch manager cannot create a Super Admin',
    escalate.status === 403 && escalate.data.error.code === 'PRIVILEGE_ESCALATION',
  );

  const managerId = (await admin.get('/api/users?q=smoke.manager')).data.users[0].id;
  const cashierId = (await admin.get('/api/users?q=smoke.cashier')).data.users[0].id;

  // --- quick PIN ---
  check(
    'weak PIN is refused',
    (await admin.post(`/api/users/${managerId}/pin`, { pin: '1234' })).status === 400,
  );
  check(
    'admin sets a manager PIN',
    (await admin.post(`/api/users/${managerId}/pin`, { pin: '482913' })).status === 200,
  );
  check(
    'admin sets a cashier PIN',
    (await admin.post(`/api/users/${cashierId}/pin`, { pin: '135791' })).status === 200,
  );
  const pinManager = client();
  check(
    'manager signs in with quick PIN',
    (await pinManager.post('/api/auth/pin-login', { username: 'smoke.manager', pin: '482913' }))
      .status === 200,
  );
  const limited = await pinManager.get('/api/users');
  check(
    'a PIN session cannot open administration APIs',
    limited.status === 403 && limited.data.error.code === 'PIN_SESSION_LIMITED',
  );
  check(
    'wrong PIN is refused',
    (await client().post('/api/auth/pin-login', { username: 'smoke.cashier', pin: '999111' }))
      .status === 401,
  );

  // --- manager override ---
  const pinCashier = client();
  await pinCashier.post('/api/auth/pin-login', { username: 'smoke.cashier', pin: '135791' });
  const askBase = {
    approverUsername: 'smoke.manager',
    kind: 'discount',
    percentBp: 2000,
    reference: 'HOLD-1',
  };
  check(
    'override with a wrong manager PIN is refused',
    (await pinCashier.post('/api/overrides', { ...askBase, approverPin: '999111' })).status === 401,
  );
  const approved = await pinCashier.post('/api/overrides', { ...askBase, approverPin: '482913' });
  check(
    'manager PIN approves a 20% discount for the cashier',
    approved.status === 201 && !!approved.data.overrideId,
  );
  check(
    'a discount above the manager limit is refused',
    (
      await pinCashier.post('/api/overrides', {
        ...askBase,
        percentBp: 3000,
        approverPin: '482913',
      })
    ).status === 403,
  );
  check(
    'cashier cannot approve their own request',
    (
      await pinCashier.post('/api/overrides', {
        ...askBase,
        approverUsername: 'smoke.cashier',
        approverPin: '135791',
      })
    ).status === 401,
  );

  // --- backups ---
  const created = await admin.post('/api/backups');
  check(
    'backup is created and verified',
    created.status === 201 && created.data.sha256?.length === 64,
  );
  const listing = (await admin.get('/api/backups')).data;
  check(
    'backup appears in the list and recovery key is configured',
    listing.backups.length >= 1 && listing.recoveryKeyConfigured === true,
  );
  const backupFile = readdirSync(listing.folder).find((f) => f.endsWith('-manual.mcbak'));
  backupPath = join(listing.folder, backupFile);
  const backupBytes = readFileSync(backupPath);
  check(
    'backup file is encrypted on disk',
    backupBytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3' &&
      !backupBytes.includes(Buffer.from('Smoke Test Group')),
  );
  check(
    'backup verifies again',
    (await admin.post('/api/backups/verify', { id: listing.backups[0].id })).data.ok === true,
  );
  const usb = join(userData, 'usb-drive');
  const exported = await admin.post('/api/backups/export', {
    id: listing.backups[0].id,
    destination: usb,
  });
  check(
    'backup copies to another drive and the copy verifies',
    exported.status === 200 && existsSync(join(usb, backupFile)),
  );
  check('cashier cannot create backups', (await cashier.post('/api/backups')).status === 403);
  check(
    'recovery key change needs the password',
    (await admin.post('/api/recovery/rotate', { password: 'wrong-wrong-wrong' })).status === 401,
  );

  // --- disabling a user signs them out ---
  check(
    'admin disables the cashier',
    (await admin.post(`/api/users/${cashierId}/status`, { active: false })).status === 200,
  );
  check('a disabled user is signed out at once', (await cashier.get('/api/me')).status === 401);
  const myId = (await admin.get('/api/me')).data.user.id;
  check(
    'admin cannot disable their own account',
    (await admin.post(`/api/users/${myId}/status`, { active: false })).status === 409,
  );

  const bytes = readFileSync(join(userData, 'data', 'mediescare.db'));
  check(
    'database is encrypted (no SQLite header, no readable data)',
    bytes.subarray(0, 15).toString('latin1') !== 'SQLite format 3' &&
      !bytes.includes(Buffer.from('Smoke Test Group')),
  );
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
  const r = await fetch(`${base()}/api/health`, { signal: AbortSignal.timeout(1500) });
  serverStillUp = r.ok;
} catch {
  serverStillUp = false;
}
console.log(`${quitCleanly ? 'PASS' : 'FAIL'}  app quits cleanly on request (--quit)`);
console.log(`${serverStillUp ? 'FAIL' : 'PASS'}  server process stops when the app closes`);
let failed = !quitCleanly || serverStillUp;

// --- packaged restore tool: runs on the app's own Node next to the shipped native modules ---
if (!failed) {
  const cli = join(dirname(exe), 'resources', 'web', 'restore-cli.cjs');
  const runRestore = (extra) =>
    spawnSync(exe, [cli], {
      cwd: join(dirname(exe), 'resources', 'web'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      input: JSON.stringify({
        backupPath,
        targetDbFile: join(userData, 'new-pc', 'mediescare.db'),
        safetyDir: join(userData, 'new-pc', 'safety'),
        dataDir: join(userData, 'new-pc'),
        ...extra,
      }),
      encoding: 'utf8',
      timeout: 60_000,
    });
  const wrong = JSON.parse(
    runRestore({ recoveryKey: 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345-6789' }).stdout || '{}',
  );
  const good = JSON.parse(runRestore({ recoveryKey }).stdout || '{}');
  const restoredOk =
    good.ok === true &&
    /^[0-9a-f]{64}$/.test(good.dbKeyHex ?? '') &&
    existsSync(join(userData, 'new-pc', 'mediescare.db')) &&
    existsSync(join(userData, 'new-pc', 'keyring.json'));
  console.log(`${wrong.ok === false ? 'PASS' : 'FAIL'}  restore refuses a wrong recovery key`);
  console.log(
    `${restoredOk ? 'PASS' : 'FAIL'}  packaged restore tool restores a backup on a "new PC" with only the recovery key`,
  );
  failed = wrong.ok !== false || !restoredOk;
}

try {
  rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
} catch {
  console.log(
    'note: could not delete the temporary data folder (still locked); it is in the OS temp folder',
  );
}
if (failed) {
  process.exitCode = 1;
  console.log('\nSmoke test FAILED at shutdown or restore.');
} else {
  console.log(`\nAll ${checks.length + 4} smoke checks passed.`);
}
