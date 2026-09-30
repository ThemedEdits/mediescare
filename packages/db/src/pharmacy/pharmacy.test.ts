import { count, eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRateToMicro } from '@mediescare/core';
import { verifyAuditChain } from '../audit';
import { DomainError } from '../errors';
import { grantOverride } from '../overrides';
import {
  auditLog,
  batches,
  narcoticRegister,
  paymentModes,
  saleLines,
  sales,
  stockMovements,
  syncOutbox,
  units,
} from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { setPin } from '../users';
import { getPosRounding, setSetting } from '../settings';
import {
  createItem,
  rebuildItemSearch,
  searchItems,
  updateItem,
  getItem,
  type ItemInput,
} from './catalog';
import { createSupplier } from './lookups';
import {
  closeShift,
  createReturn,
  createSale,
  deleteHold,
  expectedCashMinor,
  getHold,
  getSale,
  holdInvoice,
  listHolds,
  listSales,
  openShift,
  recordMissedSale,
  salesSummary,
  voidSale,
  type CreateSaleInput,
} from './pos';
import {
  adjustStock,
  getBatchStock,
  listStock,
  receiveGrn,
  stockValueMinor,
  type GrnLineInput,
} from './stock';

const rate = parseRateToMicro;
let env: TestEnv;
let admin: string;
let cashier: string;
let manager: string;
let supplierId: string;
let unitId: Record<string, string>;
let modeId: Record<string, string>;
let para: string; // Paracetamol: tablet / strip (10) / box (100)
let tramadol: string; // controlled
let cashierShift: string;

function itemInput(over: Partial<ItemInput> = {}): ItemInput {
  return {
    name: 'Paracetamol 500mg',
    genericName: 'Paracetamol',
    baseUnitId: unitId.tablet as string,
    units: [
      { unitId: unitId.tablet as string, factorToBase: 1 },
      {
        unitId: unitId.strip as string,
        factorToBase: 10,
        isDefaultSale: true,
        isDefaultPurchase: true,
      },
      { unitId: unitId.box as string, factorToBase: 100 },
    ],
    barcodes: ['8961001234567'],
    retailRateUnitMicro: rate('2.50'),
    ...over,
  };
}

const grnLine = (itemId: string, over: Partial<GrnLineInput> = {}): GrnLineInput => ({
  itemId,
  unitId: unitId.strip as string,
  qty: 50,
  batchNo: 'A1',
  expiryDate: '2026-12-31',
  unitPriceMicro: rate('18'),
  ...over,
});

const receive = (lines: GrnLineInput[], over: Record<string, unknown> = {}) =>
  receiveGrn(env.db, env.ctx(admin), { supplierId, lines, ...over });
const stockOf = (itemId: string) =>
  getBatchStock(env.db, env.setup.branchId, itemId, { includeEmpty: true });
const onHand = (itemId: string) => stockOf(itemId).reduce((s, b) => s + b.available, 0);
const ledgerCount = () => env.db.select({ n: count() }).from(stockMovements).get()?.n ?? 0;

const saleInput = (over: Partial<CreateSaleInput> = {}): CreateSaleInput => ({
  idempotencyKey: `key-${Math.random().toString(36).slice(2)}-${Date.now()}`,
  lines: [{ itemId: para, unitId: unitId.strip as string, qty: 2 }],
  payments: [{ modeId: modeId.cash as string, amountMinor: 10_000 }],
  ...over,
});

const sell = (over: Partial<CreateSaleInput> = {}) =>
  createSale(env.db, env.ctx(cashier), saleInput(over));

