import { and, eq, isNull } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from './audit';
import { loadAccessContext } from './auth/access';
import { verifyPassword } from './auth/password';
import { AuthError, LOCK_MS, MAX_FAILED_LOGINS } from './auth/login';
import type { Db, DbOrTx } from './client';
import { isoNow, type WriteContext } from './context';
import { DomainError } from './errors';
import { recordChange } from './outbox';
import { overrideEvents, roles, userRoles, users } from './schema/sqlite';

/** Manager PIN override (docs/phase0/permissions-matrix.md §6). */
export type OverrideKind = 'discount' | 'refund' | 'override_price' | 'void' | 'backdate';

export const OVERRIDE_TTL_MS = 2 * 60 * 1000;

const REQUIRED_PERMISSION: Record<OverrideKind, string> = {
  discount: 'pharmacy.sale.discount',
  refund: 'pharmacy.sale.refund',
  override_price: 'pharmacy.price.override_price',
  void: 'pharmacy.sale.void',
  backdate: 'pharmacy.sale.backdate',
};

export interface OverrideRequest {
  requesterId: string;
  approverUsername: string;
  approverPin: string;
  kind: OverrideKind;
  /** Refund or void amount in paisa. */
  amountMinor?: number;
  /** Discount or price reduction in basis points. */
  percentBp?: number;
  reference?: string;
  reason?: string;
}

export interface ApproverLimits {
  discountBp: number;
  refundMinor: number | null;
  priceBp: number;
}

export function roleLimitsFor(db: DbOrTx, userId: string): ApproverLimits {
  const rows = db
    .select()
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .all();
  return {
    discountBp: Math.max(0, ...rows.map((r) => r.roles.discountLimitBp)),
    // One role without a cap means no cap. Otherwise the highest cap.
    refundMinor: rows.some((r) => r.roles.refundLimitMinor === null)
      ? null
      : Math.max(0, ...rows.map((r) => r.roles.refundLimitMinor ?? 0)),
    priceBp: Math.max(0, ...rows.map((r) => r.roles.priceOverrideLimitBp)),
  };
}

/** Checks the amount against the approver's own limit. Returns a message when it is too high. */
export function limitProblem(
  kind: OverrideKind,
  limits: ApproverLimits,
  req: Pick<OverrideRequest, 'amountMinor' | 'percentBp'>,
): string | null {
  if (kind === 'discount' && (req.percentBp ?? 0) > limits.discountBp)
    return 'This discount is above your approval limit. Ask a higher role';
  if (kind === 'override_price' && (req.percentBp ?? 0) > limits.priceBp)
    return 'This price change is above your approval limit. Ask a higher role';
  if (
    kind === 'refund' &&
    limits.refundMinor !== null &&
    (req.amountMinor ?? 0) > limits.refundMinor
  )
    return 'This refund is above your approval limit. Ask a higher role';
  return null;
}

/**
 * Validate the approver's PIN and rights, then issue a single-use, 2-minute override for one action.
 * The requester never learns why a PIN failed beyond a generic message.
 */
