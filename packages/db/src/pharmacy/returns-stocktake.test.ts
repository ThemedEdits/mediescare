import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRateToMicro } from '@mediescare/core';
import { DomainError } from '../errors';
import {
  createPurchaseReturn,
  getPurchaseReturn,
  getSupplierLedger,
  listPurchaseReturns,
  listSupplierBalances,
} from '../purchasing';
import { paymentModes, units } from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import { createItem, type ItemInput } from './catalog';
import { createSupplier } from './lookups';
import {
  cancelStockTake,
  getStockTake,
  listStockTakeLines,
  listStockTakes,
  postStockTake,
  recordCounts,
  startStockTake,
} from './stocktake';
import { adjustStock, getBatchStock, receiveGrn } from './stock';

const rate = parseRateToMicro;
let env: TestEnv;
let admin: string;
let supplierId: string;
let other: string;
let unitId: Record<string, string>;
let modeId: Record<string, string>;
let para: string;
let amox: string;
let paraBatch: string;
let amoxBatch: string;
let billId: string;

const ctx = () => env.ctx(admin);
const itemInput = (name: string, barcode: string): ItemInput => ({
  name,
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
  barcodes: [barcode],
  retailRateUnitMicro: rate('2.50'),
});
const onHand = (itemId: string, batchId: string) =>
  getBatchStock(env.db, env.setup.branchId, itemId, { includeEmpty: true }).find(
    (b) => b.id === batchId,
  )?.available;

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
  supplierId = createSupplier(env.db, ctx(), { name: 'Test Distributor' });
  other = createSupplier(env.db, ctx(), { name: 'Other Traders' });
  para = createItem(env.db, ctx(), itemInput('Paracetamol 500mg', '8961001111111'));
  amox = createItem(env.db, ctx(), itemInput('Amoxicillin 500mg', '8961002222222'));
  const grn = receiveGrn(env.db, ctx(), {
    supplierId,
    lines: [
      {
        itemId: para,
        unitId: unitId.strip as string,
        qty: 10,
        batchNo: 'P1',
        expiryDate: '2027-12-31',
        unitPriceMicro: rate('18'),
      },
      {
        itemId: amox,
        unitId: unitId.strip as string,
        qty: 5,
        batchNo: 'M1',
        expiryDate: '2027-06-30',
        unitPriceMicro: rate('40'),
      },
    ],
  });
  billId = grn.id;
  paraBatch = grn.lines[0]?.batchId as string;
  amoxBatch = grn.lines[1]?.batchId as string;
});

afterEach(() => env.cleanup());

describe('purchase returns', () => {
  it('takes stock out of the batch and credits the supplier ledger at batch cost', () => {
    const before = getSupplierLedger(env.db, ctx(), supplierId, '2026-10-05').balanceMinor;
    const r = createPurchaseReturn(env.db, ctx(), {
      supplierId,
      grnId: billId,
      reason: 'damaged',
      creditNoteNo: 'CN-9',
      lines: [{ batchId: paraBatch, qtyBase: 30 }],
    });
    expect(r.docNo).toMatch(/-PRT-/);
    expect(onHand(para, paraBatch)).toBe(70);
    // 30 tablets at 1.80 = 54.00
    expect(r.totalMinor).toBe(5400);
    const ledger = getSupplierLedger(env.db, ctx(), supplierId, '2026-10-05');
    expect(ledger.balanceMinor).toBe(before - 5400);
    expect(ledger.entries.at(-1)).toMatchObject({ kind: 'return', creditMinor: 5400 });
    expect(Object.values(ledger.aging).reduce((a, b) => a + b, 0)).toBe(ledger.balanceMinor);
    expect(
      listSupplierBalances(env.db, ctx()).find((x) => x.supplierId === supplierId)?.balanceMinor,
    ).toBe(ledger.balanceMinor);
    const detail = getPurchaseReturn(env.db, ctx(), r.id);
    expect(detail.lines[0]).toMatchObject({ batchNo: 'P1', qtyBase: 30, lineTotalMinor: 5400 });
    expect(listPurchaseReturns(env.db, ctx()).total).toBe(1);
  });

  it('refuses more than is in the batch, duplicates, wrong bill, another supplier and missing reasons', async () => {
    const base = { supplierId, reason: 'damaged' as const };
    await expectDomain(
      () =>
        createPurchaseReturn(env.db, ctx(), {
          ...base,
          lines: [{ batchId: paraBatch, qtyBase: 101 }],
        }),
      'INSUFFICIENT_STOCK',
    );
    await expectDomain(
      () =>
        createPurchaseReturn(env.db, ctx(), {
          ...base,
          lines: [
            { batchId: paraBatch, qtyBase: 1 },
            { batchId: paraBatch, qtyBase: 1 },
          ],
        }),
      'INVALID',
    );
    await expectDomain(
      () =>
        createPurchaseReturn(env.db, ctx(), {
          ...base,
          lines: [{ batchId: paraBatch, qtyBase: 0 }],
        }),
      'INVALID',
    );
    await expectDomain(
      () =>
        createPurchaseReturn(env.db, ctx(), {
          supplierId: other,
          reason: 'damaged',
          lines: [{ batchId: paraBatch, qtyBase: 1 }],
        }),
      'INVALID',
    );
    await expectDomain(
      () =>
        createPurchaseReturn(env.db, ctx(), {
          supplierId: other,
          grnId: billId,
          reason: 'damaged',
          lines: [{ batchId: paraBatch, qtyBase: 1 }],
        }),
      'INVALID',
    );
    await expectDomain(
      () =>
        createPurchaseReturn(env.db, ctx(), {
          ...base,
          reason: 'other',
          lines: [{ batchId: paraBatch, qtyBase: 1 }],
        }),
      'INVALID',
    );
    await expectDomain(
      () => createPurchaseReturn(env.db, ctx(), { ...base, lines: [] }),
      'INVALID',
    );
    expect(onHand(para, paraBatch)).toBe(100);
  });

  it('cannot be edited or deleted after posting', () => {
    const r = createPurchaseReturn(env.db, ctx(), {
      supplierId,
      reason: 'expired',
      lines: [{ batchId: amoxBatch, qtyBase: 5 }],
    });
    expect(() =>
      env.handle.raw.prepare('UPDATE purchase_returns SET total_minor = 1 WHERE id = ?').run(r.id),
    ).toThrow(/immutable/);
    expect(() =>
      env.handle.raw.prepare('DELETE FROM purchase_return_lines WHERE return_id = ?').run(r.id),
    ).toThrow(/immutable/);
  });
});

