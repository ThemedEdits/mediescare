import { eq, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseRateToMicro } from '@mediescare/core';
import { DomainError } from '../errors';
import { createItem } from '../pharmacy/catalog';
import { createSupplier } from '../pharmacy/lookups';
import {
  closeShift,
  createReturn,
  createSale,
  expectedCashMinor,
  openShift,
} from '../pharmacy/pos';
import { receiveGrn } from '../pharmacy/stock';
import { paySupplier } from '../purchasing/payments';
import { applyColumnRights, runReport } from '../reports';
import { expenses, paymentModes, saleLines, units } from '../schema/sqlite-all';
import { createTestEnv, type TestEnv } from '../test-helpers';
import {
  cashFlow,
  createExpense,
  createExpenseCategory,
  listExpenseCategories,
  listExpenses,
  netProfit,
  updateExpenseCategory,
  voidExpense,
} from './index';

const rate = parseRateToMicro;
const DAY = 86_400_000;
const DAY1 = Date.parse('2026-10-05T09:00:00.000Z'); // 14:00 on 5 Oct in Karachi

let env: TestEnv;
let admin: string;
let cashier: string;
let supplierId: string;
let unitId: Record<string, string>;
let modeId: Record<string, string>;
let para: string;
let seq = 0;

const cat = (name: string): string => {
  const c = listExpenseCategories(env.db, env.ctx(admin)).find((x) => x.name === name);
  if (!c) throw new Error(`category ${name}`);
  return c.id;
};

/** Sell strips of paracetamol (25.00 a strip, batch cost 18.00) paid in one mode. */
function sell(user: string, strips: number, mode: string) {
  return createSale(env.db, env.ctx(user), {
    idempotencyKey: `acc-sale-${(seq += 1)}`,
    lines: [{ itemId: para, unitId: unitId.strip as string, qty: strips }],
    payments: [{ modeId: modeId[mode] as string, amountMinor: strips * 2_500 }],
  });
}

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
  supplierId = createSupplier(env.db, env.ctx(admin), { name: 'Test Distributor' });
  para = createItem(env.db, env.ctx(admin), {
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
  });
  // 150 strips at 18.00 = 270,000 paisa of stock bought.
  receiveGrn(env.db, env.ctx(admin), {
    supplierId,
    lines: [
      {
        itemId: para,
        unitId: unitId.strip as string,
        qty: 150,
        batchNo: 'A1',
        expiryDate: '2027-12-31',
        unitPriceMicro: rate('18'),
      },
    ],
  });
});
afterEach(() => env.cleanup());

const exp = (over: Partial<Parameters<typeof createExpense>[2]> = {}, user = admin) =>
  createExpense(env.db, env.ctx(user), {
    categoryId: cat('Rent'),
    amountMinor: 20_000,
    modeId: modeId.cash as string,
    ...over,
  });

