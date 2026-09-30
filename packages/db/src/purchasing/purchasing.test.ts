import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRateToMicro } from '@mediescare/core';
import { DomainError } from '../errors';
import { createItem, type ItemInput } from '../pharmacy/catalog';
import { createSupplier } from '../pharmacy/lookups';
import { recordMissedSale } from '../pharmacy/pos';
import { receiveGrn } from '../pharmacy/stock';
import { paymentModes, units } from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getGrn,
  getPurchaseOrder,
  getSupplierLedger,
  listGrns,
  listOpenBills,
  listPurchaseOrders,
  listSupplierBalances,
  paySupplier,
  suggestOrder,
  updateDraftPurchaseOrder,
} from './index';

const rate = parseRateToMicro;
const TODAY = '2026-10-05';
let env: TestEnv;
let admin: string;
let supplierId: string;
let otherSupplier: string;
let unitId: Record<string, string>;
let modeId: Record<string, string>;
let para: string;
let amox: string;

const itemInput = (name: string, barcode: string, over: Partial<ItemInput> = {}): ItemInput => ({
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
  ...over,
});

const ctx = () => env.ctx(admin);
const strip = () => unitId.strip as string;
const poLine = (itemId: string, qty: number, price = '18') => ({
  itemId,
  unitId: strip(),
  qty,
  unitPriceMicro: rate(price),
});
const grnLine = (itemId: string, qty: number, batchNo: string) => ({
  itemId,
  unitId: strip(),
  qty,
  batchNo,
  expiryDate: '2027-12-31',
  unitPriceMicro: rate('18'),
});

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
  supplierId = createSupplier(env.db, ctx(), { name: 'Test Distributor', termsDays: 30 });
  otherSupplier = createSupplier(env.db, ctx(), { name: 'Other Traders' });
  para = createItem(
    env.db,
    ctx(),
    itemInput('Paracetamol 500mg', '8961001111111', { reorderLevelBase: 400 }),
  );
  amox = createItem(env.db, ctx(), itemInput('Amoxicillin 500mg', '8961002222222'));
});

afterEach(() => env.cleanup());

