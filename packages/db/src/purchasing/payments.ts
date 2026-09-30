import { and, eq } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { nextDocNo } from '../pharmacy/common';
import { grns, paymentModes, supplierPayments, suppliers } from '../schema/sqlite-all';

export interface SupplierPaymentInput {
  supplierId: string;
  amountMinor: number;
  modeId: string;
  /** The bill being paid. Leave out for a payment on account (advance, or settling an opening balance). */
  grnId?: string | null;
  reference?: string;
  note?: string;
}

/** What a bill obliges us to pay the supplier: the total less tax withheld at payment (WHT goes to the tax office). */
export const payableMinor = (g: { totalMinor: number; whtMinor: number }): number =>
  g.totalMinor - g.whtMinor;

/**
 * Record a payment to a supplier. Paying a specific bill cannot exceed what it still owes.
 * Payments are immutable documents: a wrong one is corrected by a new entry, never edited.
 * (Supplier payments are made from the back office, not from the cashier's till, so they do not
 * change a shift's expected cash.)
 */
export function paySupplier(
  db: Db,
  ctx: WriteContext,
  input: SupplierPaymentInput,
): { id: string; docNo: string } {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new DomainError('INVALID', 'Enter an amount above zero');
  return db.transaction((tx) => {
    const supplier = tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(and(eq(suppliers.id, input.supplierId), eq(suppliers.tenantId, ctx.tenantId)))
      .get();
    if (!supplier) throw new DomainError('INVALID', 'Choose a supplier');
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
      throw new DomainError('INVALID', 'Choose how the payment is made');

    if (input.grnId) {
      const grn = tx
        .select()
        .from(grns)
        .where(and(eq(grns.id, input.grnId), eq(grns.branchId, ctx.branchId)))
        .get();
      if (!grn || grn.supplierId !== input.supplierId)
        throw new DomainError('INVALID', 'That bill does not belong to this supplier');
      const outstanding = payableMinor(grn) - grn.paidMinor;
      if (input.amountMinor > outstanding)
        throw new DomainError('INVALID', `This bill only has ${outstanding} paisa left to pay`, {
          outstandingMinor: outstanding,
        });
      tx.update(grns)
        .set({
          paidMinor: grn.paidMinor + input.amountMinor,
          updatedAt: isoNow(ctx),
          hlc: ctx.clock.tick(),
          version: grn.version + 1,
        })
        .where(eq(grns.id, grn.id))
        .run();
    }

    const now = isoNow(ctx);
    const id = newId();
    const docNo = nextDocNo(tx, ctx, 'PAY');
    const row = {
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      docNo,
      supplierId: input.supplierId,
      grnId: input.grnId ?? null,
      amountMinor: input.amountMinor,
      modeId: mode.id,
      reference: input.reference?.trim() || null,
      note: input.note?.trim() || null,
      paidAt: now,
      createdBy: ctx.userId,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(supplierPayments).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'supplier_payments',
      entityId: id,
      op: 'insert',
      payload: row,
    });
    appendAudit(tx, ctx, {
      action: 'supplier.payment',
      entityType: 'supplier_payment',
      entityId: id,
      newValue: {
        docNo,
        supplierId: input.supplierId,
        amountMinor: input.amountMinor,
        grnId: input.grnId ?? null,
        mode: mode.code,
      },
    });
    return { id, docNo };
  });
}
