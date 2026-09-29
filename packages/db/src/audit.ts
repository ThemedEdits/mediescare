import { asc, desc, eq } from 'drizzle-orm';
import { chainEntry, verifyChain, type ChainedAuditEntry, type ChainVerification } from '@mediescare/core';
import { newId } from '@mediescare/sync';
import type { DbOrTx } from './client';
import { isoNow, type WriteContext } from './context';
import { auditLog } from './schema/sqlite';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

const toJson = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v));
const fromJson = (v: string | null): unknown => (v === null ? null : JSON.parse(v));

/**
 * Append one hash-chained audit row. Call inside the same transaction as the change it describes,
 * so the change and its audit trail commit or roll back together.
 */
export function appendAudit(tx: DbOrTx, ctx: WriteContext, input: AuditInput): ChainedAuditEntry {
  const last = tx
    .select({ seq: auditLog.seq, hash: auditLog.hash })
    .from(auditLog)
    .where(eq(auditLog.branchId, ctx.branchId))
    .orderBy(desc(auditLog.seq))
    .limit(1)
    .get();

  const entry = chainEntry(last?.hash ?? null, {
    id: newId(),
    branchId: ctx.branchId,
    seq: (last?.seq ?? 0) + 1,
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    oldJson: input.oldValue ?? null,
    newJson: input.newValue ?? null,
    at: isoNow(ctx),
  });

  tx.insert(auditLog)
    .values({
      id: entry.id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      seq: entry.seq,
      userId: entry.userId,
      deviceId: entry.deviceId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      oldJson: toJson(input.oldValue),
      newJson: toJson(input.newValue),
      at: entry.at,
      prevHash: entry.prevHash,
      hash: entry.hash,
      hlc: ctx.clock.tick(),
    })
    .run();
  return entry;
}

/** Re-read the branch's audit rows in order and verify the hash chain end to end. */
export function verifyAuditChain(db: DbOrTx, branchId: string): ChainVerification {
  const rows = db.select().from(auditLog).where(eq(auditLog.branchId, branchId)).orderBy(asc(auditLog.seq)).all();
  const entries: ChainedAuditEntry[] = rows.map((r) => ({
    id: r.id,
    branchId: r.branchId,
    seq: r.seq,
    userId: r.userId,
    deviceId: r.deviceId,
    action: r.action,
    entityType: r.entityType,
    entityId: r.entityId,
    oldJson: fromJson(r.oldJson),
    newJson: fromJson(r.newJson),
    at: r.at,
    prevHash: r.prevHash,
    hash: r.hash,
  }));
  return verifyChain(entries);
}