describe('purchase orders', () => {
  it('runs draft → approved → partial → received and counts delivered quantities', () => {
    const { id, docNo } = createPurchaseOrder(env.db, ctx(), {
      supplierId,
      lines: [poLine(para, 20), poLine(amox, 10)],
    });
    expect(docNo).toMatch(/-PO-/);
    let po = getPurchaseOrder(env.db, ctx(), id);
    expect(po.status).toBe('draft');
    expect(po.subTotalMinor).toBe(30 * 1800);
    expect(po.lines[0]?.orderedBase).toBe(200);

    expect(() =>
      receiveGrn(env.db, ctx(), { supplierId, poId: id, lines: [grnLine(para, 5, 'P1')] }),
    ).toThrow(/draft/);
    approvePurchaseOrder(env.db, ctx(), id);

    receiveGrn(env.db, ctx(), {
      supplierId,
      poId: id,
      lines: [grnLine(para, 20, 'P1'), grnLine(amox, 4, 'M1')],
    });
    po = getPurchaseOrder(env.db, ctx(), id);
    expect(po.status).toBe('partial');
    expect(po.lines.find((l) => l.itemId === amox)?.remainingBase).toBe(60);
    expect(po.receipts).toHaveLength(1);

    receiveGrn(env.db, ctx(), { supplierId, poId: id, lines: [grnLine(amox, 6, 'M2')] });
    po = getPurchaseOrder(env.db, ctx(), id);
    expect(po.status).toBe('received');
    expect(po.receipts).toHaveLength(2);
    expect(() => cancelPurchaseOrder(env.db, ctx(), id, 'too late')).toThrow(/received/);
  });

  it('allows editing only while draft and protects against stale edits', async () => {
    const { id } = createPurchaseOrder(env.db, ctx(), { supplierId, lines: [poLine(para, 5)] });
    updateDraftPurchaseOrder(env.db, ctx(), id, {
      supplierId,
      lines: [poLine(para, 8)],
      expectedVersion: 1,
    });
    expect(getPurchaseOrder(env.db, ctx(), id).subTotalMinor).toBe(8 * 1800);
    await expectDomain(
      () =>
        updateDraftPurchaseOrder(env.db, ctx(), id, {
          supplierId,
          lines: [poLine(para, 9)],
          expectedVersion: 1,
        }),
      'VERSION_CONFLICT',
    );
    approvePurchaseOrder(env.db, ctx(), id);
    await expectDomain(
      () =>
        updateDraftPurchaseOrder(env.db, ctx(), id, {
          supplierId,
          lines: [poLine(para, 9)],
          expectedVersion: 3,
        }),
      'CONFLICT',
    );
  });

  it('refuses a receipt from another supplier or against a cancelled order', async () => {
    const { id } = createPurchaseOrder(env.db, ctx(), { supplierId, lines: [poLine(para, 5)] });
    approvePurchaseOrder(env.db, ctx(), id);
    await expectDomain(
      () =>
        receiveGrn(env.db, ctx(), {
          supplierId: otherSupplier,
          poId: id,
          lines: [grnLine(para, 5, 'X')],
        }),
      'INVALID',
    );
    await expectDomain(() => cancelPurchaseOrder(env.db, ctx(), id, 'x'), 'INVALID');
    cancelPurchaseOrder(env.db, ctx(), id, 'Supplier out of stock');
    expect(getPurchaseOrder(env.db, ctx(), id).cancelReason).toBe('Supplier out of stock');
    await expectDomain(
      () => receiveGrn(env.db, ctx(), { supplierId, poId: id, lines: [grnLine(para, 5, 'X')] }),
      'CONFLICT',
    );
  });

  it('rejects empty orders, bad quantities and units the item is not bought in', async () => {
    await expectDomain(
      () => createPurchaseOrder(env.db, ctx(), { supplierId, lines: [] }),
      'INVALID',
    );
    await expectDomain(
      () => createPurchaseOrder(env.db, ctx(), { supplierId, lines: [poLine(para, 0)] }),
      'INVALID',
    );
    await expectDomain(
      () =>
        createPurchaseOrder(env.db, ctx(), {
          supplierId,
          lines: [{ ...poLine(para, 1), unitId: unitId.box as string }],
        }),
      'INVALID',
    );
  });

  it('lists orders with filters', () => {
    const a = createPurchaseOrder(env.db, ctx(), { supplierId, lines: [poLine(para, 1)] });
    createPurchaseOrder(env.db, ctx(), { supplierId: otherSupplier, lines: [poLine(para, 1)] });
    approvePurchaseOrder(env.db, ctx(), a.id);
    expect(listPurchaseOrders(env.db, ctx()).total).toBe(2);
    expect(listPurchaseOrders(env.db, ctx(), { status: 'approved' }).rows.map((r) => r.id)).toEqual(
      [a.id],
    );
    expect(listPurchaseOrders(env.db, ctx(), { q: 'Other' }).total).toBe(1);
  });
});

describe('suggestions', () => {
  it('suggests items under their reorder level and items customers missed', () => {
    receiveGrn(env.db, ctx(), { supplierId, lines: [grnLine(para, 10, 'P1')] }); // 100 tablets, reorder level 400
    const missed = createItem(env.db, ctx(), itemInput('Cetirizine 10mg', '8961003333333'));
    recordMissedSale(env.db, ctx(), { itemId: missed, qty: 3 });
    const s = suggestOrder(env.db, ctx(), TODAY);
    const p = s.find((x) => x.itemId === para);
    expect(p?.suggestedQty).toBe(70); // target 800, have 100 → 700 tablets = 70 strips
    expect(p?.unitPriceMicro).toBe(rate('18'));
    expect(s.find((x) => x.itemId === missed)?.suggestedQty).toBeGreaterThan(0);
    expect(s.find((x) => x.itemId === amox)).toBeUndefined();
  });
});

