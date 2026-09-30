/**
 * Performance benchmark on a large generated catalogue (CLAUDE.md §9 budgets):
 *   POS item search < 100 ms on 100k+ SKUs, invoice save < 300 ms.
 * All data is generated and fake. Usage: pnpm --filter @mediescare/db bench [itemCount]
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import { HybridLogicalClock, newId } from '@mediescare/sync';
import { hashPassword } from '../auth/password';
import { openDatabase } from '../client';
import { runFirstRunSetup } from '../firstRun';
import { hlcDeviceId } from '../identity';
import { runMigrations } from '../migrate';
import { searchItems } from '../pharmacy/catalog';
import { createSale, getOpenShift, openShift } from '../pharmacy/pos';
import { listStock } from '../pharmacy/stock';
import { schema } from '../index';

const COUNT = Number(process.argv[2] ?? 100_000);
const SCALE = Number(process.argv[3] ?? 1);
const WORDS = [
  'Para',
  'Amox',
  'Cipro',
  'Ibu',
  'Metro',
  'Omepra',
  'Pantop',
  'Azithro',
  'Cefix',
  'Diclo',
  'Napro',
  'Losar',
  'Atenol',
  'Metfor',
  'Gliben',
  'Salbut',
  'Cetiri',
  'Levoc',
  'Ranit',
  'Domper',
];
const SUFFIX = [
  'cetamol',
  'icillin',
  'floxacin',
  'profen',
  'nidazole',
  'zole',
  'mycin',
  'xime',
  'fenac',
  'xen',
  'tan',
  'olol',
  'min',
  'amide',
  'butamol',
  'zine',
  'tidine',
  'idone',
];
const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Drops'];

const dir = mkdtempSync(join(tmpdir(), 'mediescare-bench-'));
const handle = openDatabase({
  file: join(dir, 'bench.db'),
  keyHex: randomBytes(32).toString('hex'),
});
const db = handle.db;
runMigrations(db);

const clockMs = Date.now();
const setup = runFirstRunSetup(db, {
  tenantName: 'Bench Group',
  branchCode: 'BNCH01',
  branchName: 'Bench Branch',
  isHeadOffice: true,
  deviceName: 'Bench',
  admin: {
    username: 'admin',
    fullName: 'Bench Admin',
    passwordHash: await hashPassword('bench-Password-2026'),
  },
});
const ctx = {
  tenantId: setup.tenantId,
  branchId: setup.branchId,
  deviceId: setup.deviceId,
  userId: setup.adminUserId,
  clock: new HybridLogicalClock(hlcDeviceId(setup.deviceId)),
};

const tablet = db
  .select()
  .from(schema.units)
  .all()
  .find((u) => u.code === 'tablet')!.id;
const strip = db
  .select()
  .from(schema.units)
  .all()
  .find((u) => u.code === 'strip')!.id;
const store = db.select().from(schema.stores).all()[0]!.id;
const cash = db
  .select()
  .from(schema.paymentModes)
  .all()
  .find((m) => m.kind === 'cash')!.id;
const now = new Date().toISOString();

console.log(`Seeding ${COUNT.toLocaleString()} items (generated)…`);
const t0 = performance.now();
const raw = handle.raw;
const insItem = raw.prepare(
  `INSERT INTO items (id, tenant_id, sku, name, generic_name, strength, dosage_form, base_unit_id, retail_rate_unit_micro, tax_bp, created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,?,?,?,0,?,?,?,1)`,
);
const insUnit = raw.prepare(
  `INSERT INTO item_units (id, item_id, unit_id, factor_to_base, is_default_sale, is_default_purchase, created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,?,?,?,1)`,
);
const insBarcode = raw.prepare(
  `INSERT INTO item_barcodes (id, tenant_id, item_id, barcode, created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,?,1)`,
);
const insBatch = raw.prepare(
  `INSERT INTO batches (id, tenant_id, branch_id, item_id, batch_no, expiry_date, cost_unit_micro, mrp_unit_micro, created_at, updated_at, hlc, version) VALUES (?,?,?,?,?,?,?,0,?,?,?,1)`,
);
const insMove = raw.prepare(
  `INSERT INTO stock_movements (id, tenant_id, branch_id, store_id, item_id, batch_id, kind, qty_base, unit_cost_micro, doc_type, doc_id, occurred_at, hlc, created_at) VALUES (?,?,?,?,?,?, 'opening', ?, ?, 'opening', 'bench', ?, ?, ?)`,
);
const insFts = raw.prepare(
  `INSERT INTO items_fts (item_id, name, generic_name, barcodes, sku) VALUES (?,?,?,?,?)`,
);
const hlc = ctx.clock.tick();
const sampleIds: string[] = [];
const sampleBarcodes: string[] = [];
const sampleNames: string[] = [];

raw.transaction(() => {
  for (let i = 0; i < COUNT; i++) {
    const id = newId();
    const generic = `${WORDS[i % WORDS.length]}${SUFFIX[(i * 7) % SUFFIX.length]}`;
    const name = `${generic} ${100 + (i % 900)}mg ${FORMS[i % FORMS.length]} ${i}`;
    const sku = String(10_001 + i);
    const barcode = `89610${String(i).padStart(8, '0')}`;
    insItem.run(
      id,
      ctx.tenantId,
      sku,
      name,
      generic,
      `${100 + (i % 900)}mg`,
      FORMS[i % FORMS.length],
      tablet,
      2_500_000,
      now,
      now,
      hlc,
    );
    insUnit.run(newId(), id, tablet, 1, 0, 0, now, now, hlc);
    insUnit.run(newId(), id, strip, 10, 1, 1, now, now, hlc);
    insBarcode.run(newId(), ctx.tenantId, id, barcode, now, now, hlc);
    const batch = newId();
    insBatch.run(
      batch,
      ctx.tenantId,
      ctx.branchId,
      id,
      `B${i % 97}`,
      '2029-12-31',
      1_800_000,
      now,
      now,
      hlc,
    );
    insMove.run(
      newId(),
      ctx.tenantId,
      ctx.branchId,
      store,
      id,
      batch,
      1_000,
      1_800_000,
      now,
      hlc,
      now,
    );
    insFts.run(id, name, generic, barcode, sku);
    if (i % Math.max(1, Math.floor(COUNT / 200)) === 0) {
      sampleIds.push(id);
      sampleBarcodes.push(barcode);
      sampleNames.push(name);
    }
  }
})();
raw.exec('ANALYZE'); // statistics let the planner pick primary-key lookups over wide index scans
console.log(`  seeded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

function timeMany(
  label: string,
  runsWanted: number,
  fn: (i: number) => void,
  budgetMs: number,
): boolean {
  const runs = Math.max(3, Math.floor(runsWanted * SCALE));
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    fn(i);
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  const p = (q: number) =>
    times[Math.min(times.length - 1, Math.floor(times.length * q))] as number;
  const ok = p(0.95) < budgetMs;
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label}: median ${p(0.5).toFixed(1)} ms, p95 ${p(0.95).toFixed(1)} ms, max ${p(1).toFixed(1)} ms  (budget ${budgetMs} ms, ${runs} runs)`,
  );
  return ok;
}

const results: boolean[] = [];
// Typing: first 3-5 letters of a real name, as a person would.
results.push(
  timeMany(
    'POS search, typed prefix (3-5 letters)',
    300,
    (i) =>
      searchItems(db, ctx, (sampleNames[i % sampleNames.length] as string).slice(0, 3 + (i % 3))),
    100,
  ),
);
results.push(
  timeMany(
    'POS search, two words',
    200,
    (i) => {
      const n = (sampleNames[i % sampleNames.length] as string).split(' ');
      searchItems(db, ctx, `${n[0]?.slice(0, 4)} ${n[1]?.slice(0, 2)}`);
    },
    100,
  ),
);
results.push(
  timeMany(
    'POS search, barcode scan (exact)',
    300,
    (i) => searchItems(db, ctx, sampleBarcodes[i % sampleBarcodes.length] as string),
    100,
  ),
);
results.push(
  timeMany(
    'Stock list page (25 rows, search term)',
    30,
    (i) =>
      listStock(db, ctx, {
        q: (sampleNames[i % sampleNames.length] as string).slice(0, 4),
        pageSize: 25,
      }),
    300,
  ),
);

openShift(db, ctx, { floatMinor: 100_000 });
void getOpenShift;
results.push(
  timeMany(
    'Invoice save (3 lines, split tender)',
    100,
    (i) => {
      createSale(db, ctx, {
        idempotencyKey: `bench-${i}-${Date.now()}`,
        lines: [0, 1, 2].map((k) => ({
          itemId: sampleIds[(i * 3 + k) % sampleIds.length] as string,
          unitId: strip,
          qty: 1,
        })),
        payments: [{ modeId: cash, amountMinor: 1_000_000 }],
      });
    },
    300,
  ),
);

const size = raw.prepare('PRAGMA page_count').pluck().get() as number;
const pageSize = raw.prepare('PRAGMA page_size').pluck().get() as number;
console.log(
  `\nDatabase size: ${((size * pageSize) / 1024 / 1024).toFixed(0)} MB for ${COUNT.toLocaleString()} items. Total run ${((performance.now() - t0) / 1000).toFixed(0)} s.`,
);
void clockMs;
void sql;
handle.close();
rmSync(dir, { recursive: true, force: true });
process.exitCode = results.every(Boolean) ? 0 : 1;
