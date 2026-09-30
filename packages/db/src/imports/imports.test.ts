import { and, count, eq, sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { verifyAuditChain } from '../audit';
import { DomainError } from '../errors';
import { searchItems } from '../pharmacy/catalog';
import { getBatchStock } from '../pharmacy/stock';
import {
  auditLog,
  batches,
  categories,
  itemBarcodes,
  itemUnits,
  items,
  manufacturers,
  racks,
  stockMovements,
  syncOutbox,
  units,
} from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { detectMapping } from './columns';
import { buildIssueReportCsv } from './errors-report';
import { commitItemImport } from './commit';
import { createPreviewJob, getImportJob, resetImportJobs, startImportJob } from './jobs';
import { parseItemFile, type ParsedTable } from './parse';
import { buildItemTemplate } from './template';
import type { ImportProgress } from './types';
import { validateItemRows } from './validate';
import { parseExpiry } from './values';

const OLD_HEADERS = [
  'Name',
  'Generic Name',
  'Barcode',
  'Category',
  'Manufacturer',
  'Supplier(s)',
  'Stocking Unit',
  'Conversion Unit',
  'Unit Cost',
  'Retail Price',
  'Reordering Level',
  'Available Qty',
  'Expired Qty',
  'Narcotic',
  'Rack#',
  'Status',
  'Dead Item',
];
const TEMPLATE_HEADERS = [
  'name',
  'generic_name',
  'barcode',
  'category',
  'manufacturer',
  'unit',
  'units_per_pack',
  'cost',
  'price',
  'reorder_level',
  'quantity',
  'expiry_date',
  'batch_no',
  'narcotic',
  'prescription',
  'rack',
  'tax_percent',
  'sku',
];

let env: TestEnv;
const ctx = () => env.ctx(env.setup.adminUserId);

beforeEach(async () => {
  env = await createTestEnv();
  resetImportJobs();
});
afterEach(() => env.cleanup());

const csvLine = (cells: string[]) =>
  cells.map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',');

async function table(headers: string[], rows: string[][]): Promise<ParsedTable> {
  const text = [headers, ...rows].map(csvLine).join('\r\n');
  return parseItemFile(Buffer.from(text, 'utf8'), 'items.csv');
}

/** A row in template format: missing trailing fields are blank. */
const tpl = (o: Partial<Record<string, string>>): string[] =>
  TEMPLATE_HEADERS.map((h) => o[h] ?? '');

async function tplTable(rows: Partial<Record<string, string>>[]): Promise<ParsedTable> {
  return table(TEMPLATE_HEADERS, rows.map(tpl));
}

describe('column detection', () => {
  it('maps the old system headers', () => {
    const m = detectMapping(OLD_HEADERS);
    expect(m).toMatchObject({
      name: 0,
      genericName: 1,
      barcode: 2,
      category: 3,
      manufacturer: 4,
      suppliers: 5,
      unit: 6,
      unitsPerPack: 7,
      cost: 8,
      price: 9,
      reorderLevel: 10,
      quantity: 11,
      narcotic: 13,
      rack: 14,
      active: 15,
    });
    // Expired Qty and Dead Item are not imported and must not steal another field.
    expect(Object.values(m)).not.toContain(12);
    expect(Object.values(m)).not.toContain(16);
  });

  it('maps the own template headers', () => {
    const m = detectMapping(TEMPLATE_HEADERS);
    TEMPLATE_HEADERS.forEach((_, i) => expect(Object.values(m)).toContain(i));
    expect(m.name).toBe(0);
    expect(m.unitsPerPack).toBe(6);
    expect(m.taxPercent).toBe(16);
    expect(m.sku).toBe(17);
  });

  it('uses each column once', () => {
    const m = detectMapping(['Name', 'Price', 'Retail Price']);
    expect(m.price).toBe(2);
    expect(Object.values(m).filter((i) => i === 1)).toHaveLength(0);
  });
});

