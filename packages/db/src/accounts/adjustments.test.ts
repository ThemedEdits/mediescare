import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DomainError } from '../errors';
import { createTestEnv, type TestEnv } from '../test-helpers';
import {
  cashFlow,
  createCashAdjustment,
  createExpense,
  listCashAdjustments,
  listExpenseCategories,
  voidCashAdjustment,
} from './index';
import { paymentModes } from '../schema/sqlite-all';

let env: TestEnv;
let admin: string;
const ctx = () => env.ctx(admin);
const today = () => new Date(env.clock.ms).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(env.clock.ms - n * 86_400_000).toISOString().slice(0, 10);

beforeEach(async () => {
  env = await createTestEnv();
  admin = env.setup.adminUserId;
});
afterEach(() => env.cleanup());

const flow = (from: string, to: string) => cashFlow(env.db, ctx(), { from, to });

describe('cash book entries', () => {
  it('an opening balance on an earlier day becomes the opening cash of the next days', () => {
    createCashAdjustment(env.db, ctx(), {
      kind: 'opening',
      amountMinor: 5_000_00,
      entryDate: daysAgo(10),
      note: 'Cash in the safe',
    });
    const cf = flow(daysAgo(5), today());
    expect(cf.openingCashMinor).toBe(5_000_00);
    expect(cf.closingCashMinor).toBe(5_000_00);
  });

  it('an entry inside the range shows as cash in or out and moves the closing cash', () => {
    createCashAdjustment(env.db, ctx(), {
      kind: 'opening',
      amountMinor: 1_000_00,
      entryDate: daysAgo(3),
      note: 'Starting cash',
    });
    createCashAdjustment(env.db, ctx(), {
      kind: 'adjustment',
      amountMinor: -250_00,
      entryDate: daysAgo(1),
      note: 'Count was short',
    });
    createCashAdjustment(env.db, ctx(), {
      kind: 'adjustment',
      amountMinor: 100_00,
      entryDate: daysAgo(1),
      note: 'Owner put cash in',
    });
    const cf = flow(daysAgo(3), today());
    expect(cf.cashIn).toMatchObject({ adjustmentsMinor: 1_100_00, totalMinor: 1_100_00 });
    expect(cf.cashOut).toMatchObject({ adjustmentsMinor: 250_00, totalMinor: 250_00 });
    expect(cf.closingCashMinor).toBe(850_00);
    expect(cf.byMode.find((m) => m.kind === 'cash')?.adjustmentsMinor).toBe(850_00);
    expect(cf.daily.at(-1)?.closingMinor).toBe(850_00);
  });

  it('works together with expenses paid in cash', () => {
    createCashAdjustment(env.db, ctx(), {
      kind: 'opening',
      amountMinor: 2_000_00,
      entryDate: daysAgo(2),
      note: 'Starting cash',
    });
    const cash = env.db
      .select()
      .from(paymentModes)
      .all()
      .find((m) => m.kind === 'cash')!;
    const cat = listExpenseCategories(env.db, ctx())[0]!;
    createExpense(env.db, ctx(), {
      categoryId: cat.id,
      amountMinor: 300_00,
      modeId: cash.id,
      expenseDate: daysAgo(1),
    });
    expect(flow(daysAgo(2), today()).closingCashMinor).toBe(1_700_00);
  });

  it('only one opening balance per branch; void it to enter another; voided entries do not count', () => {
    const first = createCashAdjustment(env.db, ctx(), {
      kind: 'opening',
      amountMinor: 100_00,
      entryDate: daysAgo(4),
      note: 'Starting cash',
    });
    expect(() =>
      createCashAdjustment(env.db, ctx(), {
        kind: 'opening',
        amountMinor: 200_00,
        entryDate: daysAgo(4),
        note: 'Again',
      }),
    ).toThrow(/already has an opening/);
    voidCashAdjustment(env.db, ctx(), { id: first.id, reason: 'Wrong amount typed' });
    expect(flow(daysAgo(3), today()).openingCashMinor).toBe(0);
    createCashAdjustment(env.db, ctx(), {
      kind: 'opening',
      amountMinor: 200_00,
      entryDate: daysAgo(4),
      note: 'Correct amount',
    });
    expect(flow(daysAgo(3), today()).openingCashMinor).toBe(200_00);
    const rows = listCashAdjustments(env.db, ctx());
    expect(rows.map((r) => r.status).sort()).toEqual(['posted', 'void']);
    expect(rows.find((r) => r.status === 'void')?.voidReason).toBe('Wrong amount typed');
  });

  it('validates input', () => {
    const bad = (input: Parameters<typeof createCashAdjustment>[2]) =>
      expect(() => createCashAdjustment(env.db, ctx(), input)).toThrow(DomainError);
    bad({ kind: 'opening', amountMinor: 0, note: 'x y z' });
    bad({ kind: 'opening', amountMinor: -5, note: 'negative opening' });
    bad({ kind: 'adjustment', amountMinor: 1.5, note: 'a float' });
    bad({ kind: 'adjustment', amountMinor: 100, note: 'ab' });
    bad({ kind: 'adjustment', amountMinor: 100, note: 'future', entryDate: '2999-01-01' });
    bad({ kind: 'adjustment', amountMinor: 100, note: 'bad date', entryDate: '05/10/2026' });
  });

  it('a posted entry cannot be changed or deleted, only voided (triggers), and voiding twice is refused', () => {
    const e = createCashAdjustment(env.db, ctx(), {
      kind: 'adjustment',
      amountMinor: 500,
      note: 'test entry',
    });
    const raw = env.handle.raw;
    expect(() =>
      raw.prepare('UPDATE cash_adjustments SET amount_minor = 1 WHERE id = ?').run(e.id),
    ).toThrow(/cannot be changed/);
    expect(() => raw.prepare('DELETE FROM cash_adjustments WHERE id = ?').run(e.id)).toThrow(
      /never deleted/,
    );
    voidCashAdjustment(env.db, ctx(), { id: e.id, reason: 'entered by mistake' });
    expect(() => voidCashAdjustment(env.db, ctx(), { id: e.id, reason: 'again' })).toThrow(
      /already void/,
    );
    expect(() =>
      raw.prepare("UPDATE cash_adjustments SET status = 'posted' WHERE id = ?").run(e.id),
    ).toThrow(/cannot be changed/);
  });

  it('gets a numbered document and writes audit and sync records', () => {
    const e = createCashAdjustment(env.db, ctx(), {
      kind: 'adjustment',
      amountMinor: 700,
      note: 'for the record',
    });
    expect(e.docNo).toMatch(/-CSH-\d{6}$/);
    const n = env.handle.raw
      .prepare("SELECT count(*) AS n FROM sync_outbox WHERE entity_type = 'cash_adjustments'")
      .get() as { n: number };
    expect(n.n).toBe(1);
  });
});

