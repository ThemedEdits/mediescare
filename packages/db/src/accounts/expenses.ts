import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { branchToday, nextDocNo } from '../pharmacy/common';
import { getOpenShift } from '../pharmacy/pos';
import { resolveRange } from '../reports/util';
import { expenseCategories, expenses, paymentModes, shifts } from '../schema/sqlite-all';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface ExpenseInput {
  categoryId: string;
  amountMinor: number;
  modeId: string;
  /** Branch-local 'YYYY-MM-DD'. Defaults to today; cannot be in the future. */
  expenseDate?: string;
  payee?: string;
  reference?: string;
  note?: string;
  /** Cash taken from the cashier's till: lowers the expected cash of the user's open shift. Cash only. */
  fromTill?: boolean;
}

const clean = (v: string | undefined, max: number): string | null => {
  const t = v?.trim();
  return t ? t.slice(0, max) : null;
};

/**
 * Record an expense. Posted expenses are immutable (database triggers); a mistake is voided with a reason.
 * An expense is money spent on something other than stock: buying goods for sale goes through purchasing.
 */
export function createExpense(
  db: Db,
  ctx: WriteContext,
  input: ExpenseInput,
): { id: string; docNo: string } {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new DomainError('INVALID', 'Enter an amount above zero');
  return db.transaction((tx) => {
    const today = branchToday(tx, ctx);
    const date = input.expenseDate ?? today;
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
      throw new DomainError('INVALID', 'Enter the date like 2026-10-05');
    if (date > today) throw new DomainError('INVALID', 'An expense cannot be dated in the future');

    const category = tx
      .select()
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.id, input.categoryId),
          eq(expenseCategories.tenantId, ctx.tenantId),
        ),
      )
      .get();
    if (!category || !category.isActive) throw new DomainError('INVALID', 'Choose a category');

    const mode = tx
      .select()
      .from(paymentModes)
      .where(
        and(
          eq(paymentModes.id, input.modeId),
          eq(paymentModes.tenantId, ctx.tenantId),
          eq(paymentModes.isActive, true),
        ),
      )
      .get();
    if (!mode || mode.kind === 'credit')
      throw new DomainError('INVALID', 'Choose how the expense was paid');

    let shiftId: string | null = null;
    if (input.fromTill) {
      if (mode.kind !== 'cash')
        throw new DomainError('INVALID', 'Only cash can be taken from the till');
      if (!ctx.userId) throw new DomainError('INVALID', 'Sign in first');
      const shift = getOpenShift(tx, ctx.branchId, ctx.userId);
      if (!shift)
        throw new DomainError('SHIFT_REQUIRED', 'Open your shift to pay an expense from the till');
      if (date !== today)
        throw new DomainError('INVALID', 'An expense taken from the till is dated today');
      shiftId = shift.id;
    }

    const now = isoNow(ctx);
    const id = newId();
    const docNo = nextDocNo(tx, ctx, 'EXP');
    const row = {
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      expenseDate: date,
      categoryId: category.id,
      amountMinor: input.amountMinor,
      modeId: mode.id,
      payee: clean(input.payee, 120),
      reference: clean(input.reference, 80),
      note: clean(input.note, 300),
      shiftId,
      status: 'posted',
      voidReason: null,
      voidedBy: null,
      voidedAt: null,
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(expenses).values(row).run();
    recordChange(tx, ctx, { entityType: 'expenses', entityId: id, op: 'insert', payload: row });
    appendAudit(tx, ctx, {
      action: 'expense.create',
      entityType: 'expense',
      entityId: id,
      newValue: {
        docNo,
        expenseDate: date,
        category: category.name,
        amountMinor: input.amountMinor,
        mode: mode.code,
        fromTill: shiftId !== null,
      },
    });
    return { id, docNo };
  });
}

/**
 * Void an expense: it stays in the books marked void, with who, when and why, and no longer counts in totals.
 * An expense paid from a till whose shift is already closed cannot be voided (the cash count is final).
 */