describe('parsing', () => {
  it('reads CSV with BOM, quotes, line breaks inside quotes and CRLF', async () => {
    const text = '﻿Name,Price\r\n"Tab, 500mg","1,200.50"\r\n"Two\nlines",5\r\n\r\nLast,7';
    const t = await parseItemFile(Buffer.from(text), 'a.csv');
    expect(t.headers).toEqual(['Name', 'Price']);
    expect(t.rows).toEqual([
      ['Tab, 500mg', '1,200.50'],
      ['Two\nlines', '5'],
      ['Last', '7'],
    ]);
    expect(t.rowNumbers).toEqual([2, 3, 6]);
  });

  it('reads semicolon CSV', async () => {
    const t = await parseItemFile(Buffer.from('Name;Price\nA;1'), 'a.csv');
    expect(t.rows).toEqual([['A', '1']]);
  });

  it('reads XLSX: numbers, dates, formula results and rich text', async () => {
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Items');
    sheet.addRow(['Name', 'Barcode', 'Price', 'Expiry']);
    sheet.addRow([
      'Fake Tab',
      8961000000011,
      { formula: 'C3*2', result: 80 },
      new Date(Date.UTC(2029, 2, 31)),
    ]);
    sheet.addRow([{ richText: [{ text: 'Rich ' }, { text: 'Name' }] }, '', 12.5, '']);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const t = await parseItemFile(buffer, 'Items.XLSX');
    expect(t.headers).toEqual(['Name', 'Barcode', 'Price', 'Expiry']);
    // The streaming reader hands over a date as a serial number, the full reader as a date: both must mean the same day.
    expect(t.rows[0]?.slice(0, 3)).toEqual(['Fake Tab', '8961000000011', '80']);
    expect(parseExpiry(t.rows[0]?.[3] ?? '')).toEqual({ ok: true, value: '2029-03-31' });
    expect(t.rows[1]).toEqual(['Rich Name', '', '12.5']);
    expect(t.rowNumbers).toEqual([2, 3]);
  });

  it('rejects wrong type, fake xlsx, binary csv, bad encoding, empty and oversized files', async () => {
    await expect(parseItemFile(Buffer.from('a'), 'items.xls')).rejects.toBeInstanceOf(DomainError);
    await expect(parseItemFile(Buffer.from('not a zip'), 'items.xlsx')).rejects.toThrow(
      'not a real',
    );
    await expect(parseItemFile(Buffer.from([0x61, 0, 0x62]), 'items.csv')).rejects.toThrow(
      'text CSV',
    );
    await expect(parseItemFile(Buffer.from([0x4e, 0xff, 0xfe, 0x41]), 'items.csv')).rejects.toThrow(
      'UTF-8',
    );
    await expect(parseItemFile(Buffer.alloc(0), 'items.csv')).rejects.toThrow('empty');
    await expect(
      parseItemFile(Buffer.alloc(25 * 1024 * 1024 + 1, 97), 'items.csv'),
    ).rejects.toThrow('25 MB');
  });

  it('builds a template that parses and validates cleanly', async () => {
    const t = await parseItemFile(await buildItemTemplate(), 'template.xlsx');
    expect(t.headers).toEqual(TEMPLATE_HEADERS);
    expect(t.rows).toHaveLength(3);
    const { report } = validateItemRows(env.db, ctx(), t, detectMapping(t.headers), {
      importStock: true,
    });
    expect(report.skippedWithErrors).toBe(0);
    expect(report.willImport).toBe(3);
  });
});

