import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRateToMicro } from '@mediescare/core';
import { DomainError } from '../errors';
import { createItem, type ItemInput } from '../pharmacy/catalog';
import { createSupplier } from '../pharmacy/lookups';
import {
  createReturn,
  createSale,
  openShift,
  recordMissedSale,
  voidSale,
  type CreateSaleInput,
  type SaleResult,
} from '../pharmacy/pos';
import { receiveGrn, stockValueMinor, type GrnLineInput } from '../pharmacy/stock';
import { paymentModes, saleLines, units } from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { applyColumnRights, REPORTS, runReport, type ReportResult } from './index';

const rate = parseRateToMicro;
const DAY = 86_400_000;
const DAY1 = Date.parse('2026-10-05T09:00:00.000Z');

let env: TestEnv;
let admin: string;
let cashier: string;
let supplierId: string;
let unitId: Record<string, string>;
let modeId: Record<string, string>;
let para: string;
let tramadol: string;

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
    ],
    barcodes: [],
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

const receive = (lines: GrnLineInput[]) =>
  receiveGrn(env.db, env.ctx(admin), { supplierId, lines });

let keySeq = 0;
/** Sell `strips` of paracetamol (25.00 a strip, cost 18.00). */
function sell(strips: number, user = cashier, over: Partial<CreateSaleInput> = {}): SaleResult {
  return createSale(env.db, env.ctx(user), {
    idempotencyKey: `report-${(keySeq += 1)}`,
    lines: [{ itemId: para, unitId: unitId.strip as string, qty: strips }],
    payments: [{ modeId: modeId.cash as string, amountMinor: 10_000_000 }],
    ...over,
  });
}

const run = (id: string, filters: Parameters<typeof runReport>[3] = {}): ReportResult =>
  runReport(env.db, env.ctx(admin), id, filters);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

beforeEach(async () => {
  env = await createTestEnv();
  admin = env.setup.adminUserId;
  cashier = await env.addUser(admin, 'cashier1', 'cashier', { pin: '135791' });
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
      isNarcotic: true,
      retailRateUnitMicro: rate('12'),
    }),
  );
  receive([
    grnLine(para, { batchNo: 'A1', qty: 50, unitPriceMicro: rate('18') }),
    grnLine(para, {
      batchNo: 'B1',
      expiryDate: '2027-06-30',
      qty: 100,
      unitPriceMicro: rate('18'),
    }),
  ]);
  openShift(env.db, env.ctx(cashier), { floatMinor: 500_000 });
  openShift(env.db, env.ctx(admin), { floatMinor: 0 });
});
afterEach(() => env.cleanup());