describe('supplier bills, payments and ledger', () => {
  const bill = (over: Record<string, unknown> = {}) =>
    receiveGrn(env.db, ctx(), {
      supplierId,
      supplierInvoiceNo: 'INV-77',
      supplierInvoiceDate: '2026-08-01',
      discountMinor: 1000,
      salesTaxMinor: 500,
      advanceTaxMinor: 200,
      freightMinor: 300,
      whtMinor: 400,
      lines: [grnLine(para, 50, 'B1')],
      ...over,
    });

  it('payable is the bill total less withholding tax', () => {
    const g = bill();
    expect(g.totalMinor).toBe(50 * 1800 - 1000 + 500 + 200 + 300);
    const detail = getGrn(env.db, ctx(), g.id);
    expect(detail.payableMinor).toBe(g.totalMinor - 400);
    expect(detail.outstandingMinor).toBe(detail.payableMinor);
    expect(detail.lines[0]?.batchNo).toBe('B1');
  });

  it('applies payments to a bill and refuses overpaying it', async () => {
    const g = bill();
    const payable = g.totalMinor - 400;
    paySupplier(env.db, ctx(), {
      supplierId,
      grnId: g.id,
      amountMinor: 30_000,
      modeId: modeId.cash as string,
    });
    expect(getGrn(env.db, ctx(), g.id).paidMinor).toBe(30_000);
    await expectDomain(
      () =>
        paySupplier(env.db, ctx(), {
          supplierId,
          grnId: g.id,
          amountMinor: payable,
          modeId: modeId.cash as string,
        }),
      'INVALID',
    );
    await expectDomain(
      () =>
        paySupplier(env.db, ctx(), {
          supplierId: otherSupplier,
          grnId: g.id,
          amountMinor: 1,
          modeId: modeId.cash as string,
        }),
      'INVALID',
    );
    await expectDomain(
      () =>
        paySupplier(env.db, ctx(), { supplierId, amountMinor: 0, modeId: modeId.cash as string }),
      'INVALID',
    );
    await expectDomain(
      () =>
        paySupplier(env.db, ctx(), { supplierId, amountMinor: 5, modeId: modeId.credit as string }),
      'INVALID',
    );
    paySupplier(env.db, ctx(), {
      supplierId,
      grnId: g.id,
      amountMinor: payable - 30_000,
      modeId: modeId.bank ?? (modeId.cash as string),
    });
    expect(listOpenBills(env.db, ctx(), supplierId)).toHaveLength(0);
  });

  it('builds a running ledger with opening balance, bills and payments', () => {
    env.handle.raw
      .prepare('UPDATE suppliers SET opening_balance_minor = 10000 WHERE id = ?')
      .run(supplierId);
    const g = bill();
    paySupplier(env.db, ctx(), {
      supplierId,
      grnId: g.id,
      amountMinor: 20_000,
      modeId: modeId.cash as string,
    });
    paySupplier(env.db, ctx(), {
      supplierId,
      amountMinor: 5000,
      modeId: modeId.cash as string,
      note: 'advance',
    });
    const ledger = getSupplierLedger(env.db, ctx(), supplierId, TODAY);
    const payable = g.totalMinor - 400;
    expect(ledger.entries.map((e) => e.kind)).toEqual(['opening', 'bill', 'payment', 'payment']);
    expect(ledger.entries[1]?.balanceMinor).toBe(10_000 + payable);
    expect(ledger.balanceMinor).toBe(10_000 + payable - 25_000);
    expect(
      listSupplierBalances(env.db, ctx()).find((r) => r.supplierId === supplierId)?.balanceMinor,
    ).toBe(ledger.balanceMinor);
    const buckets = Object.values(ledger.aging).reduce((a, b) => a + b, 0);
    expect(buckets).toBe(ledger.balanceMinor);
  });

  it('ages unpaid bills by the supplier terms and settles the oldest amounts first', () => {
    bill({ supplierInvoiceDate: '2026-06-01' }); // due 2026-07-01, 96 days late on 2026-10-05
    const recent = bill({ supplierInvoiceDate: '2026-10-01', lines: [grnLine(amox, 10, 'Z9')] }); // due 2026-10-31
    const ledger = getSupplierLedger(env.db, ctx(), supplierId, TODAY);
    expect(ledger.aging.over90).toBeGreaterThan(0);
    expect(ledger.aging.notDue).toBe(recent.totalMinor - 400);
    paySupplier(env.db, ctx(), { supplierId, amountMinor: 10_000, modeId: modeId.cash as string });
    const after = getSupplierLedger(env.db, ctx(), supplierId, TODAY);
    expect(after.aging.over90).toBe(ledger.aging.over90 - 10_000);
    expect(after.aging.notDue).toBe(ledger.aging.notDue);
  });

  it('lists bills with filters', () => {
    const g = bill();
    bill({ lines: [grnLine(amox, 5, 'Q1')], supplierInvoiceNo: 'INV-78' });
    paySupplier(env.db, ctx(), {
      supplierId,
      grnId: g.id,
      amountMinor: g.totalMinor - 400,
      modeId: modeId.cash as string,
    });
    expect(listGrns(env.db, ctx()).total).toBe(2);
    expect(
      listGrns(env.db, ctx(), { unpaidOnly: true }).rows.map((r) => r.supplierInvoiceNo),
    ).toEqual(['INV-78']);
    expect(listGrns(env.db, ctx(), { q: 'INV-77' }).total).toBe(1);
  });
});