describe('validation (dry run)', () => {
  const longName = `Long ${'x'.repeat(200)}`;
  const rows = [
    [
      'Alpha Tab 500mg',
      'Alphacetamol',
      '8961000000011',
      'Medicines',
      'Fakemed',
      'SupA',
      'Strip',
      '1 pack = 10 tablets',
      '50',
      '80',
      '5',
      '20',
      '0',
      'false',
      'A1',
      'Active',
      'false',
    ], // 2 ok
    ['X', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''], // 3 name too short
    ['Bad Price', '', '', 'Medicines', '', '', '', '', '', 'abc', '', '', '', '', '', '', ''], // 4
    ['Bad Cost', '', '', 'Medicines', '', '', '', '', '-5', '10', '', '', '', '', '', '', ''], // 5
    ['Bad Qty', '', '', 'Medicines', '', '', '', '', '', '10', '', '-1', '', '', '', '', ''], // 6
    ['Bad Pack', '', '', 'Medicines', '', '', '', '2.5', '', '10', '', '', '', '', '', '', ''], // 7
    ['No Price No Cat', '', '', '', '', '', '', '', '0', '0', '', '', '', '', '', '', ''], // 8
    ['Fake Barcode', '', 'N/A', 'Medicines', '', '', '', '', '', '10', '', '', '', '', '', '', ''], // 9
    [
      'Same Barcode',
      '',
      '8961000000011',
      'Medicines',
      '',
      '',
      '',
      '',
      '',
      '10',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ], // 10
    [longName, '', '', 'Medicines', '', '', '', '', '', '10', '', '', '', '', '', '', ''], // 11
    [
      'Two Suppliers',
      '',
      '',
      'Medicines',
      '',
      'Sup A, Sup B',
      '',
      '',
      '',
      '10',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ], // 12
    [
      'alpha  tab 500MG',
      '',
      '',
      'Medicines',
      'FAKEMED',
      '',
      '',
      '10',
      '',
      '10',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ], // 13 twin of row 2
  ];

  it('classifies every row and keeps exact counts', async () => {
    const t = await table(OLD_HEADERS, rows);
    const { report, rows: ready } = validateItemRows(env.db, ctx(), t, detectMapping(t.headers));
    expect(report.totalRows).toBe(12);
    expect(report.skippedWithErrors).toBe(5);
    expect(report.willImport).toBe(7);
    expect(ready).toHaveLength(7);
    expect(report.alreadyExist).toBe(0);
    expect(report.issueCounts).toMatchObject({
      name_invalid: 1,
      price_invalid: 1,
      cost_invalid: 1,
      quantity_invalid: 1,
      pack_invalid: 1,
      zero_price: 1,
      blank_category: 1,
      fake_barcode: 1,
      duplicate_barcode: 1,
      name_truncated: 1,
      multiple_suppliers: 1,
      possible_duplicate: 1,
    });
    expect(report.rowsWithSuppliers).toBe(2);
    const byRow = (n: number) => ready.find((r) => r.rowNo === n);
    expect(byRow(9)?.barcode).toBeNull();
    expect(byRow(10)?.barcode).toBeNull(); // first wins, the later row loses the barcode
    expect(byRow(2)?.barcode).toBe('8961000000011');
    expect(byRow(11)?.name).toHaveLength(160);
    expect(byRow(8)?.retailRateUnitMicro).toBe(0);
    expect(report.issues.find((i) => i.code === 'possible_duplicate')?.message).toContain('row 2');
    expect(report.issues.every((i) => i.row >= 2)).toBe(true);
  });

  it('converts prices and quantities per pack without floats', async () => {
    const t = await tplTable([
      {
        name: 'Pack Item',
        unit: 'Strip',
        units_per_pack: '1 pack = 30 tablets',
        price: '187.50',
        cost: '150',
        quantity: '2',
        reorder_level: '3',
      },
      { name: 'Odd Price', units_per_pack: '3', price: '10' },
      { name: 'Half Packs', units_per_pack: '30', price: '60', quantity: '1.5' },
      { name: 'Bad Half', units_per_pack: '3', price: '60', quantity: '0.5' },
      { name: 'Many Decimals', price: '12.3456789' },
    ]);
    const { rows: r, report } = validateItemRows(env.db, ctx(), t, detectMapping(t.headers));
    expect(r[0]).toMatchObject({
      packSize: 30,
      retailRateUnitMicro: 6_250_000,
      quantityBase: 60,
      reorderLevelBase: 90,
    });
    expect(r[0]?.costPackMicro).toBe(150_000_000);
    expect(r[1]?.retailRateUnitMicro).toBe(3_333_333); // 10 / 3, rounded once
    expect(r[2]?.quantityBase).toBe(45);
    expect(report.issueCounts.quantity_invalid).toBe(1); // 0.5 pack of 3 is not a whole unit
    expect(r.find((x) => x.name === 'Many Decimals')?.retailRateUnitMicro).toBe(12_345_679);
  });

  it('checks expiry formats and flags rows that need a default expiry', async () => {
    const t = await tplTable([
      { name: 'Iso', quantity: '1', expiry_date: '2029-03-31' },
      { name: 'Day first', quantity: '1', expiry_date: '31/03/2029' },
      { name: 'Month year', quantity: '1', expiry_date: '02/2028' },
      { name: 'Year month', quantity: '1', expiry_date: '2028-02' },
      { name: 'Month name', quantity: '1', expiry_date: 'Mar-2029' },
      { name: 'Excel serial', quantity: '1', expiry_date: '47208' },
      { name: 'Impossible', quantity: '1', expiry_date: '31/02/2029' },
      { name: 'No expiry', quantity: '4' },
    ]);
    const { rows: r, report } = validateItemRows(env.db, ctx(), t, detectMapping(t.headers));
    expect(r.map((x) => x.expiryDate)).toEqual([
      '2029-03-31',
      '2029-03-31',
      '2028-02-29',
      '2028-02-29',
      '2029-03-31',
      '2029-03-31',
      null,
    ]);
    expect(report.issueCounts.expiry_invalid).toBe(1);
    expect(report.needsDefaultExpiry).toBe(1);
    expect(report.stockRows).toBe(7);
  });

  it('warns about opening stock without cost or already expired', async () => {
    const t = await tplTable([
      { name: 'No Cost', quantity: '5', expiry_date: '2029-01-01' },
      { name: 'Expired One', quantity: '5', cost: '10', expiry_date: '2020-01-01' },
    ]);
    const m = detectMapping(t.headers);
    expect(validateItemRows(env.db, ctx(), t, m).report.issueCounts.stock_no_cost).toBeUndefined();
    const withStock = validateItemRows(env.db, ctx(), t, m, { importStock: true }).report;
    expect(withStock.issueCounts).toMatchObject({ stock_no_cost: 1, stock_expired: 1 });
  });

  it('caps stored issues per kind but counts all of them', async () => {
    const many = Array.from({ length: 5200 }, (_, i) => ({ name: `Item number ${i}`, price: '5' }));
    const t = await tplTable(many);
    const { report } = validateItemRows(env.db, ctx(), t, detectMapping(t.headers));
    expect(report.issueCounts.blank_category).toBe(5200);
    expect(report.issues).toHaveLength(5000);
    expect(report.issuesTruncated).toBe(true);
    expect(buildIssueReportCsv(report)).toContain('Totals - blank_category: 5200');
  });

  it('builds a safe CSV report: BOM, quotes, formula guard', async () => {
    const t = await tplTable([
      { name: '=HYPERLINK("x")', price: 'abc' },
      { name: 'Fine, Item', price: '0' },
    ]);
    const { report } = validateItemRows(env.db, ctx(), t, detectMapping(t.headers));
    const csv = buildIssueReportCsv(report);
    expect(csv.startsWith('﻿Row,Result,Item name')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"Fine, Item"');
    expect(csv).toContain('Skipped (error)');
    expect(csv).toContain('Imported with warning');
  });
});

describe('commit', () => {
  const rows = [
    {
      name: 'Alpha Tab',
      barcode: '8961000000011',
      category: 'Medicines',
      manufacturer: 'Fakemed',
      unit: 'Strip',
      units_per_pack: '10',
      cost: '50',
      price: '80',
      quantity: '3',
      rack: 'a1',
      tax_percent: '18',
      prescription: 'yes',
    },
    {
      name: 'Beta Syrup',
      barcode: '8961000000022',
      manufacturer: 'FAKEMED',
      unit: 'Bottle',
      cost: '120',
      price: '180',
      quantity: '7',
      expiry_date: '2029-03',
      batch_no: 'B7',
    },
    {
      name: 'Gamma Cream',
      barcode: '8961000000033',
      category: 'Brand New Category',
      quantity: '4',
    },
  ];

  async function run(importStock: boolean, defaultExpiry = '2030-01-31') {
    const t = await tplTable(rows);
    const prepared = validateItemRows(env.db, ctx(), t, detectMapping(t.headers), { importStock });
    const progress: ImportProgress[] = [];
    const result = await commitItemImport(
      env.db,
      ctx(),
      prepared,
      { importStock, defaultExpiry },
      (p) => progress.push(p),
    );
    return { prepared, result, progress };
  }

  it('creates items with the unit model, masters, prices and opening stock', async () => {
    const unitsBefore = env.db.select().from(units).all().length;
    const { result, progress } = await run(true);
    expect(result).toMatchObject({
      created: 3,
      skipped: 0,
      openingBatches: 2,
      openingSkipped: 1,
      unitsCreated: 1,
      manufacturersCreated: 1,
      categoriesCreated: 1,
      racksCreated: 1,
    });
    expect(env.db.select().from(units).all().length).toBe(unitsBefore + 1); // only 'Loose unit'; Strip and Bottle exist
    expect(progress.at(-1)).toMatchObject({ done: 3, total: 3, created: 3 });

    const alpha = env.db.select().from(items).where(eq(items.name, 'Alpha Tab')).get()!;
    const alphaUnits = env.db
      .select({ u: itemUnits, name: units.name, code: units.code })
      .from(itemUnits)
      .innerJoin(units, eq(units.id, itemUnits.unitId))
      .where(eq(itemUnits.itemId, alpha.id))
      .all();
    expect(
      alphaUnits
        .map((x) => [x.name, x.u.factorToBase, x.u.isDefaultSale, x.u.isDefaultPurchase])
        .sort(),
    ).toEqual([
      ['Loose unit', 1, false, false],
      ['Strip', 10, true, true],
    ]);
    expect(alphaUnits.find((x) => x.name === 'Loose unit')?.code).toBe('loose');
    expect(alpha.baseUnitId).toBe(alphaUnits.find((x) => x.name === 'Loose unit')?.u.unitId);
    expect(alpha).toMatchObject({
      retailRateUnitMicro: 8_000_000,
      taxBp: 1800,
      isPrescription: true,
      isActive: true,
    });
    expect(alpha.sku).toBe('10001');

    const beta = env.db.select().from(items).where(eq(items.name, 'Beta Syrup')).get()!;
    const betaUnits = env.db
      .select({ name: units.name, f: itemUnits.factorToBase })
      .from(itemUnits)
      .innerJoin(units, eq(units.id, itemUnits.unitId))
      .where(eq(itemUnits.itemId, beta.id))
      .all();
    expect(betaUnits).toEqual([{ name: 'Bottle', f: 1 }]);
    expect(beta.retailRateUnitMicro).toBe(180_000_000);

    // Opening stock: 3 strips of 10 at PKR 50 per strip, and 7 bottles with the expiry of the file.
    const alphaBatch = getBatchStock(env.db, env.setup.branchId, alpha.id);
    expect(alphaBatch).toHaveLength(1);
    expect(alphaBatch[0]).toMatchObject({
      available: 30,
      batchNo: 'OPENING',
      expiryDate: '2030-01-31',
      costUnitMicro: 5_000_000,
    });
    const betaBatch = getBatchStock(env.db, env.setup.branchId, beta.id);
    expect(betaBatch[0]).toMatchObject({
      available: 7,
      batchNo: 'B7',
      expiryDate: '2029-03-31',
      costUnitMicro: 120_000_000,
    });
    const gamma = env.db.select().from(items).where(eq(items.name, 'Gamma Cream')).get()!;
    expect(getBatchStock(env.db, env.setup.branchId, gamma.id)).toHaveLength(0); // no cost: stock not guessed
    const moves = env.db.select().from(stockMovements).all();
    expect(moves).toHaveLength(2);
    expect(
      moves.every(
        (m) => m.kind === 'opening' && m.qtyBase > 0 && m.userId === env.setup.adminUserId,
      ),
    ).toBe(true);

    // Masters: case-insensitive reuse.
    expect(env.db.select().from(manufacturers).all()).toHaveLength(1);
    expect(
      env.db.select().from(categories).where(eq(categories.name, 'Brand New Category')).all(),
    ).toHaveLength(1);
    expect(
      env.db
        .select()
        .from(racks)
        .all()
        .map((r) => r.code),
    ).toEqual(['A1']);
    expect(alpha.rackId).not.toBeNull();
  });

  it('imports without stock when the option is off', async () => {
    const { result } = await run(false, '');
    expect(result.openingBatches).toBe(0);
    expect(env.db.select().from(batches).all()).toHaveLength(0);
    expect(env.db.select().from(stockMovements).all()).toHaveLength(0);
  });

  it('refuses opening stock without a usable default expiry before writing anything', async () => {
    const t = await tplTable([{ name: 'No Expiry', cost: '5', price: '9', quantity: '2' }]);
    const prepared = validateItemRows(env.db, ctx(), t, detectMapping(t.headers), {
      importStock: true,
    });
    const go = (d?: string) =>
      commitItemImport(env.db, ctx(), prepared, { importStock: true, defaultExpiry: d });
    await expect(go()).rejects.toThrow('default expiry');
    await expect(go('2020-01-01')).rejects.toThrow('future');
    await expect(go('31/12/2030')).rejects.toThrow('like 2028-12-31');
    expect(env.db.select().from(items).all()).toHaveLength(0);
    await expect(
      commitItemImport(env.db, ctx(), prepared, { importStock: false }),
    ).resolves.toMatchObject({ created: 1 });
  });

  it('is idempotent: importing the same file twice creates nothing new', async () => {
    const first = await run(true);
    expect(first.result.created).toBe(3);
    const again = await run(true);
    expect(again.prepared.report.alreadyExist).toBe(3);
    expect(again.result.created).toBe(0);
    expect(env.db.select().from(items).all()).toHaveLength(3);
    expect(env.db.select().from(stockMovements).all()).toHaveLength(2);
  });

  it('skips a barcode added after the preview instead of failing the import', async () => {
    const t = await tplTable([
      { name: 'Race Item', barcode: '8961000000099', price: '5' },
      { name: 'Other Item', price: '5' },
    ]);
    const prepared = validateItemRows(env.db, ctx(), t, detectMapping(t.headers));
    await commitItemImport(
      env.db,
      ctx(),
      validateItemRows(
        env.db,
        ctx(),
        await tplTable([{ name: 'Racer', barcode: '8961000000099', price: '1' }]),
        detectMapping(TEMPLATE_HEADERS),
      ),
      { importStock: false },
    );
    const result = await commitItemImport(env.db, ctx(), prepared, { importStock: false });
    expect(result).toMatchObject({ created: 1, skipped: 1 });
  });

  it('writes outbox rows per item, units and barcodes, searchable items and an intact audit chain', async () => {
    const outbox = (type: string) =>
      env.db.select({ n: count() }).from(syncOutbox).where(eq(syncOutbox.entityType, type)).get()!
        .n;
    const before = { units: outbox('units'), categories: outbox('categories') };
    await run(true);
    expect(outbox('items')).toBe(3);
    expect(outbox('batches')).toBe(2);
    expect(outbox('units') - before.units).toBe(1);
    expect(outbox('manufacturers')).toBe(1);
    expect(outbox('categories') - before.categories).toBe(1);
    expect(outbox('racks')).toBe(1);
    const seqs = env.db
      .select({ s: syncOutbox.seq })
      .from(syncOutbox)
      .all()
      .map((r) => r.s)
      .sort((a, b) => a - b);
    expect(new Set(seqs).size).toBe(seqs.length);
    const payload = JSON.parse(
      env.db
        .select()
        .from(syncOutbox)
        .where(and(eq(syncOutbox.entityType, 'items')))
        .get()!.payloadJson,
    ) as { units: unknown[]; barcodes: unknown[]; name: string };
    expect(payload.units.length).toBeGreaterThan(0);
    expect(payload.barcodes).toHaveLength(1);

    const hits = searchItems(env.db, ctx(), 'Alpha');
    expect(hits.map((h) => h.name)).toContain('Alpha Tab');
    expect(hits[0]?.sellableBase).toBe(30);
    expect(searchItems(env.db, ctx(), '8961000000022')[0]?.name).toBe('Beta Syrup');
    expect(searchItems(env.db, ctx(), 'syrup').map((h) => h.name)).toContain('Beta Syrup');
    expect(env.db.select({ n: count() }).from(itemBarcodes).get()!.n).toBe(3);

    expect(
      env.db.select().from(auditLog).where(eq(auditLog.action, 'item.import')).all(),
    ).toHaveLength(1);
    expect(verifyAuditChain(env.db, env.setup.branchId).ok).toBe(true);
    expect(env.db.get<{ n: number }>(sql`SELECT count(*) AS n FROM items_fts`)?.n).toBe(3);
  });

  it('writes one audit entry per chunk and reports progress', async () => {
    const many = Array.from({ length: 2500 }, (_, i) => ({
      name: `Chunk Item ${i}`,
      barcode: `7700${String(i).padStart(8, '0')}`,
      price: '5',
      category: 'Medicines',
    }));
    const t = await tplTable(many);
    const prepared = validateItemRows(env.db, ctx(), t, detectMapping(t.headers));
    const progress: ImportProgress[] = [];
    const result = await commitItemImport(env.db, ctx(), prepared, { importStock: false }, (p) =>
      progress.push(p),
    );
    expect(result.created).toBe(2500);
    expect(progress.map((p) => p.done)).toEqual([0, 1000, 2000, 2500]);
    expect(
      env.db.select().from(auditLog).where(eq(auditLog.action, 'item.import')).all(),
    ).toHaveLength(3);
    expect(verifyAuditChain(env.db, env.setup.branchId).ok).toBe(true);
  });

  it('numbers items after existing codes and honours codes from the file', async () => {
    const t = await tplTable([
      { name: 'Coded', sku: 'ABC-1' },
      { name: 'Auto One' },
      { name: 'Auto Two' },
      { name: 'Clash', sku: '10002' },
    ]);
    const prepared = validateItemRows(env.db, ctx(), t, detectMapping(t.headers));
    await commitItemImport(env.db, ctx(), prepared, { importStock: false });
    const skus = new Map(
      env.db
        .select({ n: items.name, s: items.sku })
        .from(items)
        .all()
        .map((r) => [r.n, r.s]),
    );
    expect(skus.get('Coded')).toBe('ABC-1');
    expect(skus.get('Auto One')).toBe('10001');
    expect(skus.get('Auto Two')).toBe('10002');
    expect(skus.get('Clash')).toBe('10003'); // 10002 was taken by Auto Two earlier in the same file
  });
});

describe('background job', () => {
  it('validates, commits in the background, reports progress and guards ownership', async () => {
    const t = await tplTable([
      { name: 'Job Item One', barcode: '8961000000101', price: '5', category: 'Medicines' },
      { name: 'Job Item Two', barcode: '8961000000102', price: '6' },
      { name: '', price: '1' },
    ]);
    const job = createPreviewJob(env.db, ctx(), t, null, {});
    expect(job.status).toBe('ready');
    expect(job.report).toMatchObject({ totalRows: 3, willImport: 2, skippedWithErrors: 1 });

    expect(() => getImportJob(job.id, env.setup.tenantId, 'someone-else')).toThrow(DomainError);
    expect(() => getImportJob('nope', env.setup.tenantId, env.setup.adminUserId)).toThrow(
      DomainError,
    );

    startImportJob(env.db, ctx(), job, { importStock: false });
    expect(['queued', 'running']).toContain(job.status);
    const second = createPreviewJob(env.db, ctx(), t, null, {});
    expect(() => startImportJob(env.db, ctx(), second, { importStock: false })).toThrow(
      'Another import',
    );

    for (let i = 0; i < 200 && job.status !== 'done' && job.status !== 'failed'; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(job.status).toBe('done');
    expect(job.result?.created).toBe(2);
    expect(job.progress).toMatchObject({ done: 3, total: 3, created: 2, skipped: 1 });
    expect(job.prepared).toBeNull();
    expect(() => startImportJob(env.db, ctx(), job, { importStock: false })).toThrow(
      'already started',
    );
  });

  it('refuses bad options before starting, then runs with a default expiry', async () => {
    const t = await tplTable([{ name: 'Needs Expiry', cost: '5', price: '9', quantity: '2' }]);
    const job = createPreviewJob(env.db, ctx(), t, null, { importStock: true });
    expect(() => startImportJob(env.db, ctx(), job, { importStock: true })).toThrow(
      'default expiry',
    );
    expect(job.status).toBe('ready');
    startImportJob(env.db, ctx(), job, { importStock: true, defaultExpiry: '2031-01-01' });
    for (let i = 0; i < 200 && job.status !== 'done'; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(job.result?.openingBatches).toBe(1);
  });
});
