import { and, desc, eq } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { branchToday, nextDocNo } from '../pharmacy/common';
import { cashAdjustments, paymentModes } from '../schema/sqlite-all';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface CashAdjustmentInput {
  /** `opening` is the cash already in the safe and till on the day cash tracking starts. */
  kind: 'opening' | 'adjustment';
  /** Signed paisa: positive adds cash, negative removes it. An opening balance cannot be negative. */
  amountMinor: number;
  /** Branch-local 'YYYY-MM-DD'. Defaults to today; cannot be in the future. */
  entryDate?: string;
  /** What the entry is for (required: it is the audit trail of an unusual cash movement). */
  note: string;
}

/** The cash mode the entry is counted under: the first active payment mode of kind cash. */
function cashModeId(tx: DbOrTx, ctx: WriteContext): string {
  const mode = tx
    .select({ id: paymentModes.id })
    .from(paymentModes)
    .where(
      and(
        eq(paymentModes.tenantId, ctx.tenantId),
        eq(paymentModes.kind, 'cash'),
        eq(paymentModes.isActive, true),
      ),
    )
    .orderBy(paymentModes.sortOrder, paymentModes.name)
    .get();
  if (!mode) throw new DomainError('INVALID', 'There is no active cash payment method');
  return mode.id;
}

/**
 * Add a cash book entry: the opening balance (cash already on hand when tracking starts) or a
 * correction (a count that did not match, money the owner put in or took out). Entries are
 * immutable once posted; a wrong one is voided with a reason and stays on record.
 */
export function createCashAdjustment(
  db: Db,
  ctx: WriteContext,
  input: CashAdjustmentInput,
): { id: string; docNo: string } {
  if (input.kind !== 'opening' && input.kind !== 'adjustment')
    throw new DomainError('INVALID', 'Choose opening balance or adjustment');
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0)
    throw new DomainError('INVALID', 'Enter an amount (it cannot be zero)');
  if (input.kind === 'opening' && input.amountMinor < 0)
    throw new DomainError('INVALID', 'An opening balance cannot be negative');
  const note = input.note.trim();
  if (note.length < 3) throw new DomainError('INVALID', 'Write what this entry is for');
  return db.transaction((tx) => {
    const today = branchToday(tx, ctx);
    const date = input.entryDate ?? today;
    if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)))
      throw new DomainError('INVALID', 'Enter the date like 2026-10-05');
    if (date > today) throw new DomainError('INVALID', 'An entry cannot be dated in the future');
    if (input.kind === 'opening') {
      const existing = tx
        .select({ docNo: cashAdjustments.docNo })
        .from(cashAdjustments)
        .where(
          and(
            eq(cashAdjustments.branchId, ctx.branchId),
            eq(cashAdjustments.kind, 'opening'),
            eq(cashAdjustments.status, 'posted'),
          ),
        )
        .get();
      if (existing)
        throw new DomainError(
          'CONFLICT',
          `This branch already has an opening balance (${existing.docNo}). Void it first, or use an adjustment`,
        );
    }
    const now = isoNow(ctx);
    const id = newId();
    const docNo = nextDocNo(tx, ctx, 'CSH');
    const row = {
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      entryDate: date,
      kind: input.kind,
      amountMinor: input.amountMinor,
      modeId: cashModeId(tx, ctx),
      note: note.slice(0, 300),
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
    tx.insert(cashAdjustments).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'cash_adjustments',
      entityId: id,
      op: 'insert',
      payload: row,
    });
    appendAudit(tx, ctx, {
      action: 'cash_adjustment.create',
      entityType: 'cash_adjustment',
      entityId: id,
      newValue: { docNo, kind: input.kind, amountMinor: input.amountMinor, entryDate: date },
    });
    return { id, docNo };
  });
}

export function voidCashAdjustment(
  db: Db,
  ctx: WriteContext,
  input: { id: string; reason: string },
): void {
  const reason = input.reason.trim();
  if (reason.length < 3) throw new DomainError('INVALID', 'Give a reason for voiding');
  db.transaction((tx) => {
    const cur = tx
      .select()
      .from(cashAdjustments)
      .where(and(eq(cashAdjustments.id, input.id), eq(cashAdjustments.branchId, ctx.branchId)))
      .get();
    if (!cur) throw new DomainError('NOT_FOUND', 'Entry not found');
    if (cur.status !== 'posted') throw new DomainError('CONFLICT', 'This entry is already void');
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
    tx.update(cashAdjustments).set(change).where(eq(cashAdjustments.id, cur.id)).run();
    recordChange(tx, ctx, {
      entityType: 'cash_adjustments',
      entityId: cur.id,
      op: 'update',
      payload: { id: cur.id, ...change, baseVersion: cur.version },
    });
    appendAudit(tx, ctx, {
      action: 'cash_adjustment.void',
      entityType: 'cash_adjustment',
      entityId: cur.id,
      newValue: { docNo: cur.docNo, amountMinor: cur.amountMinor, reason },
    });
  });
}

export interface CashAdjustmentRow {
  id: string;
  docNo: string;
  entryDate: string;
  kind: 'opening' | 'adjustment';
  amountMinor: number;
  note: string;
  status: 'posted' | 'void';
  voidReason: string | null;
  createdAt: string;
}

export function listCashAdjustments(
  db: DbOrTx,
  ctx: WriteContext,
  limit = 100,
): CashAdjustmentRow[] {
  return db
    .select()
    .from(cashAdjustments)
    .where(eq(cashAdjustments.branchId, ctx.branchId))
    .orderBy(desc(cashAdjustments.entryDate), desc(cashAdjustments.createdAt))
    .limit(Math.min(limit, 500))
    .all()
    .map((r) => ({
      id: r.id,
      docNo: r.docNo,
      entryDate: r.entryDate,
      kind: r.kind as 'opening' | 'adjustment',
      amountMinor: r.amountMinor,
      note: r.note,
      status: r.status as 'posted' | 'void',
      voidReason: r.voidReason,
      createdAt: r.createdAt,
    }));
}
