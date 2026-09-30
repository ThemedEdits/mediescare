import { and, eq } from 'drizzle-orm';
import { formatDocNo, takeNumber, type DocType } from '@mediescare/core';
import { newId } from '@mediescare/sync';
import type { DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { branches, docCounters } from '../schema/sqlite-all';

/** Today's calendar date ('YYYY-MM-DD') in the branch's time zone. Batch expiry is compared against this. */
export function branchToday(tx: DbOrTx, ctx: WriteContext): string {
  const branch = tx
    .select({ tz: branches.timezone })
    .from(branches)
    .where(eq(branches.id, ctx.branchId))
    .get();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: branch?.tz ?? 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(isoNow(ctx)));
  return parts; // en-CA formats as YYYY-MM-DD
}

/**
 * Next human document number for this branch and type, for example KHI01-INV-000123.
 * Numbers come from a per-branch counter reserved in blocks (ADR-0004), so branches never collide.
 * Call inside the transaction that saves the document, so a rolled-back save does not burn a number.
 */
export function nextDocNo(tx: DbOrTx, ctx: WriteContext, type: DocType): string {
  const branch = tx
    .select({ code: branches.code })
    .from(branches)
    .where(eq(branches.id, ctx.branchId))
    .get();
  if (!branch) throw new Error('Branch not found');
  const row = tx
    .select()
    .from(docCounters)
    .where(and(eq(docCounters.branchId, ctx.branchId), eq(docCounters.docType, type)))
    .get();
  const { seq, state } = takeNumber(
    row ? { next: row.nextNo, blockEnd: row.blockEnd } : { next: 1, blockEnd: 0 },
  );
  const now = isoNow(ctx);
  if (row) {
    tx.update(docCounters)
      .set({ nextNo: state.next, blockEnd: state.blockEnd, updatedAt: now })
      .where(eq(docCounters.id, row.id))
      .run();
  } else {
    tx.insert(docCounters)
      .values({
        id: newId(),
        tenantId: ctx.tenantId,
        branchId: ctx.branchId,
        docType: type,
        nextNo: state.next,
        blockEnd: state.blockEnd,
        epoch: 1,
        updatedAt: now,
      })
      .run();
  }
  return formatDocNo(branch.code, type, seq);
}

/** Wraps an unexpected numeric error from pure logic as a user-facing INVALID error. */
export function asRangeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Invalid value';
}