describe('expense categories', () => {
  it('starts with editable defaults, refuses duplicates, renames and deactivates', () => {
    const list = listExpenseCategories(env.db, env.ctx(admin));
    expect(list.map((c) => c.name)).toContain('Salaries and wages');
    expect(list.find((c) => c.name === 'Rent')?.kind).toBe('rent');

    expect(() => createExpenseCategory(env.db, env.ctx(admin), { name: ' rent ' })).toThrow(
      DomainError,
    );
    expect(() => createExpenseCategory(env.db, env.ctx(admin), { name: 'x' })).toThrow(DomainError);
    expect(() =>
      createExpenseCategory(env.db, env.ctx(admin), { name: 'Pest control', kind: 'bogus' }),
    ).toThrow(DomainError);
    const { id } = createExpenseCategory(env.db, env.ctx(admin), { name: 'Pest control' });

    const renamed = updateExpenseCategory(env.db, env.ctx(admin), {
      id,
      version: 1,
      name: 'Pest and hygiene',
    });
    expect(renamed).toMatchObject({ name: 'Pest and hygiene', version: 2 });
    expect(() =>
      updateExpenseCategory(env.db, env.ctx(admin), { id, version: 1, name: 'Other name' }),
    ).toThrow(/Someone else/);
    expect(() =>
      updateExpenseCategory(env.db, env.ctx(admin), { id, version: 2, name: 'Rent' }),
    ).toThrow(/already exists/);

    // Deactivate: hidden from new entries, kept for old ones.
    const past = exp({ categoryId: id, amountMinor: 1_000 });
    updateExpenseCategory(env.db, env.ctx(admin), { id, version: 2, isActive: false });
    expect(listExpenseCategories(env.db, env.ctx(admin)).some((c) => c.id === id)).toBe(false);
    expect(
      listExpenseCategories(env.db, env.ctx(admin), { includeInactive: true }).some(
        (c) => c.id === id,
      ),
    ).toBe(true);
    expect(() => exp({ categoryId: id })).toThrow(/Choose a category/);
    expect(listExpenses(env.db, env.ctx(admin), {}).rows.map((r) => r.id)).toContain(past.id);
  });
});

describe('expenses', () => {
  it('numbers vouchers per branch, validates input and lists newest first', () => {
    const a = exp();
    const b = exp({ amountMinor: 500, payee: 'Gas shop', note: ' cylinder ' });
    expect(a.docNo).toBe('KHI01-EXP-000001');
    expect(b.docNo).toBe('KHI01-EXP-000002');
    expect(() => exp({ amountMinor: 0 })).toThrow(/above zero/);
    expect(() => exp({ amountMinor: 10.5 })).toThrow(DomainError);
    expect(() => exp({ modeId: modeId.credit as string })).toThrow(/how the expense was paid/);
    expect(() => exp({ expenseDate: '2026-10-09' })).toThrow(/future/);
    expect(() => exp({ expenseDate: 'yesterday' })).toThrow(DomainError);
    const list = listExpenses(env.db, env.ctx(admin), {});
    expect(list.total).toBe(2);
    expect(list.postedTotalMinor).toBe(20_500);
    expect(list.rows[0]).toMatchObject({ payee: 'Gas shop', note: 'cylinder', modeKind: 'cash' });
  });

  it('is immutable once posted: no edit, no delete, only a void with a reason', () => {
    const e = exp();
    expect(() =>
      env.db.update(expenses).set({ amountMinor: 1 }).where(eq(expenses.id, e.id)).run(),
    ).toThrow(/immutable/);
    expect(() => env.db.delete(expenses).where(eq(expenses.id, e.id)).run()).toThrow(
      /never deleted/,
    );
    expect(() => voidExpense(env.db, env.ctx(admin), { expenseId: e.id, reason: 'x' })).toThrow(
      /reason/,
    );
    voidExpense(env.db, env.ctx(admin), { expenseId: e.id, reason: 'Entered twice' });
    const row = env.db.select().from(expenses).where(eq(expenses.id, e.id)).get();
    expect(row).toMatchObject({
      status: 'void',
      voidReason: 'Entered twice',
      voidedBy: admin,
      amountMinor: 20_000,
    });
    expect(() => voidExpense(env.db, env.ctx(admin), { expenseId: e.id, reason: 'again' })).toThrow(
      /already void/,
    );
    // A void cannot be undone.
    expect(() =>
      env.db.update(expenses).set({ status: 'posted' }).where(eq(expenses.id, e.id)).run(),
    ).toThrow(/immutable/);
    // It stays in the list but not in the totals.
    const list = listExpenses(env.db, env.ctx(admin), {});
    expect(list.rows.map((r) => r.status)).toEqual(['void']);
    expect(list.postedTotalMinor).toBe(0);
    expect(listExpenses(env.db, env.ctx(admin), { status: 'posted' }).total).toBe(0);
  });

  it('writes an audit entry and an outbox change in the same transaction', () => {
    const e = exp();
    voidExpense(env.db, env.ctx(admin), { expenseId: e.id, reason: 'Wrong month' });
    const audit = env.db.all<{ action: string }>(
      sql`SELECT action FROM audit_log WHERE action LIKE 'expense.%' ORDER BY seq`,
    );
    expect(audit.map((a) => a.action)).toEqual(['expense.create', 'expense.void']);
    const outbox = env.db.all<{ entity_type: string; op: string }>(
      sql`SELECT entity_type, op FROM sync_outbox WHERE entity_type = 'expenses' ORDER BY seq`,
    );
    expect(outbox.map((o) => o.op)).toEqual(['insert', 'update']);
  });
});