export function voidExpense(
  db: Db,
  ctx: WriteContext,
  input: { expenseId: string; reason: string },
): void {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError('INVALID', 'Give a reason for voiding');
  db.transaction((tx) => {
    const cur = tx
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, input.expenseId), eq(expenses.branchId, ctx.branchId)))
      .get();
    if (!cur) throw new DomainError('NOT_FOUND', 'Expense not found');
    if (cur.status !== 'posted') throw new DomainError('CONFLICT', 'This expense is already void');
    if (cur.shiftId) {
      const shift = tx.select().from(shifts).where(eq(shifts.id, cur.shiftId)).get();
      if (shift && shift.status !== 'open')
        throw new DomainError(
          'CONFLICT',
          'This was paid from a till whose shift is closed. Record a correcting entry instead',
        );
    }
    const now = isoNow(ctx);
    const change = {
      status: 'void',
      voidReason: reason,
      voidedBy: ctx.userId,
      voidedAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: cur.version + 1,
    };
    tx.update(expenses).set(change).where(eq(expenses.id, cur.id)).run();
    recordChange(tx, ctx, {
      entityType: 'expenses',
      entityId: cur.id,
      op: 'update',
      payload: { id: cur.id, ...change, baseVersion: cur.version },
    });
    appendAudit(tx, ctx, {
      action: 'expense.void',
      entityType: 'expense',
      entityId: cur.id,
      newValue: { docNo: cur.docNo, amountMinor: cur.amountMinor, reason },
    });
  });
}

export interface ExpenseFilters {
  from?: string;
  to?: string;
  categoryId?: string;
  modeId?: string;
  status?: 'posted' | 'void';
  page?: number;
  pageSize?: number;
}

export interface ExpenseListRow {
  id: string;
  docNo: string;
  expenseDate: string;
  categoryId: string;
  categoryName: string;
  amountMinor: number;
  modeId: string;
  modeName: string;
  modeKind: string;
  payee: string | null;
  reference: string | null;
  note: string | null;
  fromTill: boolean;
  status: 'posted' | 'void';
  voidReason: string | null;
  voidedAt: string | null;
  createdAt: string;
}

export interface ExpenseList {
  rows: ExpenseListRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Sum of the posted expenses matching the filters (not only the page shown). */
  postedTotalMinor: number;
  range: { from: string; to: string };
}

export function listExpenses(db: Db, ctx: WriteContext, f: ExpenseFilters = {}): ExpenseList {
  const range = resolveRange(db, ctx, f, 30);
  const page = Math.max(1, Math.trunc(f.page ?? 1));
  const pageSize = Math.min(100_000, Math.max(1, Math.trunc(f.pageSize ?? 50)));
  const conds: SQL[] = [
    eq(expenses.branchId, ctx.branchId),
    gte(expenses.expenseDate, range.from),
    lte(expenses.expenseDate, range.to),
  ];
  if (f.categoryId) conds.push(eq(expenses.categoryId, f.categoryId));
  if (f.modeId) conds.push(eq(expenses.modeId, f.modeId));
  if (f.status) conds.push(eq(expenses.status, f.status));
  const where = and(...conds);

  const totals = db
    .select({
      n: sql<number>`count(*)`,
      posted: sql<number>`COALESCE(SUM(CASE WHEN ${expenses.status} = 'posted' THEN ${expenses.amountMinor} ELSE 0 END), 0)`,
    })
    .from(expenses)
    .where(where)
    .get();
  const rows = db
    .select({
      e: expenses,
      categoryName: expenseCategories.name,
      modeName: paymentModes.name,
      modeKind: paymentModes.kind,
    })
    .from(expenses)
    .innerJoin(expenseCategories, eq(expenseCategories.id, expenses.categoryId))
    .innerJoin(paymentModes, eq(paymentModes.id, expenses.modeId))
    .where(where)
    .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt), desc(expenses.docNo))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
    .all()
    .map((r): ExpenseListRow => ({
      id: r.e.id,
      docNo: r.e.docNo,
      expenseDate: r.e.expenseDate,
      categoryId: r.e.categoryId,
      categoryName: r.categoryName,
      amountMinor: r.e.amountMinor,
      modeId: r.e.modeId,
      modeName: r.modeName,
      modeKind: r.modeKind,
      payee: r.e.payee,
      reference: r.e.reference,
      note: r.e.note,
      fromTill: r.e.shiftId !== null,
      status: r.e.status as 'posted' | 'void',
      voidReason: r.e.voidReason,
      voidedAt: r.e.voidedAt,
      createdAt: r.e.createdAt,
    }));
  return {
    rows,
    total: Number(totals?.n ?? 0),
    page,
    pageSize,
    postedTotalMinor: Number(totals?.posted ?? 0),
    range: { from: range.from, to: range.to },
  };
}