describe('role migration: Branch Manager finance rights on existing databases', () => {
  const sqlText = readFileSync(
    join(__dirname, '../../migrations/sqlite/0013_grant_branch_manager_finance.sql'),
    'utf8',
  );
  const KEYS = ['finance.expense.delete', 'finance.expense.export', 'finance.ledger.create'];
  const granted = () =>
    (
      env.handle.raw
        .prepare(
          "SELECT rp.permission_key AS k FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code = 'branch_manager' AND rp.permission_key LIKE 'finance.%' ORDER BY 1",
        )
        .all() as { k: string }[]
    ).map((r) => r.k);

  it('new databases already have the rights', () => {
    for (const k of KEYS) expect(granted()).toContain(k);
  });

  it('adds the rights to an older database that lacks them, and is safe to run twice', () => {
    env.handle.raw
      .prepare(
        "DELETE FROM role_permissions WHERE permission_key IN (?, ?, ?) AND role_id IN (SELECT id FROM roles WHERE code = 'branch_manager')",
      )
      .run(...KEYS);
    for (const k of KEYS) expect(granted()).not.toContain(k);
    env.handle.raw.exec(sqlText);
    const once = granted();
    for (const k of KEYS) expect(once).toContain(k);
    env.handle.raw.exec(sqlText);
    expect(granted()).toEqual(once);
  });

  it('does not touch other roles', () => {
    const before = env.handle.raw
      .prepare(
        "SELECT count(*) AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code <> 'branch_manager'",
      )
      .get() as { n: number };
    env.handle.raw.exec(sqlText);
    const after = env.handle.raw
      .prepare(
        "SELECT count(*) AS n FROM role_permissions rp JOIN roles r ON r.id = rp.role_id WHERE r.code <> 'branch_manager'",
      )
      .get() as { n: number };
    expect(after.n).toBe(before.n);
  });
});