async function expectDomain(fn: () => unknown, code: string) {
  let err: unknown;
  try {
    await fn();
  } catch (e) {
    err = e;
  }
  expect(err, `expected DomainError ${code}`).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

beforeEach(async () => {
  env = await createTestEnv();
  admin = env.setup.adminUserId;
  cashier = await env.addUser(admin, 'cashier1', 'cashier', { pin: '135791' });
  manager = await env.addUser(admin, 'mgr1', 'branch_manager', { pin: '482913' });
  await setPin(env.db, env.ctx(admin), admin, '246813');
  unitId = Object.fromEntries(
    env.db
      .select()
      .from(units)
      .all()
      .map((u) => [u.code, u.id]),
  );
  modeId = Object.fromEntries(
    env.db
      .select()
      .from(paymentModes)
      .all()
      .map((m) => [m.code, m.id]),
  );
  supplierId = createSupplier(env.db, env.ctx(admin), {
    name: 'Test Distributor',
    ntn: '1234567-8',
  });
  para = createItem(env.db, env.ctx(admin), itemInput());
  tramadol = createItem(
    env.db,
    env.ctx(admin),
    itemInput({
      name: 'Tramadol 50mg',
      genericName: 'Tramadol',
      barcodes: ['8961009999991'],
      isNarcotic: true,
      retailRateUnitMicro: rate('12'),
    }),
  );
  // Two batches of paracetamol: A expires first (50 strips = 500 tablets at 1.80), B later (100 strips at 2.00).
  receive([
    grnLine(para, { batchNo: 'A1', expiryDate: '2026-12-31', qty: 50, unitPriceMicro: rate('18') }),
    grnLine(para, {
      batchNo: 'B1',
      expiryDate: '2027-06-30',
      qty: 100,
      unitPriceMicro: rate('20'),
    }),
  ]);
  cashierShift = openShift(env.db, env.ctx(cashier), { floatMinor: 500_000 }).id;
  // Most tests check exact paisa amounts. The default (nearest rupee) has its own tests below.
  setSetting(env.db, env.ctx(admin), 'pos.rounding', 'none');
  void manager;
});
afterEach(() => env.cleanup());

describe('items and search', () => {
  it('creates an item with units and barcodes, and the next code is generated', () => {
    const item = getItem(env.db, env.setup.tenantId, para);
    expect(item.sku).toBe('10001');
    expect(item.units.map((u) => [u.name, u.factorToBase])).toEqual([
      ['Tablet', 1],
      ['Strip', 10],
      ['Box', 100],
    ]);
    expect(item.barcodes).toEqual(['8961001234567']);
    expect(getItem(env.db, env.setup.tenantId, tramadol).sku).toBe('10002');
  });

  it('finds items by exact barcode (scanner) and by typing part of the name or generic name', () => {
    expect(searchItems(env.db, env.ctx(cashier), '8961001234567')[0]).toMatchObject({
      id: para,
      matchedByBarcode: true,
    });
    expect(searchItems(env.db, env.ctx(cashier), 'para')[0]?.id).toBe(para);
    expect(searchItems(env.db, env.ctx(cashier), 'PARACET 500').map((h) => h.id)).toContain(para);
    expect(searchItems(env.db, env.ctx(cashier), 'trama')[0]?.id).toBe(tramadol);
    expect(searchItems(env.db, env.ctx(cashier), 'zzzzz')).toEqual([]);
    expect(searchItems(env.db, env.ctx(cashier), '   ')).toEqual([]);
  });

  it('search results carry sellable stock, nearest expiry and batches', () => {
    const hit = searchItems(env.db, env.ctx(cashier), 'paracetamol')[0];
    expect(hit?.sellableBase).toBe(1_500);
    expect(hit?.nearestExpiry).toBe('2026-12-31');
    expect(hit?.batches.map((b) => b.batchNo)).toEqual(['A1', 'B1']);
    expect(hit?.batches[0]?.expiry.state).toBe('near');
  });

  it('search is safe against FTS syntax in user input', () => {
    for (const q of ['"', 'a OR', 'para*)', "'; DROP TABLE items; --", 'NEAR(', '-'])
      expect(() => searchItems(env.db, env.ctx(cashier), q)).not.toThrow();
    expect(env.db.select({ n: count() }).from(batches).get()?.n).toBeGreaterThan(0);
  });

  it('keeps the search index in step with edits and can rebuild it', () => {
    const before = getItem(env.db, env.setup.tenantId, para);
    updateItem(env.db, env.ctx(admin), para, {
      ...itemInput({ name: 'Panadol Extra 500mg', barcodes: ['8961001234567', '111222333'] }),
      expectedVersion: before.version,
    });
    expect(searchItems(env.db, env.ctx(cashier), 'panadol')[0]?.id).toBe(para);
    expect(searchItems(env.db, env.ctx(cashier), 'paracetamol')[0]?.id).toBe(para); // generic name still matches
    expect(searchItems(env.db, env.ctx(cashier), '111222333')[0]?.id).toBe(para);
    // A word in the middle of the name is found only through the full-text index.
    expect(searchItems(env.db, env.ctx(cashier), 'extra')[0]?.id).toBe(para);
    env.db.run(sql`DELETE FROM items_fts`);
    expect(searchItems(env.db, env.ctx(cashier), 'extra')).toEqual([]);
    // Names that start with the typed text still come straight from the name index.
    expect(searchItems(env.db, env.ctx(cashier), 'panadol')[0]?.id).toBe(para);
    expect(rebuildItemSearch(env.db)).toBe(2);
    expect(searchItems(env.db, env.ctx(cashier), 'extra')[0]?.id).toBe(para);
  });

  it('puts names that start with the typed text first, then other matches', () => {
    const cold = createItem(
      env.db,
      env.ctx(admin),
      itemInput({
        name: 'Cold Relief Paracetamol',
        genericName: 'Paracetamol combination',
        barcodes: ['5550001'],
        retailRateUnitMicro: rate('3'),
      }),
    );
    const hits = searchItems(env.db, env.ctx(cashier), 'para').map((h) => h.id);
    expect(hits[0]).toBe(para); // starts with "para"
    expect(hits).toContain(cold); // "para" inside the name, via the word index
    expect(hits.indexOf(para)).toBeLessThan(hits.indexOf(cold));
  });

  it('hides inactive items from search', () => {
    const before = getItem(env.db, env.setup.tenantId, para);
    updateItem(env.db, env.ctx(admin), para, {
      ...itemInput({ isActive: false }),
      expectedVersion: before.version,
    });
    expect(searchItems(env.db, env.ctx(cashier), 'paracetamol')).toEqual([]);
  });

  it('validates items: duplicate barcode, base unit, default unit, units per pack', async () => {
    await expectDomain(
      () =>
        createItem(
          env.db,
          env.ctx(admin),
          itemInput({ name: 'Copy', barcodes: ['8961001234567'] }),
        ),
      'CONFLICT',
    );
    await expectDomain(
      () =>
        createItem(
          env.db,
          env.ctx(admin),
          itemInput({
            name: 'Bad base',
            units: [{ unitId: unitId.strip as string, factorToBase: 10, isDefaultSale: true }],
          }),
        ),
      'INVALID',
    );
    await expectDomain(
      () =>
        createItem(
          env.db,
          env.ctx(admin),
          itemInput({
            name: 'No default',
            units: [{ unitId: unitId.tablet as string, factorToBase: 1 }],
          }),
        ),
      'INVALID',
    );
    await expectDomain(
      () =>
        createItem(
          env.db,
          env.ctx(admin),
          itemInput({
            name: 'Fraction',
            units: [
              { unitId: unitId.tablet as string, factorToBase: 1, isDefaultSale: true },
              { unitId: unitId.strip as string, factorToBase: 2.5 },
            ],
          }),
        ),
      'INVALID',
    );
    await expectDomain(
      () => createItem(env.db, env.ctx(admin), itemInput({ name: 'X', barcodes: ['ab'] })),
      'INVALID',
    );
    await expectDomain(
      () =>
        createItem(
          env.db,
          env.ctx(admin),
          itemInput({ name: 'Dup code', sku: '10001', barcodes: [] }),
        ),
      'CONFLICT',
    );
  });

  it('uses optimistic locking and refuses to change units per pack after creation', async () => {
    const v = getItem(env.db, env.setup.tenantId, para);
    await expectDomain(
      () =>
        updateItem(env.db, env.ctx(admin), para, {
          ...itemInput(),
          expectedVersion: v.version + 5,
        }),
      'VERSION_CONFLICT',
    );
    await expectDomain(
      () =>
        updateItem(env.db, env.ctx(admin), para, {
          ...itemInput({
            units: [
              { unitId: unitId.tablet as string, factorToBase: 1 },
              { unitId: unitId.strip as string, factorToBase: 12, isDefaultSale: true },
              { unitId: unitId.box as string, factorToBase: 100 },
            ],
          }),
          expectedVersion: v.version,
        }),
      'CONFLICT',
    );
  });
});

describe('goods receipt (add stock)', () => {
  it('posts batches and purchase movements and the balance equals the ledger', () => {
    expect(onHand(para)).toBe(1_500);
    const a = stockOf(para).find((b) => b.batchNo === 'A1');
    expect(a).toMatchObject({ available: 500, costUnitMicro: 1_800_000, expiryDate: '2026-12-31' });
    const moves = env.db.select().from(stockMovements).all();
    expect(moves.every((m) => m.kind === 'purchase' && m.qtyBase > 0)).toBe(true);
    expect(moves.reduce((s, m) => s + m.qtyBase, 0)).toBe(1_500);
    expect(verifyAuditChain(env.db, env.setup.branchId).ok).toBe(true);
  });

  it('computes totals with discount, taxes and freight, and numbers documents per branch', () => {
    const res = receive(
      [
        grnLine(para, {
          batchNo: 'C1',
          expiryDate: '2027-01-31',
          qty: 10,
          unitPriceMicro: rate('20'),
        }),
      ],
      {
        discountMinor: 500,
        salesTaxMinor: 3_600,
        advanceTaxMinor: 400,
        freightMinor: 1_000,
        whtMinor: 200,
        supplierInvoiceNo: 'SI-77',
      },
    );
    expect(res.docNo).toBe('KHI01-GRN-000002');
    expect(res.subTotalMinor).toBe(20_000);
    expect(res.totalMinor).toBe(20_000 - 500 + 3_600 + 400 + 1_000);
  });

  it('bonus units lower the cost of the batch', () => {
    const res = receive([
      grnLine(para, {
        batchNo: 'BN',
        expiryDate: '2027-02-28',
        qty: 100,
        bonusQty: 25,
        unitPriceMicro: rate('20'),
      }),
    ]);
    expect(res.lines[0]).toMatchObject({ qtyBase: 1_250, costUnitMicro: 1_600_000 }); // 100 x 2.00 spread over 125 strips = 1.60 per tablet
    expect(res.subTotalMinor).toBe(200_000);
  });

  it('receiving the same batch again adds to it instead of duplicating', () => {
    receive([
      grnLine(para, {
        batchNo: 'A1',
        expiryDate: '2026-12-31',
        qty: 5,
        unitPriceMicro: rate('18'),
      }),
    ]);
    expect(stockOf(para).filter((b) => b.batchNo === 'A1')).toHaveLength(1);
    expect(stockOf(para).find((b) => b.batchNo === 'A1')?.available).toBe(550);
  });

  it('refuses expired stock, missing supplier, empty receipt and bad quantities, saving nothing', async () => {
    const before = ledgerCount();
    await expectDomain(
      () => receive([grnLine(para, { expiryDate: '2026-10-04' })]),
      'EXPIRED_BATCH',
    );
    await expectDomain(
      () => receiveGrn(env.db, env.ctx(admin), { supplierId: 'nope', lines: [grnLine(para)] }),
      'INVALID',
    );
    await expectDomain(() => receive([]), 'INVALID');
    await expectDomain(() => receive([grnLine(para, { qty: 0 })]), 'INVALID');
    await expectDomain(() => receive([grnLine(para, { qty: 2.5 })]), 'INVALID');
    await expectDomain(() => receive([grnLine(para, { batchNo: ' ' })]), 'INVALID');
    await expectDomain(() => receive([grnLine(para)], { discountMinor: 999_999_999 }), 'INVALID');
    await expectDomain(
      () => receive([grnLine(para), grnLine(para, { itemId: 'ghost' })]),
      'INVALID',
    );
    expect(ledgerCount()).toBe(before);
  });

  it('queues the receipt for the cloud with its movements', () => {
    const row = env.db.select().from(syncOutbox).where(eq(syncOutbox.entityType, 'grns')).all()[0];
    const payload = JSON.parse(row?.payloadJson ?? '{}') as {
      lines: unknown[];
      movements: unknown[];
      docNo: string;
    };
    expect(payload.docNo).toBe('KHI01-GRN-000001');
    expect(payload.lines).toHaveLength(2);
    expect(payload.movements).toHaveLength(2);
  });
});

describe('stock adjustment and listing', () => {
  it('adjusts with a reason, never below zero, and keeps the ledger as the truth', async () => {
    const a = stockOf(para).find((b) => b.batchNo === 'A1') as { id: string };
    expect(
      adjustStock(env.db, env.ctx(admin), { batchId: a.id, qtyDeltaBase: -20, reason: 'damaged' })
        .newBalance,
    ).toBe(480);
    expect(
      adjustStock(env.db, env.ctx(admin), { batchId: a.id, qtyDeltaBase: 5, reason: 'found' })
        .newBalance,
    ).toBe(485);
    await expectDomain(
      () =>
        adjustStock(env.db, env.ctx(admin), { batchId: a.id, qtyDeltaBase: -486, reason: 'lost' }),
      'INSUFFICIENT_STOCK',
    );
    await expectDomain(
      () => adjustStock(env.db, env.ctx(admin), { batchId: a.id, qtyDeltaBase: 0, reason: 'lost' }),
      'INVALID',
    );
    await expectDomain(
      () =>
        adjustStock(env.db, env.ctx(admin), { batchId: a.id, qtyDeltaBase: -1, reason: 'other' }),
      'INVALID',
    );
    expect(onHand(para)).toBe(1_485);
  });

  it('lists stock with on hand, sellable, reorder flag and search', () => {
    const before = getItem(env.db, env.setup.tenantId, para);
    updateItem(env.db, env.ctx(admin), para, {
      ...itemInput({ reorderLevelBase: 2_000 }),
      expectedVersion: before.version,
    });
    const all = listStock(env.db, env.ctx(admin), {});
    expect(all.total).toBe(2);
    const row = all.rows.find((r) => r.itemId === para);
    expect(row).toMatchObject({
      onHandBase: 1_500,
      sellableBase: 1_500,
      expiredBase: 0,
      low: true,
      nearestExpiry: '2026-12-31',
    });
    expect(listStock(env.db, env.ctx(admin), { q: 'trama' }).rows.map((r) => r.itemId)).toEqual([
      tramadol,
    ]);
    expect(
      listStock(env.db, env.ctx(admin), { onlyInStock: true }).rows.map((r) => r.itemId),
    ).toEqual([para]);
    expect(
      listStock(env.db, env.ctx(admin), { lowOnly: true }).rows.map((r) => r.itemId),
    ).toContain(tramadol);
    expect(stockValueMinor(env.db, env.setup.branchId)).toBe(500 * 180 + 1_000 * 200);
  });

  it('counts expired stock separately and never as sellable', () => {
    env.clock.ms = Date.parse('2027-01-10T09:00:00Z'); // batch A1 expired on 2026-12-31
    const row = listStock(env.db, env.ctx(admin), {}).rows.find((r) => r.itemId === para);
    expect(row).toMatchObject({ onHandBase: 1_500, expiredBase: 500, sellableBase: 1_000 });
  });
});

describe('sale', () => {
  it('needs an open shift', async () => {
    const other = await env.addUser(admin, 'cashier2', 'cashier');
    await expectDomain(() => createSale(env.db, env.ctx(other), saleInput()), 'SHIFT_REQUIRED');
  });

  it('prices, takes stock first-expiry-first from the right batch at batch cost, and gives change', () => {
    const res = sell();
    expect(res).toMatchObject({
      docNo: 'KHI01-INV-000001',
      grossMinor: 5_000,
      grandTotalMinor: 5_000,
      paidMinor: 5_000,
      changeMinor: 5_000,
      dueMinor: 0,
      costMinor: 3_600,
      profitMinor: 1_400,
    });
    expect(res.lines[0]?.batches).toEqual([
      {
        batchId: (stockOf(para).find((b) => b.batchNo === 'A1') as { id: string }).id,
        qtyBase: 20,
        costUnitMicro: 1_800_000,
      },
    ]);
    expect(onHand(para)).toBe(1_480);
    const sale = env.db.select().from(sales).get();
    expect(sale?.status).toBe('posted');
    expect(
      env.db
        .select()
        .from(stockMovements)
        .where(eq(stockMovements.docType, 'sale'))
        .all()
        .map((m) => m.qtyBase),
    ).toEqual([-20]);
  });

  it('sells across batches when the first runs out, each at its own cost', () => {
    const res = sell({
      lines: [{ itemId: para, unitId: unitId.box as string, qty: 6 }],
      payments: [{ modeId: modeId.cash as string, amountMinor: 200_000 }],
    });
    // 600 tablets: 500 from A1 (1.80) and 100 from B1 (2.00)
    expect(res.lines[0]?.batches.map((b) => b.qtyBase)).toEqual([500, 100]);
    expect(res.costMinor).toBe(500 * 180 + 100 * 200);
    expect(onHand(para)).toBe(900);
  });

  it('a hand-picked batch is used first, but expired or unknown batches are refused', async () => {
    const b1 = stockOf(para).find((b) => b.batchNo === 'B1') as { id: string };
    const res = sell({
      lines: [{ itemId: para, unitId: unitId.strip as string, qty: 1, batchId: b1.id }],
    });
    expect(res.lines[0]?.batches[0]?.batchId).toBe(b1.id);
    env.clock.ms = Date.parse('2027-01-10T09:00:00Z');
    const a1 = stockOf(para).find((b) => b.batchNo === 'A1') as { id: string };
    await expectDomain(
      () =>
        sell({ lines: [{ itemId: para, unitId: unitId.strip as string, qty: 1, batchId: a1.id }] }),
      'EXPIRED_BATCH',
    );
    await expectDomain(
      () =>
        sell({
          lines: [{ itemId: para, unitId: unitId.strip as string, qty: 1, batchId: 'nope' }],
        }),
      'INVALID',
    );
  });

  it('never sells expired stock: once the first batch expires, sales come from the next one', () => {
    env.clock.ms = Date.parse('2027-01-10T09:00:00Z');
    const res = sell({ lines: [{ itemId: para, unitId: unitId.strip as string, qty: 1 }] });
    expect(res.lines[0]?.batches[0]?.costUnitMicro).toBe(2_000_000);
    const only = stockOf(para)
      .filter((b) => b.expiryDate >= '2027-01-10')
      .reduce((s, b) => s + b.available, 0);
    expect(only).toBe(990);
  });

  it('refuses when stock is not enough and saves nothing, not even a document number', async () => {
    const movesBefore = ledgerCount();
    await expectDomain(
      () =>
        sell({
          lines: [{ itemId: para, unitId: unitId.box as string, qty: 16 }],
          payments: [{ modeId: modeId.cash as string, amountMinor: 999_999 }],
        }),
      'INSUFFICIENT_STOCK',
    );
    expect(ledgerCount()).toBe(movesBefore);
    expect(env.db.select({ n: count() }).from(sales).get()?.n).toBe(0);
    expect(sell().docNo).toBe('KHI01-INV-000001'); // the failed attempt did not burn a number
  });

  it('two lines of one item cannot take the same units twice', async () => {
    await expectDomain(
      () =>
        sell({
          lines: [
            { itemId: para, unitId: unitId.box as string, qty: 8 },
            { itemId: para, unitId: unitId.box as string, qty: 8 },
          ],
          payments: [{ modeId: modeId.cash as string, amountMinor: 999_999 }],
        }),
      'INSUFFICIENT_STOCK',
    );
  });

  it('retrying the same request key returns the same sale and posts nothing twice', () => {
    const input = saleInput();
    const first = createSale(env.db, env.ctx(cashier), input);
    const movesAfterFirst = ledgerCount();
    const again = createSale(env.db, env.ctx(cashier), input);
    expect(again).toMatchObject({ id: first.id, docNo: first.docNo, replay: true });
    expect(ledgerCount()).toBe(movesAfterFirst);
    expect(env.db.select({ n: count() }).from(sales).get()?.n).toBe(1);
  });

  it('handles split payment with change only on cash, and refuses wallet above the bill', async () => {
    const res = sell({
      payments: [
        { modeId: modeId.wallet as string, amountMinor: 2_000, reference: 'TX-1' },
        { modeId: modeId.cash as string, amountMinor: 5_000 },
      ],
    });
    expect(res).toMatchObject({ paidMinor: 5_000, changeMinor: 2_000 });
    await expectDomain(
      () => sell({ payments: [{ modeId: modeId.wallet as string, amountMinor: 6_000 }] }),
      'INVALID',
    );
    await expectDomain(
      () => sell({ payments: [{ modeId: modeId.cash as string, amountMinor: 1_000 }] }),
      'INVALID',
    ); // short, not on account
    await expectDomain(
      () => sell({ payments: [{ modeId: 'nope', amountMinor: 5_000 }] }),
      'INVALID',
    );
  });

  it('sells on account only to a registered customer within their credit limit', async () => {
    const { createCustomer } = await import('./lookups');
    const c = createCustomer(env.db, env.ctx(admin), {
      name: 'Credit Customer',
      phone: '0300-1112223',
      creditLimitMinor: 10_000,
    });
    const onAccount = {
      payments: [
        { modeId: modeId.cash as string, amountMinor: 1_000 },
        { modeId: modeId.credit as string, amountMinor: 4_000 },
      ],
    };
    const ok = sell({ ...onAccount, customerId: c.id });
    expect(ok).toMatchObject({ paidMinor: 1_000, dueMinor: 4_000 });
    await expectDomain(() => sell({ ...onAccount }), 'INVALID'); // walk-in
    await expectDomain(
      () =>
        sell({
          lines: [{ itemId: para, unitId: unitId.box as string, qty: 1 }],
          payments: [{ modeId: modeId.credit as string, amountMinor: 1 }],
          customerId: c.id,
        }),
      'INVALID',
    ); // above limit
  });

  it('a discount above the cashier limit needs a manager, and the approval is single use', async () => {
    const tenPercent = { billDiscount: { kind: 'percent' as const, bp: 1_000 } };
    await expectDomain(() => sell(tenPercent), 'OVERRIDE_REQUIRED');
    const { overrideId } = await grantOverride(env.db, env.ctx(cashier), {
      requesterId: cashier,
      approverUsername: 'mgr1',
      approverPin: '482913',
      kind: 'discount',
      percentBp: 1_000,
    });
    const res = sell({ ...tenPercent, discountOverrideId: overrideId });
    expect(res).toMatchObject({ discountMinor: 500, grandTotalMinor: 4_500 });
    await expectDomain(
      () => sell({ ...tenPercent, discountOverrideId: overrideId }),
      'OVERRIDE_INVALID',
    );
    expect(
      env.db
        .select()
        .from(auditLog)
        .all()
        .some((a) => a.action === 'override.used'),
    ).toBe(true);
  });

  it('a small discount within the limit needs no approval', () => {
    expect(sell({ billDiscount: { kind: 'percent', bp: 500 } })).toMatchObject({
      discountMinor: 250,
      grandTotalMinor: 4_750,
    });
  });

  it('changing the price needs approval, and selling below cost always does', async () => {
    const cheaper = {
      lines: [
        { itemId: para, unitId: unitId.strip as string, qty: 2, rateUnitMicro: rate('2.30') },
      ],
    };
    await expectDomain(() => sell(cheaper), 'OVERRIDE_REQUIRED');
    const ok = await grantOverride(env.db, env.ctx(cashier), {
      requesterId: cashier,
      approverUsername: 'mgr1',
      approverPin: '482913',
      kind: 'override_price',
      percentBp: 800,
    });
    expect(sell({ ...cheaper, priceOverrideId: ok.overrideId }).grossMinor).toBe(4_600);

    const belowCost = {
      lines: [
        { itemId: para, unitId: unitId.strip as string, qty: 2, rateUnitMicro: rate('1.00') },
      ],
    };
    await expectDomain(() => sell(belowCost), 'OVERRIDE_REQUIRED');
    const boss = await grantOverride(env.db, env.ctx(cashier), {
      requesterId: cashier,
      approverUsername: 'admin',
      approverPin: '246813',
      kind: 'override_price',
      percentBp: 6_000,
    });
    const loss = sell({ ...belowCost, priceOverrideId: boss.overrideId });
    expect(loss.profitMinor).toBeLessThan(0);
  });

  it('a controlled item needs patient name, CNIC and doctor, and is written to the narcotic register', async () => {
    receive([
      grnLine(tramadol, {
        batchNo: 'T1',
        expiryDate: '2027-03-31',
        qty: 10,
        unitPriceMicro: rate('100'),
      }),
    ]);
    const line = { itemId: tramadol, unitId: unitId.strip as string, qty: 1 };
    await expectDomain(
      () =>
        sell({
          lines: [line],
          payments: [{ modeId: modeId.cash as string, amountMinor: 200_000 }],
        }),
      'INVALID',
    );
    await expectDomain(
      () =>
        sell({
          lines: [
            {
              ...line,
              narcotic: { patientName: 'Test Patient', patientCnic: '123', doctorName: 'Dr Test' },
            },
          ],
          payments: [{ modeId: modeId.cash as string, amountMinor: 200_000 }],
        }),
      'INVALID',
    );
    const res = sell({
      lines: [
        {
          ...line,
          narcotic: {
            patientName: 'Test Patient',
            patientCnic: '42101-1234567-1',
            doctorName: 'Dr Test',
            prescriptionRef: 'RX-1',
          },
        },
      ],
      payments: [{ modeId: modeId.cash as string, amountMinor: 200_000 }],
    });
    const reg = env.db.select().from(narcoticRegister).all();
    expect(reg).toHaveLength(1);
    expect(reg[0]).toMatchObject({
      saleId: res.id,
      patientName: 'Test Patient',
      qtyBase: 10,
      soldBy: cashier,
    });
  });

  it('applies tax and the rupee rounding setting on the bill', () => {
    setSetting(env.db, env.ctx(admin), 'pos.rounding', 'rupee');
    const before = getItem(env.db, env.setup.tenantId, para);
    updateItem(env.db, env.ctx(admin), para, {
      ...itemInput({ taxBp: 1_800 }),
      expectedVersion: before.version,
    });
    const res = sell({
      lines: [{ itemId: para, unitId: unitId.strip as string, qty: 3 }],
      payments: [{ modeId: modeId.cash as string, amountMinor: 10_000 }],
    });
    expect(res.taxMinor).toBe(1_350); // 18% of 75.00
    expect(res.grandTotalMinor).toBe(8_900); // 88.50 rounds half up to 89.00
    expect(res.roundingMinor).toBe(50);
    expect(res.paidMinor).toBe(8_900);
  });

  it('allows selling below zero only for items that permit it, recording the shortage on a valid batch', () => {
    const v = getItem(env.db, env.setup.tenantId, para);
    updateItem(env.db, env.ctx(admin), para, {
      ...itemInput({ allowNegativeStock: true }),
      expectedVersion: v.version,
    });
    const res = sell({
      lines: [{ itemId: para, unitId: unitId.box as string, qty: 16 }],
      payments: [{ modeId: modeId.cash as string, amountMinor: 999_999 }],
    });
    expect(res.grandTotalMinor).toBe(400_000);
    expect(onHand(para)).toBe(-100);
  });

  it('keeps the ledger, audit chain and outbox consistent after many sales', () => {
    for (let i = 0; i < 12; i++)
      sell({ lines: [{ itemId: para, unitId: unitId.strip as string, qty: 1 + (i % 3) }] });
    const expected = 1_500 - 10 * [1, 2, 3].reduce((s, n) => s + n * 4, 0);
    expect(onHand(para)).toBe(expected);
    expect(verifyAuditChain(env.db, env.setup.branchId).ok).toBe(true);
    expect(
      env.db.select({ n: count() }).from(syncOutbox).where(eq(syncOutbox.entityType, 'sales')).get()
        ?.n,
    ).toBe(12);
    const one = JSON.parse(
      env.db.select().from(syncOutbox).where(eq(syncOutbox.entityType, 'sales')).all()[0]
        ?.payloadJson ?? '{}',
    ) as { lines: unknown[]; payments: unknown[]; movements: unknown[] };
    expect(one.lines.length && one.payments.length && one.movements.length).toBeTruthy();
  });
});

describe('rounding setting', () => {
  it('defaults to the nearest whole rupee for a branch that never changed it, and can be changed', async () => {
    const fresh = await createTestEnv();
    try {
      expect(getPosRounding(fresh.db, fresh.ctx(fresh.setup.adminUserId))).toBe('rupee');
      setSetting(fresh.db, fresh.ctx(fresh.setup.adminUserId), 'pos.rounding', 'half_rupee');
      expect(getPosRounding(fresh.db, fresh.ctx(fresh.setup.adminUserId))).toBe('half_rupee');
      expect(() =>
        setSetting(fresh.db, fresh.ctx(fresh.setup.adminUserId), 'pos.rounding', 'banana'),
      ).toThrow();
    } finally {
      fresh.cleanup();
    }
  });

  it('rounds a sale total to the rupee and records the rounding on its own line', () => {
    setSetting(env.db, env.ctx(admin), 'pos.rounding', 'rupee');
    const res = sell({ billDiscount: { kind: 'percent', bp: 500 } }); // 50.00 - 2.50 = 47.50 -> 48.00
    expect(res).toMatchObject({ discountMinor: 250, roundingMinor: 50, grandTotalMinor: 4_800 });
  });
});

describe('void and return', () => {
  it('a cashier needs a manager to void; the invoice stays in the books marked void and stock comes back', async () => {
    const res = sell();
    await expectDomain(
      () => voidSale(env.db, env.ctx(cashier), { saleId: res.id, reason: 'Customer left' }),
      'OVERRIDE_REQUIRED',
    );
    const { overrideId } = await grantOverride(env.db, env.ctx(cashier), {
      requesterId: cashier,
      approverUsername: 'mgr1',
      approverPin: '482913',
      kind: 'void',
      amountMinor: res.grandTotalMinor,
      reason: 'Customer left',
    });
    voidSale(env.db, env.ctx(cashier), { saleId: res.id, reason: 'Customer left', overrideId });
    const s = getSale(env.db, env.setup.tenantId, res.id);
    expect(s.status).toBe('void');
    expect(s.voidReason).toBe('Customer left');
    expect(onHand(para)).toBe(1_500);
    expect(listSales(env.db, env.setup.branchId).rows.map((r) => r.status)).toEqual(['void']);
    await expectDomain(
      () => voidSale(env.db, env.ctx(admin), { saleId: res.id, reason: 'again' }),
      'CONFLICT',
    );
  });

  it('refuses a void needing a reason and a void from a closed shift (use a return)', async () => {
    const res = sell();
    await expectDomain(
      () => voidSale(env.db, env.ctx(admin), { saleId: res.id, reason: 'x' }),
      'INVALID',
    );
    closeShift(env.db, env.ctx(cashier), { shiftId: cashierShift, countedCashMinor: 505_000 });
    await expectDomain(
      () => voidSale(env.db, env.ctx(admin), { saleId: res.id, reason: 'Wrong invoice' }),
      'CONFLICT',
    );
  });

  it('posted invoices cannot be edited or deleted, even with direct database access', () => {
    const res = sell();
    expect(() =>
      env.db.update(sales).set({ grandTotalMinor: 1 }).where(eq(sales.id, res.id)).run(),
    ).toThrow(/immutable/);
    expect(() => env.db.delete(sales).where(eq(sales.id, res.id)).run()).toThrow(/never deleted/);
    expect(() => env.db.update(saleLines).set({ netMinor: 1 }).run()).toThrow(/immutable/);
    expect(() => env.db.delete(saleLines).run()).toThrow(/immutable/);
    expect(() => env.db.update(stockMovements).set({ qtyBase: 999 }).run()).toThrow(/append-only/);
    expect(() => env.db.delete(stockMovements).run()).toThrow(/append-only/);
  });

  it('partial return: restocks the batch it came from, refunds in proportion, and cannot exceed what was sold', async () => {
    const res = sell({ lines: [{ itemId: para, unitId: unitId.strip as string, qty: 3 }] }); // 30 tablets, 75.00
    const line = env.db.select().from(saleLines).get() as { id: string };
    const r = createReturn(env.db, env.ctx(cashier), {
      saleId: res.id,
      lines: [{ saleLineId: line.id, qtyBase: 10, restock: true }],
      reasonCode: 'wrong_item',
      refundModeId: modeId.cash as string,
    });
    expect(r.refundMinor).toBe(2_500);
    expect(onHand(para)).toBe(1_500 - 30 + 10);
    expect(stockOf(para).find((b) => b.batchNo === 'A1')?.available).toBe(500 - 20);
    await expectDomain(
      () =>
        createReturn(env.db, env.ctx(cashier), {
          saleId: res.id,
          lines: [{ saleLineId: line.id, qtyBase: 21, restock: true }],
          reasonCode: 'wrong_item',
          refundModeId: modeId.cash as string,
        }),
      'INVALID',
    );
    const second = createReturn(env.db, env.ctx(cashier), {
      saleId: res.id,
      lines: [{ saleLineId: line.id, qtyBase: 20, restock: true }],
      reasonCode: 'damaged',
      refundModeId: modeId.cash as string,
    });
    expect(second.refundMinor).toBe(5_000);
    await expectDomain(
      () =>
        createReturn(env.db, env.ctx(cashier), {
          saleId: res.id,
          lines: [{ saleLineId: line.id, qtyBase: 1, restock: true }],
          reasonCode: 'wrong_item',
          refundModeId: modeId.cash as string,
        }),
      'INVALID',
    );
  });

  it('a damaged return is refunded but not put back on the shelf', () => {
    const res = sell();
    const line = env.db.select().from(saleLines).get() as { id: string };
    createReturn(env.db, env.ctx(cashier), {
      saleId: res.id,
      lines: [{ saleLineId: line.id, qtyBase: 10, restock: false }],
      reasonCode: 'damaged',
      refundModeId: modeId.cash as string,
    });
    expect(onHand(para)).toBe(1_500 - 20);
  });

  it('a refund above the role limit needs a manager; reasons are mandatory; void invoices cannot be returned', async () => {
    receive([
      grnLine(tramadol, {
        batchNo: 'T2',
        expiryDate: '2027-03-31',
        qty: 5,
        unitPriceMicro: rate('100'),
      }),
    ]);
    const big = sell({
      lines: [
        {
          itemId: tramadol,
          unitId: unitId.strip as string,
          qty: 3,
          narcotic: {
            patientName: 'Test Patient',
            patientCnic: '42101-1234567-1',
            doctorName: 'Dr Test',
          },
        },
      ],
      payments: [{ modeId: modeId.cash as string, amountMinor: 500_000 }],
    }); // 30 tablets x 12 = 360.00... cashier refund limit is 2,000.00
    const line = env.db.select().from(saleLines).where(eq(saleLines.saleId, big.id)).get() as {
      id: string;
    };
    const refundAll = {
      saleId: big.id,
      lines: [{ saleLineId: line.id, qtyBase: 30, restock: true }],
      reasonCode: 'wrong_item' as const,
      refundModeId: modeId.cash as string,
    };
    expect(createReturn(env.db, env.ctx(cashier), refundAll).refundMinor).toBe(36_000); // within the limit
    await expectDomain(
      () => createReturn(env.db, env.ctx(cashier), { ...refundAll, reasonCode: 'other' }),
      'INVALID',
    );
    const res = sell();
    const l2 = env.db.select().from(saleLines).where(eq(saleLines.saleId, res.id)).get() as {
      id: string;
    };
    voidSale(env.db, env.ctx(admin), { saleId: res.id, reason: 'Entered twice' });
    await expectDomain(
      () =>
        createReturn(env.db, env.ctx(cashier), {
          saleId: res.id,
          lines: [{ saleLineId: l2.id, qtyBase: 1, restock: true }],
          reasonCode: 'wrong_item',
          refundModeId: modeId.cash as string,
        }),
      'CONFLICT',
    );
  });
});

describe('shifts', () => {
  it('one open shift per user; cash expected = float + cash sales - cash refunds; blind count shows variance', async () => {
    await expectDomain(() => openShift(env.db, env.ctx(cashier), { floatMinor: 0 }), 'CONFLICT');
    sell(); // 50.00 cash, change given
    sell({ payments: [{ modeId: modeId.wallet as string, amountMinor: 5_000 }] }); // wallet: not cash
    const first = env.db.select().from(sales).all()[0] as { id: string };
    const line = env.db.select().from(saleLines).where(eq(saleLines.saleId, first.id)).get() as {
      id: string;
    };
    createReturn(env.db, env.ctx(cashier), {
      saleId: first.id,
      lines: [{ saleLineId: line.id, qtyBase: 10, restock: true }],
      reasonCode: 'wrong_item',
      refundModeId: modeId.cash as string,
    }); // -25.00
    expect(expectedCashMinor(env.db, cashierShift)).toBe(500_000 + 5_000 - 2_500);
    const closed = closeShift(env.db, env.ctx(cashier), {
      shiftId: cashierShift,
      countedCashMinor: 502_000,
    });
    expect(closed).toMatchObject({
      expectedCashMinor: 502_500,
      countedCashMinor: 502_000,
      varianceMinor: -500,
    });
    await expectDomain(
      () => closeShift(env.db, env.ctx(cashier), { shiftId: cashierShift, countedCashMinor: 0 }),
      'CONFLICT',
    );
    await expectDomain(() => sell(), 'SHIFT_REQUIRED');
  });

  it('a voided sale is taken out of the expected cash', async () => {
    const res = sell();
    voidSale(env.db, env.ctx(admin), { saleId: res.id, reason: 'Wrong patient' });
    expect(expectedCashMinor(env.db, cashierShift)).toBe(500_000);
  });
});

describe('holds, missed sales and summary', () => {
  it('parks a cart that any counter of the branch can resume, and deletes it with an audit entry', () => {
    const id = holdInvoice(env.db, env.ctx(cashier), {
      label: 'Mrs Test',
      payload: { lines: [{ itemId: para, qty: 2 }] },
    });
    expect(listHolds(env.db, env.setup.branchId)).toHaveLength(1);
    expect(getHold(env.db, env.setup.branchId, id).payload).toEqual({
      lines: [{ itemId: para, qty: 2 }],
    });
    holdInvoice(env.db, env.ctx(cashier), { id, payload: { lines: [] }, label: 'Updated' });
    expect(listHolds(env.db, env.setup.branchId)[0]).toMatchObject({
      label: 'Updated',
      version: 2,
    });
    deleteHold(env.db, env.ctx(admin), id);
    expect(listHolds(env.db, env.setup.branchId)).toHaveLength(0);
    expect(
      env.db
        .select()
        .from(auditLog)
        .all()
        .some((a) => a.action === 'hold.delete'),
    ).toBe(true);
  });

  it('records a missed sale for an item or free text', async () => {
    expect(
      recordMissedSale(env.db, env.ctx(cashier), {
        itemId: para,
        qty: 3,
        customerPhone: '0300-0000000',
      }),
    ).toBeTruthy();
    expect(
      recordMissedSale(env.db, env.ctx(cashier), { itemText: 'Some new syrup', qty: 1 }),
    ).toBeTruthy();
    await expectDomain(() => recordMissedSale(env.db, env.ctx(cashier), { qty: 1 }), 'INVALID');
    await expectDomain(
      () => recordMissedSale(env.db, env.ctx(cashier), { itemText: 'x', qty: 0 }),
      'INVALID',
    );
  });

  it('summarises revenue, cost and gross profit for the dashboard, voids counted apart', () => {
    sell();
    sell({ lines: [{ itemId: para, unitId: unitId.strip as string, qty: 1 }] });
    const bad = sell();
    voidSale(env.db, env.ctx(admin), { saleId: bad.id, reason: 'Entered twice' });
    const s = salesSummary(
      env.db,
      env.setup.branchId,
      '2026-10-05T00:00:00.000Z',
      '2026-10-05T23:59:59.999Z',
    );
    expect(s).toMatchObject({
      salesCount: 2,
      revenueMinor: 7_500,
      costMinor: 5_400,
      grossProfitMinor: 2_100,
      voidCount: 1,
    });
  });
});
