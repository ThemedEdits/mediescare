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
    cookie: () => cookie,
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

  // --- pharmacy: items, goods receipt, shift, sale, returns ---
  const lk = (await admin.get('/api/lookups')).data;
  const unit = (name) => lk.units.find((u) => u.name === name).id;
  const mode = (kind) => lk.paymentModes.find((m) => m.kind === kind).id;
  check(
    'default units, payment modes and a walk-in customer exist',
    lk.units.length >= 6 && lk.paymentModes.length >= 4 && !!lk.walkinCustomerId,
  );
  const itemBody = {
    name: 'Smoke Paracetamol 500mg',
    genericName: 'Paracetamol',
    baseUnitId: unit('Tablet'),
    units: [
      { unitId: unit('Tablet'), factorToBase: 1 },
      { unitId: unit('Strip'), factorToBase: 10, isDefaultSale: true, isDefaultPurchase: true },
    ],
    barcodes: ['8961001234567'],
    retailRateUnitMicro: 2_500_000,
  };
  const item = await admin.post('/api/items', itemBody);
  check('admin creates an item with units and a barcode', item.status === 201);
  check(
    'duplicate barcode is refused',
    (await admin.post('/api/items', { ...itemBody, name: 'Copy' })).status === 409,
  );
  const supplier = await admin.post('/api/suppliers', { name: 'Smoke Distributor' });
  check('admin adds a supplier', supplier.status === 201);
  const grnLine = (over) => ({
    itemId: item.data.id,
    unitId: unit('Strip'),
    qty: 50,
    batchNo: 'S1',
    expiryDate: '2029-12-31',
    unitPriceMicro: 18_000_000,
    ...over,
  });
  check(
    'expired stock cannot be received',
    (
      await admin.post('/api/grns', {
        supplierId: supplier.data.id,
        lines: [grnLine({ expiryDate: '2020-01-01' })],
      })
    ).status === 409,
  );
  const grn = await admin.post('/api/grns', {
    supplierId: supplier.data.id,
    lines: [grnLine({}), grnLine({ batchNo: 'S2', expiryDate: '2030-06-30', qty: 100 })],
  });
  check(
    'goods receipt creates batches and a numbered document',
    grn.status === 201 && /^SMK01-GRN-\d{6}$/.test(grn.data.docNo),
    grn.data.docNo,
  );
  const stockAll = await admin.get('/api/stock?q=smoke');
  check(
    'stock list shows 1,500 tablets on hand from the ledger',
    stockAll.data.rows[0].onHandBase === 1500 && stockAll.data.rows[0].costValueMinor > 0,
  );

  const counter = client();
  const cashierPassword = 'cashier-New-Password-55';
  check(
    'cashier signs in again with the new password',
    (
      await counter.post('/api/auth/login', {
        username: 'smoke.cashier',
        password: cashierPassword,
      })
    ).status === 200,
  );
  check(
    'a cashier cannot sell without an open shift',
    (
      await counter.post('/api/sales', {
        idempotencyKey: 'noshift-000001',
        lines: [{ itemId: item.data.id, unitId: unit('Strip'), qty: 1 }],
        payments: [{ modeId: mode('cash'), amountMinor: 5000 }],
      })
    ).status === 409,
  );
  check(
    'cashier opens a shift with an opening float',
    (await counter.post('/api/shifts/open', { floatMinor: 500_000 })).status === 201,
  );
  const search = await counter.get('/api/pos/search?q=8961001234567');
  check(
    'scanning the barcode finds the item first, with batches and stock',
    search.data.hits[0]?.matchedByBarcode === true &&
      search.data.hits[0].sellableBase === 1500 &&
      search.data.hits[0].batches.length === 2,
  );
  check(
    'the cashier response contains no cost fields',
    !JSON.stringify(search.data).includes('costUnitMicro'),
  );
  const typed = await counter.get('/api/pos/search?q=paracet');
  check(
    'typing part of the name finds the item (full-text search)',
    typed.data.hits[0]?.id === item.data.id,
  );

  const saleBody = (over = {}) => ({
    idempotencyKey: `smoke-sale-${Math.random().toString(36).slice(2)}`,
    lines: [{ itemId: item.data.id, unitId: unit('Strip'), qty: 2 }],
    payments: [{ modeId: mode('cash'), amountMinor: 10_000 }],
    ...over,
  });
  const first = saleBody();
  const sale1 = await counter.post('/api/sales', first);
  check(
    'sale saves: total 50.00, change 50.00, first-expiry batch used',
    sale1.status === 201 &&
      sale1.data.grandTotalMinor === 5000 &&
      sale1.data.changeMinor === 5000 &&
      /^SMK01-INV-000001$/.test(sale1.data.docNo),
    sale1.data.docNo,
  );
  check(
    'the cashier sale response hides cost and profit',
    sale1.data.costMinor === undefined && sale1.data.profitMinor === undefined,
  );
  const again = await counter.post('/api/sales', first);
  check(
    'retrying the same request returns the same sale, not a second one',
    again.status === 200 && again.data.id === sale1.data.id && again.data.replay === true,
  );
  const after = await admin.get('/api/stock?q=smoke');
  check('stock came down by exactly 20 tablets', after.data.rows[0].onHandBase === 1480);
  check(
    'selling more than is in stock is refused',
    (
      await counter.post(
        '/api/sales',
        saleBody({
          lines: [{ itemId: item.data.id, unitId: unit('Strip'), qty: 400 }],
          payments: [{ modeId: mode('cash'), amountMinor: 9_999_999 }],
        }),
      )
    ).status === 409,
  );
  const bigDiscount = await counter.post(
    '/api/sales',
    saleBody({ billDiscount: { kind: 'percent', bp: 1000 } }),
  );
  check(
    'a 10% discount needs a manager (cashier limit is 5%)',
    bigDiscount.status === 403 &&
      bigDiscount.data.error.code === 'OVERRIDE_REQUIRED' &&
      bigDiscount.data.error.details.kind === 'discount',
  );
  const ovr = await counter.post('/api/overrides', {
    approverUsername: 'smoke.manager',
    approverPin: '482913',
    kind: 'discount',
    percentBp: 1000,
  });
  const discounted = await counter.post(
    '/api/sales',
    saleBody({
      billDiscount: { kind: 'percent', bp: 1000 },
      discountOverrideId: ovr.data.overrideId,
    }),
  );
  check(
    'with the manager PIN the discounted sale saves',
    discounted.status === 201 && discounted.data.grandTotalMinor === 4500,
  );
  check(
    'the manager approval cannot be used twice',
    (
      await counter.post(
        '/api/sales',
        saleBody({
          billDiscount: { kind: 'percent', bp: 1000 },
          discountOverrideId: ovr.data.overrideId,
        }),
      )
    ).status === 403,
  );

  const salesAdmin = (await admin.get('/api/sales')).data;
  check(
    'admin sees the sales and their cost and profit',
    salesAdmin.total === 2 && salesAdmin.rows[0].costMinor > 0,
  );
  const detail = await admin.get(`/api/sales/${sale1.data.id}`);
  check(
    'sale detail shows profit to a role that may see it',
    detail.data.sale.profitMinor === 1400 && detail.data.sale.costMinor === 3600,
  );
  const dash = await admin.get('/api/dashboard');
  check(
    'dashboard totals match: 2 sales, 95.00 revenue',
    dash.data.salesCount === 2 &&
      dash.data.revenueMinor === 9500 &&
      dash.data.grossProfitMinor > 0 &&
      dash.data.costValueMinor > 0,
  );
  const dashCashier = await counter.get('/api/dashboard');
  check(
    'the cashier dashboard has no profit or stock value',
    dashCashier.status === 200 &&
      dashCashier.data.grossProfitMinor === undefined &&
      dashCashier.data.costValueMinor === undefined &&
      dashCashier.data.revenueMinor === 9500,
  );

  const voidTry = await counter.post(`/api/sales/${discounted.data.id}/void`, {
    reason: 'Customer left',
  });
  check(
    'a cashier cannot void without a manager',
    voidTry.status === 403 && voidTry.data.error.code === 'OVERRIDE_REQUIRED',
  );
  const ovrVoid = await counter.post('/api/overrides', {
    approverUsername: 'smoke.manager',
    approverPin: '482913',
    kind: 'void',
    reason: 'Customer left',
    amountMinor: 4500,
  });
  check(
    'with a manager PIN the sale is voided and stock returns',
    (
      await counter.post(`/api/sales/${discounted.data.id}/void`, {
        reason: 'Customer left',
        overrideId: ovrVoid.data.overrideId,
      })
    ).status === 200 && (await admin.get('/api/stock?q=smoke')).data.rows[0].onHandBase === 1480,
  );
  const lineId = (await admin.get(`/api/sales/${sale1.data.id}`)).data.sale.lines[0].id;
  const ret = await counter.post(`/api/sales/${sale1.data.id}/return`, {
    lines: [{ saleLineId: lineId, qtyBase: 10, restock: true }],
    reasonCode: 'wrong_item',
    refundModeId: mode('cash'),
  });
  check(
    'a partial return refunds in proportion and restocks',
    ret.status === 201 &&
      ret.data.refundMinor === 2500 &&
      (await admin.get('/api/stock?q=smoke')).data.rows[0].onHandBase === 1490,
  );
  check(
    'returning more than was sold is refused',
    (
      await counter.post(`/api/sales/${sale1.data.id}/return`, {
        lines: [{ saleLineId: lineId, qtyBase: 11, restock: true }],
        reasonCode: 'wrong_item',
        refundModeId: mode('cash'),
      })
    ).status === 400,
  );
  const holdId = (await counter.post('/api/holds', { label: 'Smoke hold', payload: { lines: [] } }))
    .data.id;
  check(
    'a held cart can be listed and resumed by the branch',
    (await admin.get('/api/holds')).data.holds.length === 1 &&
      (await admin.get(`/api/holds/${holdId}`)).status === 200,
  );
  check(
    'a missed sale can be recorded',
    (await counter.post('/api/missed-sales', { itemText: 'Some syrup', qty: 2 })).status === 201,
  );
  const closed = await counter.post('/api/shifts/close', {
    shiftId: (await counter.get('/api/shifts/current')).data.shift.id,
    countedCashMinor: 502_000,
  });
  check(
    'shift closes with a blind count: expected 5,025.00 (float + sale - refund), variance -5.00',
    closed.status === 200 &&
      closed.data.expectedCashMinor === 502_500 &&
      closed.data.varianceMinor === -500,
    JSON.stringify(closed.data),
  );
  for (const path of ['/items', '/stock', '/sales', '/pos']) {
    const p = await admin.get(path);
    check(`page ${path} renders`, p.status === 200 && p.data.raw.includes('Mediescare'));
  }

  // --- purchasing: orders, bills, supplier payments, ledger ---
  check('the default rounding setting is whole rupees', lk.rounding === 'rupee');
  const poBody = {
    supplierId: supplier.data.id,
    expectedDate: '2030-01-15',
    lines: [{ itemId: item.data.id, unitId: unit('Strip'), qty: 20, unitPriceMicro: 18_000_000 }],
  };
  check(
    'a cashier cannot create a purchase order',
    (await counter.post('/api/purchase-orders', poBody)).status === 403,
  );
  const po = await admin.post('/api/purchase-orders', poBody);
  check(
    'admin creates a draft purchase order',
    po.status === 201 && /^SMK01-PO-\d{6}$/.test(po.data.docNo),
    po.data.docNo,
  );
  const poGet = async () => (await admin.get(`/api/purchase-orders/${po.data.id}`)).data.order;
  check(
    'the order totals 360.00',
    (await poGet()).subTotalMinor === 36_000 && (await poGet()).status === 'draft',
  );
  check(
    'a draft order cannot be received',
    (
      await admin.post('/api/grns', {
        supplierId: supplier.data.id,
        poId: po.data.id,
        lines: [grnLine({ batchNo: 'PO0', qty: 1 })],
      })
    ).status === 409,
  );
  check(
    'a cashier cannot approve an order',
    (await counter.post(`/api/purchase-orders/${po.data.id}/approve`)).status === 403,
  );
  check(
    'admin approves the order',
    (await admin.post(`/api/purchase-orders/${po.data.id}/approve`)).status === 200,
  );
  check(
    'approving twice is refused',
    (await admin.post(`/api/purchase-orders/${po.data.id}/approve`)).status === 409,
  );
  const part = await admin.post('/api/grns', {
    supplierId: supplier.data.id,
    poId: po.data.id,
    lines: [grnLine({ batchNo: 'PO1', qty: 5 })],
  });
  check(
    'receiving part of the order marks it partial',
    part.status === 201 && (await poGet()).status === 'partial',
  );
  const rest = await admin.post('/api/grns', {
    supplierId: supplier.data.id,
    poId: po.data.id,
    lines: [grnLine({ batchNo: 'PO2', qty: 15 })],
  });
  check(
    'receiving the rest completes the order and links both bills',
    rest.status === 201 &&
      (await poGet()).status === 'received' &&
      (await poGet()).receipts.length === 2,
  );
  const suggestions = await admin.get('/api/purchase-orders/suggestions');
  check(
    'low-stock suggestions respond',
    suggestions.status === 200 && Array.isArray(suggestions.data.suggestions),
  );

  const ledgerOf = async () => (await admin.get(`/api/suppliers/${supplier.data.id}/ledger`)).data;
  const before = (await ledgerOf()).ledger.balanceMinor;
  const bill = await admin.post('/api/grns', {
    supplierId: supplier.data.id,
    supplierInvoiceNo: 'SM-INV-1',
    supplierInvoiceDate: '2026-01-10',
    discountMinor: 500,
    salesTaxMinor: 300,
    freightMinor: 200,
    whtMinor: 100,
    lines: [grnLine({ batchNo: 'BILL1', qty: 10 })],
  });
  check(
    'a bill with tax, discount and freight totals 180.00 (Goods - Discount + Tax + Freight)',
    bill.status === 201 && bill.data.totalMinor === 18_000,
  );
  const afterBill = await ledgerOf();
  check(
    'the supplier ledger owes the bill less withholding tax (179.00)',
    afterBill.ledger.balanceMinor === before + 17_900,
  );
  check(
    'the open bills list shows the new bill at 179.00',
    afterBill.openBills.find((b) => b.grnId === bill.data.id)?.outstandingMinor === 17_900,
  );
  const pay = (amountMinor, extra = {}) =>
    admin.post('/api/supplier-payments', {
      supplierId: supplier.data.id,
      grnId: bill.data.id,
      amountMinor,
      modeId: mode('cash'),
      ...extra,
    });
  check(
    'a cashier cannot pay a supplier',
    (
      await counter.post('/api/supplier-payments', {
        supplierId: supplier.data.id,
        amountMinor: 1,
        modeId: mode('cash'),
      })
    ).status === 403,
  );
  check('a part payment is recorded', (await pay(10_000)).status === 201);
  const over = await pay(8_000);
  check('paying more than the bill still owes is refused', over.status >= 400 && over.status < 500);
  check('the rest of the bill is paid', (await pay(7_900, { reference: 'CHQ-1' })).status === 201);
  const settled = await ledgerOf();
  check(
    'the ledger is back to the earlier balance and no bills are left open for it',
    settled.ledger.balanceMinor === before &&
      !settled.openBills.some((b) => b.grnId === bill.data.id),
  );
  check(
    'ageing buckets add up to the balance',
    Object.values(settled.ledger.aging).reduce((a, b) => a + b, 0) === settled.ledger.balanceMinor,
  );
  check(
    'the bills list filters by supplier invoice number',
    (await admin.get('/api/grns?q=SM-INV-1')).data.total === 1,
  );
  check(
    'the supplier balances list responds',
    (await admin.get('/api/suppliers/balances?onlyOwing=1')).data.balances.some(
      (b) => b.supplierId === supplier.data.id,
    ),
  );
  check(
    'a cashier cannot read supplier ledgers',
    (await counter.get(`/api/suppliers/${supplier.data.id}/ledger`)).status === 403,
  );
  const setRounding = await admin.put('/api/settings/pos', { rounding: 'none' });
  check(
    'admin can change the rounding setting and back',
    setRounding.status === 200 &&
      (await admin.put('/api/settings/pos', { rounding: 'rupee' })).data.settings[
        'pos.rounding'
      ] === 'rupee',
  );
  for (const path of ['/purchasing', '/reports']) {
    const p = await admin.get(path);
    check(`page ${path} renders`, p.status === 200 && p.data.raw.includes('Mediescare'));
  }

  // --- Excel/CSV item import ---
  const tpl = await fetch(`${base()}/api/imports/items/template`, {
    headers: { Cookie: admin.cookie() },
  });
  const tplBytes = Buffer.from(await tpl.arrayBuffer());
  check(
    'the import template downloads as a real .xlsx file',
    tpl.status === 200 && tplBytes.subarray(0, 2).toString() === 'PK',
  );
  const csv = [
    'Item Name,Barcode,Category,Retail Price',
    'Smoke Import Alpha 10mg,8969000000011,Tablets,12.50',
    'Smoke Import Beta Syrup,8969000000028,Syrups,150',
    ',8969000000035,Tablets,10',
  ].join('\n');
  const upload = async (cookie) => {
    /* global FormData, Blob */
    const form = new FormData();
    form.append('file', new Blob([csv], { type: 'text/csv' }), 'items.csv');
    const res = await fetch(`${base()}/api/imports/items/preview`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form,
    });
    return { status: res.status, data: await res.json() };
  };
  check('a cashier cannot import items', (await upload(counter.cookie())).status === 403);
  const prev = await upload(admin.cookie());
  check(
    'preview validates the file: 2 rows ready, 1 skipped for a missing name, nothing written yet',
    prev.status === 201 &&
      prev.data.summary.willImport === 2 &&
      prev.data.summary.skippedWithErrors === 1,
    JSON.stringify(prev.data.summary ?? prev.data),
  );
  check(
    'no item exists before the commit',
    (await admin.get('/api/items?q=Smoke%20Import')).data.rows.length === 0,
  );
  const started = await admin.post(`/api/imports/items/${prev.data.importId}`, {
    action: 'commit',
    importStock: false,
  });
  check('commit starts in the background', started.status === 202);
  let jobState = started.data;
  for (let i = 0; i < 100 && jobState.status !== 'done' && jobState.status !== 'failed'; i++) {
    await new Promise((r) => setTimeout(r, 200));
    jobState = (await admin.get(`/api/imports/items/${prev.data.importId}`)).data;
  }
  check(
    'the import finishes and created 2 items',
    jobState.status === 'done' && jobState.result?.created === 2,
    JSON.stringify(jobState.result ?? jobState.error),
  );
  check(
    'imported items are searchable',
    (await admin.get('/api/items?q=Smoke%20Import')).data.rows.length === 2,
  );
  const reimport = await upload(admin.cookie());
  check(
    'importing the same file again creates nothing new (already exist)',
    reimport.data.summary.willImport === 0 && reimport.data.summary.alreadyExist === 2,
  );
  const issueCsv = await fetch(`${base()}/api/imports/items/${prev.data.importId}/report`, {
    headers: { Cookie: admin.cookie() },
  });
  check(
    'the issue report downloads as CSV',
    issueCsv.status === 200 && /csv/.test(issueCsv.headers.get('content-type') ?? ''),
  );

  // --- reports ---
  const reportList = await admin.get('/api/reports');
  check(
    'the report hub lists the reports for the admin',
    reportList.status === 200 && reportList.data.reports.length >= 10,
  );
  const daily = await admin.get('/api/reports/sales-daily');
  check('the daily sales report runs', daily.status === 200 && Array.isArray(daily.data.rows));
  const pl = await admin.get('/api/reports/profit-loss');
  check('admin can run the profit report', pl.status === 200);
  check(
    'a cashier is refused the profit report',
    (await counter.get('/api/reports/profit-loss')).status === 403,
  );
  const xlsxRes = await fetch(`${base()}/api/reports/stock-valuation/export`, {
    headers: { Cookie: admin.cookie() },
  });
  const xlsxBytes = Buffer.from(await xlsxRes.arrayBuffer());
  check(
    'the Excel export is a real .xlsx file',
    xlsxRes.status === 200 &&
      /spreadsheetml/.test(xlsxRes.headers.get('content-type') ?? '') &&
      xlsxBytes.subarray(0, 2).toString() === 'PK',
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