describe('sales reports', () => {
  it('daily sales: voids are left out, returns are taken off on their own day, sums match', () => {
    const s1 = sell(2);
    const s2 = sell(3, admin, {
      lines: [{ itemId: para, unitId: unitId.strip as string, qty: 3, discountMinor: 500 }],
    });
    const gone = sell(1);
    voidSale(env.db, env.ctx(admin), { saleId: gone.id, reason: 'Customer left' });
    env.clock.ms = DAY1 + DAY;
    const s4 = sell(4);
    const line = env.db.select().from(saleLines).where(eq(saleLines.saleId, s4.id)).get();
    const ret = createReturn(env.db, env.ctx(cashier), {
      saleId: s4.id,
      lines: [{ saleLineId: line?.id as string, qtyBase: 10, restock: true }],
      reasonCode: 'wrong_item',
      refundModeId: modeId.cash as string,
    });
    expect(ret.refundMinor).toBe(2_500);

    const r = run('sales-daily', { from: '2026-10-05', to: '2026-10-06' });
    expect(r.rows.map((x) => x.date)).toEqual(['2026-10-05', '2026-10-06']);
    expect(r.rows[0]).toMatchObject({
      invoices: 2,
      voids: 1,
      billed: s1.grandTotalMinor + s2.grandTotalMinor,
      discount: s1.discountMinor + s2.discountMinor,
      netRevenue: s1.grandTotalMinor + s2.grandTotalMinor,
      cost: s1.costMinor + s2.costMinor,
      profit: s1.profitMinor + s2.profitMinor,
      returns: 0,
    });
    expect(s2.discountMinor).toBe(500);
    // Day two: 4 strips sold (100.00, cost 72.00), 1 strip returned (25.00, cost 18.00 back on the shelf).
    expect(r.rows[1]).toMatchObject({
      invoices: 1,
      voids: 0,
      billed: 10_000,
      returns: 2_500,
      netRevenue: 7_500,
      cost: 5_400,
      profit: 2_100,
    });
    expect(r.totals?.profit).toBe(s1.profitMinor + s2.profitMinor + 2_100);
    expect(r.totals?.invoices).toBe(3);
    expect(run('sales-daily', { from: '2026-10-05', to: '2026-10-05' }).rows).toHaveLength(1);
  });

  it('puts a sale after 19:00 UTC on the next Karachi day and respects the range bounds', () => {
    env.clock.ms = Date.parse('2026-10-05T20:30:00.000Z'); // 01:30 on 6 Oct in Karachi
    const late = sell(1);
    const day5 = run('sales-daily', { from: '2026-10-05', to: '2026-10-05' });
    const day6 = run('sales-daily', { from: '2026-10-06', to: '2026-10-06' });
    expect(day5.rows).toHaveLength(0);
    expect(day6.rows[0]).toMatchObject({ date: '2026-10-06', billed: late.grandTotalMinor });
    const list = run('sales-invoices', { from: '2026-10-06', to: '2026-10-06' });
    expect(list.rows[0]?.time).toBe('2026-10-06 01:30');
  });

  it('rejects bad dates and unknown reports', () => {
    expect(() => run('sales-daily', { from: '2026-13-40' })).toThrow(DomainError);
    expect(() => run('sales-daily', { from: '2026-10-09', to: '2026-10-01' })).toThrow(/after/);
    expect(() => run('nope')).toThrow(/not found/);
  });

  it('invoice list, itemwise, cashier, payment mode and discounts agree with the invoices', () => {
    const s1 = sell(2);
    const s2 = sell(3, admin, {
      lines: [{ itemId: para, unitId: unitId.strip as string, qty: 3, discountMinor: 500 }],
      payments: [
        { modeId: modeId.card as string, amountMinor: 3_000 },
        { modeId: modeId.cash as string, amountMinor: 10_000 },
      ],
    });
    const gone = sell(1);
    voidSale(env.db, env.ctx(admin), { saleId: gone.id, reason: 'Customer left' });
    const f = { from: '2026-10-05', to: '2026-10-05' };

    const inv = run('sales-invoices', f);
    expect(inv.rows).toHaveLength(3);
    expect(inv.rows.map((r) => r.status).sort()).toEqual(['Posted', 'Posted', 'Void']);
    expect(inv.totals?.total).toBe(s1.grandTotalMinor + s2.grandTotalMinor);
    expect(inv.rows.find((r) => r.docNo === s2.docNo)?.modes).toContain('Card');
    expect(run('sales-invoices', { ...f, q: s1.docNo.slice(-4) }).rows.length).toBeGreaterThan(0);
    expect(run('sales-invoices', { ...f, limit: 1 })).toMatchObject({ truncated: true });

    const items = run('sales-by-item', f);
    expect(items.rows).toHaveLength(1);
    expect(items.rows[0]).toMatchObject({ item: 'Paracetamol 500mg', qty: 50 });
    expect(items.totals?.revenue).toBe(s1.grandTotalMinor + s2.grandTotalMinor);
    expect(items.totals?.profit).toBe(s1.profitMinor + s2.profitMinor);
    expect(run('sales-by-item', { ...f, q: 'zzzz' }).rows).toHaveLength(0);
    expect(run('sales-by-item', { ...f, q: 'parac' }).rows).toHaveLength(1);

    const byCashier = run('sales-by-cashier', f);
    const cash = byCashier.rows.find((r) => r.cashier === 'Test cashier1');
    expect(cash).toMatchObject({ invoices: 1, billed: s1.grandTotalMinor, voids: 1 });
    expect(byCashier.totals?.billed).toBe(s1.grandTotalMinor + s2.grandTotalMinor);

    const modes = run('sales-by-payment-mode', f);
    expect(modes.rows.find((r) => r.mode === 'Card')?.received).toBe(3_000);
    expect(modes.totals?.received).toBe(s1.grandTotalMinor + s2.grandTotalMinor);

    const disc = run('discounts', f);
    expect(disc.rows).toHaveLength(1);
    expect(disc.rows[0]).toMatchObject({ docNo: s2.docNo, discount: 500, gross: 7_500 });
    expect(disc.rows[0]?.discountPct).toBe(6.67);
  });

  it('a few hundred sales over several days add up exactly', () => {
    receive([grnLine(para, { batchNo: 'BIG', expiryDate: '2028-01-31', qty: 2_000 })]);
    const perDay = new Map<string, { n: number; billed: number; cost: number; profit: number }>();
    let seed = 7;
    for (let i = 0; i < 300; i += 1) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      env.clock.ms = DAY1 + Math.floor(i / 100) * DAY + (i % 100) * 60_000;
      const s = sell(1 + (seed % 3));
      const date = new Date(env.clock.ms + 5 * 3_600_000).toISOString().slice(0, 10);
      const d = perDay.get(date) ?? { n: 0, billed: 0, cost: 0, profit: 0 };
      d.n += 1;
      d.billed += s.grandTotalMinor;
      d.cost += s.costMinor;
      d.profit += s.profitMinor;
      perDay.set(date, d);
    }
    const r = run('sales-daily', { from: '2026-10-05', to: '2026-10-07' });
    expect(r.rows).toHaveLength(3);
    for (const row of r.rows) {
      const want = perDay.get(String(row.date));
      expect(row).toMatchObject({
        invoices: want?.n,
        billed: want?.billed,
        cost: want?.cost,
        profit: want?.profit,
      });
    }
    const all = [...perDay.values()];
    expect(r.totals?.invoices).toBe(300);
    expect(r.totals?.billed).toBe(sum(all.map((d) => d.billed)));
    const pl = run('profit-loss', { from: '2026-10-05', to: '2026-10-07' });
    expect(pl.totals?.profit).toBe(sum(all.map((d) => d.profit)));
    expect(pl.totals?.netRevenue).toBe(sum(all.map((d) => d.billed)));
    const list = run('sales-invoices', { from: '2026-10-05', to: '2026-10-07', limit: 1000 });
    expect(list.rows).toHaveLength(300);
    expect(list.truncated).toBe(false);
  });
});