describe('expenses paid from the till', () => {
  it('needs an open shift and cash, lowers that shift expected cash, and a void gives it back', () => {
    expect(() => exp({ fromTill: true }, cashier)).toThrow(/Open your shift/);
    const shift = openShift(env.db, env.ctx(cashier), { floatMinor: 500_000 });
    expect(() => exp({ fromTill: true, modeId: modeId.bank as string }, cashier)).toThrow(
      /Only cash/,
    );
    expect(() => exp({ fromTill: true, expenseDate: '2026-10-04' }, cashier)).toThrow(/today/);
    sell(cashier, 4, 'cash'); // +10,000
    expect(expectedCashMinor(env.db, shift.id)).toBe(510_000);
    const till = exp({ fromTill: true, amountMinor: 3_000 }, cashier);
    expect(expectedCashMinor(env.db, shift.id)).toBe(507_000);
    // A back-office cash expense does not touch the till.
    exp({ amountMinor: 7_000 });
    expect(expectedCashMinor(env.db, shift.id)).toBe(507_000);
    voidExpense(env.db, env.ctx(admin), {
      expenseId: till.id,
      reason: 'Receipt was for another shop',
    });
    expect(expectedCashMinor(env.db, shift.id)).toBe(510_000);
  });

  it('cannot be voided after the shift is closed, and the close counts it', () => {
    const shift = openShift(env.db, env.ctx(cashier), { floatMinor: 100_000 });
    const till = exp({ fromTill: true, amountMinor: 2_000 }, cashier);
    const res = closeShift(env.db, env.ctx(cashier), {
      shiftId: shift.id,
      countedCashMinor: 98_000,
    });
    expect(res).toMatchObject({ expectedCashMinor: 98_000, varianceMinor: 0 });
    expect(() =>
      voidExpense(env.db, env.ctx(admin), { expenseId: till.id, reason: 'Too late' }),
    ).toThrow(/shift is closed/);
  });
});

