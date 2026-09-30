import { count } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { searchItems } from '../pharmacy/catalog';
import { items, syncOutbox } from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { detectMapping } from './columns';
import { commitItemImport } from './commit';
import type { ParsedTable } from './parse';
import { validateItemRows } from './validate';

const ROWS = 53_000;
const HEADERS = [
  'Name',
  'Generic Name',
  'Barcode',
  'Category',
  'Manufacturer',
  'Stocking Unit',
  'Conversion Unit',
  'Unit Cost',
  'Retail Price',
  'Available Qty',
];
const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Cream', 'Drops'];

let env: TestEnv;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(() => env.cleanup());

function fakeTable(): ParsedTable {
  const rows: string[][] = [];
  for (let i = 0; i < ROWS; i++) {
    rows.push([
      `Fakemed ${100 + (i % 900)}mg ${FORMS[i % FORMS.length]} ${i}`,
      `Fakegeneric${i % 500}`,
      i % 10 === 0 ? 'N/A' : `89610${String(i).padStart(8, '0')}`, // every tenth barcode is junk
      i % 7 === 0 ? '' : `Category ${i % 40}`,
      `Maker ${i % 300}`,
      i % 2 === 0 ? 'Strip' : 'Bottle',
      i % 2 === 0 ? '1 pack = 10 tablets' : '1',
      String(20 + (i % 100)),
      i % 13 === 0 ? '0' : String(30 + (i % 100)),
      String(i % 50),
    ]);
  }
  return { fileName: 'fake.csv', headers: HEADERS, rows, rowNumbers: rows.map((_, i) => i + 2) };
}

describe('53,000 row import', () => {
  it.skipIf(process.env.SKIP_SCALE)(
    'validates and commits in well under a minute, and search stays fast',
    async () => {
      const ctx = env.ctx(env.setup.adminUserId);
      const table = fakeTable();

      const v0 = performance.now();
      const prepared = validateItemRows(env.db, ctx, table, detectMapping(HEADERS), {
        importStock: true,
      });
      const validateMs = performance.now() - v0;
      expect(prepared.report.totalRows).toBe(ROWS);
      expect(prepared.report.skippedWithErrors).toBe(0);
      expect(prepared.report.willImport).toBe(ROWS);
      expect(prepared.report.issueCounts.fake_barcode).toBe(Math.ceil(ROWS / 10));

      const c0 = performance.now();
      const result = await commitItemImport(env.db, ctx, prepared, {
        importStock: true,
        defaultExpiry: '2031-06-30',
      });
      const commitMs = performance.now() - c0;
      console.log(
        `53k import: validate ${(validateMs / 1000).toFixed(1)} s, commit ${(commitMs / 1000).toFixed(1)} s`,
      );

      expect(result.created).toBe(ROWS);
      expect(commitMs).toBeLessThan(60_000);
      expect(env.db.select({ n: count() }).from(items).get()?.n).toBe(ROWS);
      expect(env.db.select({ n: count() }).from(syncOutbox).get()?.n).toBeGreaterThanOrEqual(ROWS);

      const times: number[] = [];
      for (const q of [
        'Fakemed 250mg Tab',
        'Fakemed 101mg Syrup 4',
        '89610000000123',
        'tablet 1234',
      ]) {
        const s = performance.now();
        searchItems(env.db, ctx, q);
        times.push(performance.now() - s);
      }
      console.log(`search after import: ${times.map((t) => t.toFixed(1)).join(', ')} ms`);
      expect(Math.max(...times)).toBeLessThan(100);
    },
    180_000,
  );
});