export async function grantOverride(
  db: Db,
  ctx: WriteContext,
  req: OverrideRequest,
): Promise<{ overrideId: string; expiresAt: string }> {
  const needsReason =
    req.kind === 'refund' ||
    req.kind === 'void' ||
    (req.kind === 'discount' && (req.percentBp ?? 0) >= 10_000);
  if (needsReason && !req.reason?.trim())
    throw new DomainError('INVALID', 'A reason is required for this override');

  const approver = db
    .select()
    .from(users)
    .where(
      and(
        eq(users.tenantId, ctx.tenantId),
        eq(users.username, req.approverUsername),
        isNull(users.deletedAt),
      ),
    )
    .get();
  const pinOk = approver?.pinHash ? await verifyPassword(approver.pinHash, req.approverPin) : false;

  type Outcome =
    | { kind: 'ok'; overrideId: string; expiresAt: string }
    | { kind: 'denied' }
    | { kind: 'limit'; message: string };

  // Failures are recorded (audit, lockout counter) and committed, then reported after the
  // transaction. Throwing inside it would roll the record back.
  const outcome = db.transaction((tx): Outcome => {
    const now = new Date(isoNow(ctx));
    const deny = (detail: string, countFailure = false): Outcome => {
      if (approver && countFailure) {
        const failed = approver.failedLogins + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        tx.update(users)
          .set({
            failedLogins: lock ? 0 : failed,
            lockedUntil: lock ? new Date(now.getTime() + LOCK_MS).toISOString() : null,
          })
          .where(eq(users.id, approver.id))
          .run();
      }
      appendAudit(tx, ctx, {
        action: 'override.denied',
        entityType: 'override',
        entityId: null,
        newValue: { kind: req.kind, approver: req.approverUsername, reason: detail },
      });
      return { kind: 'denied' };
    };

    if (!approver || approver.status !== 'active') return deny('unknown_or_disabled');
    if (approver.lockedUntil && new Date(approver.lockedUntil) > now) return deny('locked');
    if (!pinOk) return deny('wrong_pin', true);
    if (approver.id === req.requesterId) return deny('self_approval');

    const access = loadAccessContext(tx, approver.id);
    if (!access || !access.permissions.has(REQUIRED_PERMISSION[req.kind]))
      return deny('no_permission');
    if (!access.allBranches && !access.branchIds.includes(ctx.branchId))
      return deny('wrong_branch');
    const problem = limitProblem(req.kind, roleLimitsFor(tx, approver.id), req);
    if (problem) return { kind: 'limit', message: problem };

    const id = newId();
    const expiresAt = new Date(now.getTime() + OVERRIDE_TTL_MS).toISOString();
    const row = {
      id,
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      requestedBy: req.requesterId,
      approvedBy: approver.id,
      kind: req.kind,
      reference: req.reference ?? null,
      amountMinor: req.amountMinor ?? null,
      reason: req.reason?.trim() ?? null,
      at: now.toISOString(),
      expiresAt,
      consumedAt: null,
      consumedReference: null,
      hlc: ctx.clock.tick(),
    };
    tx.update(users)
      .set({ failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, approver.id))
      .run();
    tx.insert(overrideEvents).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'override_events',
      entityId: id,
      op: 'insert',
      payload: row,
    });
    appendAudit(tx, ctx, {
      action: 'override.granted',
      entityType: 'override',
      entityId: id,
      newValue: {
        kind: req.kind,
        requester: req.requesterId,
        approver: approver.id,
        amountMinor: req.amountMinor ?? null,
        percentBp: req.percentBp ?? null,
        reason: row.reason,
      },
    });
    return { kind: 'ok', overrideId: id, expiresAt };
  });

  if (outcome.kind === 'denied')
    throw new AuthError('INVALID_CREDENTIALS', 'Approval was not accepted');
  if (outcome.kind === 'limit') throw new DomainError('OVERRIDE_INVALID', outcome.message);
  return { overrideId: outcome.overrideId, expiresAt: outcome.expiresAt };
}

export interface ConsumeInput {
  overrideId: string;
  kind: OverrideKind;
  requesterId: string;
  /** What the override is being used for. Single use: a second attempt fails. */
  reference: string;
  amountMinor?: number;
}

/** Use an override inside the transaction of the action it authorises. */
export function consumeOverride(tx: DbOrTx, ctx: WriteContext, input: ConsumeInput): void {
  const row = tx
    .select()
    .from(overrideEvents)
    .where(and(eq(overrideEvents.id, input.overrideId), eq(overrideEvents.branchId, ctx.branchId)))
    .get();
  const now = new Date(isoNow(ctx));
  const bad = (message: string): never => {
    throw new DomainError('OVERRIDE_INVALID', message);
  };
  if (!row) return bad('Manager approval not found');
  if (row.consumedAt) return bad('This approval was already used');
  if (!row.expiresAt || new Date(row.expiresAt) <= now)
    return bad('This approval has expired. Ask the manager again');
  if (row.kind !== input.kind) return bad('This approval is for a different action');
  if (row.requestedBy !== input.requesterId)
    return bad('This approval was given to a different user');
  if (
    input.amountMinor !== undefined &&
    row.amountMinor !== null &&
    input.amountMinor > row.amountMinor
  ) {
    return bad('The amount is higher than the manager approved');
  }
  tx.update(overrideEvents)
    .set({ consumedAt: now.toISOString(), consumedReference: input.reference })
    .where(eq(overrideEvents.id, row.id))
    .run();
  appendAudit(tx, ctx, {
    action: 'override.used',
    entityType: 'override',
    entityId: row.id,
    newValue: { kind: row.kind, reference: input.reference },
  });
}