describe('stock and expiry reports', () => {
  it('current stock and valuation match the ledger', () => {
    sell(2);
    const cur = run('stock-current');
    expect(cur.rows).toHaveLength(1);
    expect(cur.rows[0]).toMatchObject({
      item: 'Paracetamol 500mg',
      onHand: 1_480,
      sellable: 1_480,
      expired: 0,
    });
    expect(cur.totals?.costValueMinor).toBe(stockValueMinor(env.db, env.setup.branchId));
    expect(run('stock-current', { q: 'trama' }).rows).toHaveLength(0);
    const val = run('stock-valuation');
    expect(val.rows[0]).toMatchObject({
      category: 'No category',
      qty: 1_480,
      retailValueMinor: 1_480 * 250,
    });
    expect(val.totals?.costValueMinor).toBe(stockValueMinor(env.db, env.setup.branchId));
  });

  it('expiry buckets batches, marks expired ones and filters by bucket', () => {
    receive([
      grnLine(para, { batchNo: 'C1', expiryDate: '2026-10-20', qty: 1 }),
      grnLine(para, { batchNo: 'D1', expiryDate: '2026-11-20', qty: 2 }),
      grnLine(para, { batchNo: 'E1', expiryDate: '2027-02-15', qty: 3 }),
      grnLine(para, { batchNo: 'F1', expiryDate: '2026-10-10', qty: 4 }),
    ]);
    env.clock.ms = Date.parse('2026-10-12T09:00:00.000Z');
    const all = run('expiry');
    const bucketOf = (b: string) => all.rows.find((r) => r.batchNo === b)?.bucket;
    expect(bucketOf('F1')).toBe('Expired');
    expect(bucketOf('C1')).toBe('0-30 days');
    expect(bucketOf('D1')).toBe('31-60 days');
    expect(bucketOf('A1')).toBe('61-90 days');
    expect(bucketOf('E1')).toBe('91-180 days');
    expect(bucketOf('B1')).toBeUndefined(); // beyond 180 days
    expect(all.rows.find((r) => r.batchNo === 'F1')).toMatchObject({ daysLeft: -2, qty: 40 });
    expect(all.rows.map((r) => r.expiryDate)).toEqual(
      [...all.rows.map((r) => r.expiryDate)].sort(),
    );
    expect(run('expiry', { bucket: 'expired' }).rows.map((r) => r.batchNo)).toEqual(['F1']);
    expect(run('expiry', { bucket: '31-60' }).rows.map((r) => r.batchNo)).toEqual(['D1']);
    expect(run('expiry', { bucket: 'expired' }).kpis?.[0]?.value).toBe(1);
    expect(run('expiry', { q: 'nothing-like-this' }).rows).toHaveLength(0);
  });

  it('low stock lists items under their reorder level and out-of-stock items customers asked for', () => {
    const amox = createItem(
      env.db,
      env.ctx(admin),
      itemInput({ name: 'Amoxicillin 500mg', genericName: 'Amoxicillin', reorderLevelBase: 100 }),
    );
    receive([grnLine(amox, { batchNo: 'M1', qty: 5 })]);
    recordMissedSale(env.db, env.ctx(cashier), { itemId: tramadol, qty: 1 });
    recordMissedSale(env.db, env.ctx(cashier), {
      itemId: tramadol,
      qty: 2,
      customerPhone: '0300-0000000',
    });
    const low = run('low-stock');
    expect(low.rows.find((r) => r.item === 'Amoxicillin 500mg')).toMatchObject({
      sellable: 50,
      reorder: 100,
      shortfall: 50,
    });
    expect(low.rows.find((r) => r.item === 'Tramadol 50mg')).toMatchObject({
      sellable: 0,
      missed: 2,
    });
    expect(low.rows.find((r) => r.item === 'Paracetamol 500mg')).toBeUndefined();
  });
});