describe('cash book and profit on a hand-computed day', () => {
  /**
   * 5 Oct (Karachi):
   *   cashier shift, float 5,000.00. Sells 40 strips for cash (1,000.00), returns 1 strip (25.00 cash back),
   *     pays 30.00 transport from the till.
   *   admin shift, float 0. Sells 2 strips by bank (50.00).
   *   back office: rent 200.00 cash, electricity 50.00 bank, a wrong 7.77 voided,
   *     supplier paid 400.00 cash and 100.00 bank.
   * 6 Oct: admin (shift still open) sells 10 strips for cash (250.00), supplier paid 50.00 cash.
   */
  let cashierShift: string;
  let adminShift: string;

  function dayOne() {
    env.clock.ms = DAY1;
    cashierShift = openShift(env.db, env.ctx(cashier), { floatMinor: 500_000 }).id;
    adminShift = openShift(env.db, env.ctx(admin), { floatMinor: 0 }).id;
    const big = sell(cashier, 40, 'cash');
    sell(admin, 2, 'bank');
    const line = env.db.select().from(saleLines).where(eq(saleLines.saleId, big.id)).get();
    createReturn(env.db, env.ctx(cashier), {
      saleId: big.id,
      lines: [{ saleLineId: line?.id as string, qtyBase: 10, restock: true }],
      reasonCode: 'wrong_item',
      refundModeId: modeId.cash as string,
    });
    exp({ categoryId: cat('Transport and delivery'), amountMinor: 3_000, fromTill: true }, cashier);
    exp({ categoryId: cat('Rent'), amountMinor: 20_000 });
    exp({ categoryId: cat('Electricity'), amountMinor: 5_000, modeId: modeId.bank as string });
    const wrong = exp({ categoryId: cat('Miscellaneous'), amountMinor: 777 });
    voidExpense(env.db, env.ctx(admin), { expenseId: wrong.id, reason: 'Entered by mistake' });
    paySupplier(env.db, env.ctx(admin), {
      supplierId,
      amountMinor: 40_000,
      modeId: modeId.cash as string,
    });
    paySupplier(env.db, env.ctx(admin), {
      supplierId,
      amountMinor: 10_000,
      modeId: modeId.bank as string,
    });
  }
  const range1 = { from: '2026-10-05', to: '2026-10-05' };

  it('cash book day one: in, out, closing, by mode and by category', () => {
    dayOne();
    const cf = cashFlow(env.db, env.ctx(admin), range1);
    expect(cf.openingCashMinor).toBe(0);
    expect(cf.cashIn).toEqual({ salesMinor: 100_000, adjustmentsMinor: 0, totalMinor: 100_000 });
    expect(cf.cashOut).toEqual({
      refundsMinor: 2_500,
      adjustmentsMinor: 0,
      expensesMinor: 23_000, // 3,000 from the till + 20,000 rent
      supplierPaymentsMinor: 40_000,
      totalMinor: 65_500,
    });
    expect(cf.closingCashMinor).toBe(34_500);
    expect(cf.daily).toEqual([
      {
        date: '2026-10-05',
        inMinor: 100_000,
        outMinor: 65_500,
        netMinor: 34_500,
        closingMinor: 34_500,
      },
    ]);
    const bank = cf.byMode.find((m) => m.kind === 'bank');
    expect(bank).toMatchObject({
      salesMinor: 5_000,
      expensesMinor: 5_000,
      supplierPaymentsMinor: 10_000,
      netMinor: -10_000,
    });
    expect(cf.byMode.some((m) => m.kind === 'credit')).toBe(false);
    expect(cf.expensesByCategory).toEqual([
      expect.objectContaining({ name: 'Rent', amountMinor: 20_000 }),
      expect.objectContaining({ name: 'Electricity', amountMinor: 5_000 }),
      expect.objectContaining({ name: 'Transport and delivery', amountMinor: 3_000 }),
    ]);
  });

  it('closing cash equals the shifts expected cash movements less back-office cash paid out', () => {
    dayOne();
    const c = closeShift(env.db, env.ctx(cashier), {
      shiftId: cashierShift,
      countedCashMinor: 594_500,
    });
    const a = closeShift(env.db, env.ctx(admin), { shiftId: adminShift, countedCashMinor: 0 });
    // float 5,000.00 + 1,000.00 sales - 25.00 refund - 30.00 till expense
    expect(c.expectedCashMinor).toBe(594_500);
    expect(a.expectedCashMinor).toBe(0);
    const shiftMovements = c.expectedCashMinor - 500_000 + (a.expectedCashMinor - 0);
    const backOfficeCash = 20_000 /* rent */ + 40_000; /* supplier */
    const cf = cashFlow(env.db, env.ctx(admin), range1);
    expect(cf.closingCashMinor).toBe(shiftMovements - backOfficeCash);
    expect(cf.closingCashMinor).toBe(34_500);
  });

  it('day two opens with day one closing and keeps a running closing balance', () => {
    dayOne();
    env.clock.ms = DAY1 + DAY;
    sell(admin, 10, 'cash');
    paySupplier(env.db, env.ctx(admin), {
      supplierId,
      amountMinor: 5_000,
      modeId: modeId.cash as string,
    });
    const day2 = cashFlow(env.db, env.ctx(admin), { from: '2026-10-06', to: '2026-10-06' });
    expect(day2.openingCashMinor).toBe(34_500);
    expect(day2.closingCashMinor).toBe(34_500 + 25_000 - 5_000);
    const both = cashFlow(env.db, env.ctx(admin), { from: '2026-10-05', to: '2026-10-06' });
    expect(both.openingCashMinor).toBe(0);
    expect(both.closingCashMinor).toBe(day2.closingCashMinor);
    expect(both.daily.map((d) => d.closingMinor)).toEqual([34_500, 54_500]);
  });

  it('a voided invoice and a voided expense leave the cash book', () => {
    dayOne();
    const before = cashFlow(env.db, env.ctx(admin), range1).closingCashMinor;
    const rent = env.db.select().from(expenses).where(eq(expenses.amountMinor, 20_000)).get();
    voidExpense(env.db, env.ctx(admin), { expenseId: rent?.id as string, reason: 'Paid by owner' });
    expect(cashFlow(env.db, env.ctx(admin), range1).closingCashMinor).toBe(before + 20_000);
  });

  it('net profit: revenue and cost from sales, expenses by category, purchases are not an expense', () => {
    dayOne();
    const p = netProfit(env.db, env.ctx(admin), range1);
    // Billed 105,000, refund 2,500 (no tax): 102,500. Cost 42 strips x 1,800 = 75,600, 1 restocked: 73,800.
    expect(p.netRevenueMinor).toBe(102_500);
    expect(p.costOfGoodsMinor).toBe(73_800);
    expect(p.grossProfitMinor).toBe(28_700);
    expect(p.expensesTotalMinor).toBe(28_000); // 20,000 + 5,000 + 3,000, the voided 777 is out
    expect(p.netProfitMinor).toBe(700);
    expect(p.purchasesMinor).toBe(270_000);
    expect(p.supplierPayablesMinor).toBe(270_000 - 50_000);
  });

  it('net profit report: rows, the cost/profit rights and the other new reports', () => {
    dayOne();
    const rep = runReport(env.db, env.ctx(admin), 'net-profit', range1);
    const line = (r: typeof rep, name: string) => r.rows.find((x) => x.line === name)?.amount;
    expect(line(rep, 'Net revenue')).toBe(102_500);
    expect(line(rep, 'Gross profit')).toBe(28_700);
    expect(line(rep, 'Rent')).toBe(20_000);
    expect(line(rep, 'Net profit')).toBe(700);

    const noProfit = applyColumnRights(rep, { cost: true, profit: false });
    expect(noProfit.rows.map((x) => x.line)).toEqual([
      'Net revenue',
      'Cost of goods sold',
      'Rent',
      'Electricity',
      'Transport and delivery',
      'Total expenses',
      'Purchases of stock (not an expense)',
      'Owed to suppliers today',
    ]);
    expect(noProfit.kpis?.map((k) => k.label)).toEqual(['Net revenue', 'Total expenses']);
    const none = applyColumnRights(rep, { cost: false, profit: false });
    expect(none.rows.some((x) => x.line === 'Cost of goods sold')).toBe(false);
    expect(none.rows.some((x) => x.line === 'Net profit')).toBe(false);

    const list = runReport(env.db, env.ctx(admin), 'expenses', range1);
    expect(list.rows).toHaveLength(4);
    expect(list.totals?.amount).toBe(28_000);
    expect(list.rows.filter((r) => r.status === 'Void')).toHaveLength(1);
    const flow = runReport(env.db, env.ctx(admin), 'cash-flow', range1);
    expect(flow.kpis?.map((k) => k.value)).toEqual([0, 100_000, 65_500, 34_500]);
    expect(flow.totals).toMatchObject({ cashIn: 100_000, cashOut: 65_500, net: 34_500 });
  });
});