describe('stock take', () => {
  it('freezes the system quantity, records counts and posts only the differences', () => {
    const take = startStockTake(env.db, ctx(), { title: 'Full count' });
    expect(take.docNo).toMatch(/-STK-/);
    expect(take.lineCount).toBe(2);
    // A sale-like movement during the count must survive the posting.
    adjustStock(env.db, ctx(), { batchId: paraBatch, qtyDeltaBase: -10, reason: 'damaged' });

    const lines = listStockTakeLines(env.db, ctx(), take.id).rows;
    const paraLine = lines.find((l) => l.itemId === para)!;
    const amoxLine = lines.find((l) => l.itemId === amox)!;
    expect(paraLine.systemQtyBase).toBe(100);
    recordCounts(env.db, ctx(), take.id, [{ lineId: paraLine.lineId, countedQtyBase: 95 }]);
    expect(getStockTake(env.db, ctx(), take.id)).toMatchObject({
      totalLines: 2,
      countedLines: 1,
      varianceLines: 1,
    });
    expect(
      listStockTakeLines(env.db, ctx(), take.id, { filter: 'uncounted' }).rows.map((l) => l.lineId),
    ).toEqual([amoxLine.lineId]);
    expect(
      listStockTakeLines(env.db, ctx(), take.id, { filter: 'variance' }).rows[0],
    ).toMatchObject({ differenceBase: -5, costValueMinor: -900 });

    const res = postStockTake(env.db, ctx(), take.id, { uncounted: 'ignore' });
    expect(res).toMatchObject({
      adjusted: 1,
      ignoredUncounted: 1,
      lossMinor: 900,
      gainMinor: 0,
      clamped: 0,
    });
    // 100 frozen, -10 adjusted during the count, -5 from the count: 85 left.
    expect(onHand(para, paraBatch)).toBe(85);
    expect(onHand(amox, amoxBatch)).toBe(50);
    expect(getStockTake(env.db, ctx(), take.id).status).toBe('posted');
    expect(() =>
      recordCounts(env.db, ctx(), take.id, [{ lineId: paraLine.lineId, countedQtyBase: 1 }]),
    ).toThrow(/posted/);
    expect(() => postStockTake(env.db, ctx(), take.id, { uncounted: 'ignore' })).toThrow(/posted/);
  });

  it('can treat uncounted lines as not found, and limits a loss to what is left', () => {
    const take = startStockTake(env.db, ctx(), { title: 'Rack A' });
    adjustStock(env.db, ctx(), { batchId: amoxBatch, qtyDeltaBase: -40, reason: 'damaged' });
    const res = postStockTake(env.db, ctx(), take.id, { uncounted: 'zero' });
    expect(res.adjusted).toBe(2);
    expect(res.clamped).toBe(1);
    expect(onHand(para, paraBatch)).toBe(0);
    expect(onHand(amox, amoxBatch)).toBe(0);
  });

  it('allows one open count per branch, scopes by item, and can be cancelled with a reason', async () => {
    const take = startStockTake(env.db, ctx(), {
      title: 'Paracetamol only',
      scope: { itemIds: [para] },
    });
    expect(take.lineCount).toBe(1);
    await expectDomain(() => startStockTake(env.db, ctx(), { title: 'Second' }), 'CONFLICT');
    await expectDomain(() => cancelStockTake(env.db, ctx(), take.id, 'x'), 'INVALID');
    cancelStockTake(env.db, ctx(), take.id, 'Started by mistake');
    expect(listStockTakes(env.db, ctx())[0]).toMatchObject({
      status: 'cancelled',
      cancelReason: 'Started by mistake',
    });
    expect(startStockTake(env.db, ctx(), { title: 'Again' }).lineCount).toBe(2);
    await expectDomain(
      () => startStockTake(env.db, ctx(), { title: 'Nothing', scope: { itemIds: ['missing'] } }),
      'CONFLICT',
    );
  });

  it('gains are posted as adjustments valued at batch cost', () => {
    const take = startStockTake(env.db, ctx(), { title: 'Count' });
    const line = listStockTakeLines(env.db, ctx(), take.id).rows.find((l) => l.itemId === amox)!;
    recordCounts(env.db, ctx(), take.id, [{ lineId: line.lineId, countedQtyBase: 52 }]);
    const res = postStockTake(env.db, ctx(), take.id, { uncounted: 'ignore' });
    expect(res.gainMinor).toBe(2 * 400); // 2 tablets at 4.00
    expect(onHand(amox, amoxBatch)).toBe(52);
    expect(modeId.cash).toBeDefined();
  });
});