describe('compliance reports', () => {
  it('narcotic register and missed sales', () => {
    receive([
      grnLine(tramadol, {
        batchNo: 'T1',
        expiryDate: '2027-03-31',
        qty: 10,
        unitPriceMicro: rate('100'),
      }),
    ]);
    const s = createSale(env.db, env.ctx(cashier), {
      idempotencyKey: 'narcotic-key-1',
      lines: [
        {
          itemId: tramadol,
          unitId: unitId.strip as string,
          qty: 1,
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
    const reg = run('narcotic-register', { from: '2026-10-05', to: '2026-10-05' });
    expect(reg.rows).toHaveLength(1);
    expect(reg.rows[0]).toMatchObject({
      docNo: s.docNo,
      item: 'Tramadol 50mg',
      qty: 10,
      patient: 'Test Patient',
      cnic: '42101-1234567-1',
      doctor: 'Dr Test',
      prescriptionRef: 'RX-1',
      soldBy: 'Test cashier1',
    });
    expect(run('narcotic-register', { from: '2026-10-06', to: '2026-10-06' }).rows).toHaveLength(0);
    expect(run('narcotic-register', { q: 'nobody' }).rows).toHaveLength(0);

    recordMissedSale(env.db, env.ctx(cashier), {
      itemId: para,
      qty: 3,
      customerPhone: '0300-0000001',
    });
    recordMissedSale(env.db, env.ctx(cashier), {
      itemId: para,
      qty: 1,
      customerPhone: '0300-0000002',
    });
    recordMissedSale(env.db, env.ctx(cashier), { itemText: 'Some new syrup', qty: 1 });
    recordMissedSale(env.db, env.ctx(cashier), { itemText: 'some NEW syrup ', qty: 2 });
    const missed = run('missed-sales', { from: '2026-10-05', to: '2026-10-05' });
    expect(missed.rows.find((r) => r.item === 'Paracetamol 500mg')).toMatchObject({
      qty: 4,
      count: 2,
      phones: '0300-0000001, 0300-0000002',
    });
    expect(missed.rows.filter((r) => String(r.item).toLowerCase().includes('syrup'))).toHaveLength(
      1,
    );
  });
});

describe('column rights', () => {
  const SENSITIVE = /"(cost|profit|marginPct|costValueMinor|grossProfit)"/;

  it('no report leaks cost or profit to a user without the rights', () => {
    sell(2);
    receive([grnLine(para, { batchNo: 'C1', expiryDate: '2026-10-20', qty: 1 })]);
    for (const def of REPORTS) {
      const full = def.run(env.db, env.ctx(admin), { from: '2026-10-05', to: '2026-10-05' });
      const none = applyColumnRights(full, { cost: false, profit: false });
      const text = JSON.stringify(none);
      expect(text, def.id).not.toMatch(SENSITIVE);
      expect(
        none.columns.every((c) => !c.sensitivity),
        def.id,
      ).toBe(true);
      expect(none.kpis?.every((k) => !k.sensitivity) ?? true, def.id).toBe(true);
      for (const row of none.rows) {
        for (const c of full.columns.filter((x) => x.sensitivity)) expect(c.key in row).toBe(false);
      }
    }
  });

  it('keeps cost for a user with the cost right only, and everything for one with both', () => {
    sell(2);
    const full = run('sales-daily', { from: '2026-10-05', to: '2026-10-05' });
    const costOnly = applyColumnRights(full, { cost: true, profit: false });
    expect(costOnly.columns.map((c) => c.key)).toContain('cost');
    expect(costOnly.columns.map((c) => c.key)).not.toContain('profit');
    expect(costOnly.rows[0]).toHaveProperty('cost');
    expect(costOnly.rows[0]).not.toHaveProperty('profit');
    expect(costOnly.totals).not.toHaveProperty('profit');
    expect(applyColumnRights(full, { cost: true, profit: true })).toEqual(full);
  });
});
