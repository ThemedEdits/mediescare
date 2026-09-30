import { and, eq } from 'drizzle-orm';
import { createEnrollmentCode, newId, type TokenProvider } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { branches } from '../schema/sqlite';

export const BRANCH_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,7}$/;

export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
  status: string;
}

export function listBranches(db: Db, tenantId: string): BranchSummary[] {
  return db
    .select({
      id: branches.id,
      code: branches.code,
      name: branches.name,
      isHeadOffice: branches.isHeadOffice,
      status: branches.status,
    })
    .from(branches)
    .where(eq(branches.tenantId, tenantId))
    .orderBy(branches.code)
    .all();
}

/** True if this server runs the Head Office branch of its organisation. */
export function isHeadOfficeBranch(db: Db, branchId: string): boolean {
  return (
    db
      .select({ isHeadOffice: branches.isHeadOffice })
      .from(branches)
      .where(eq(branches.id, branchId))
      .get()?.isHeadOffice ?? false
  );
}

/**
 * Head Office adds a branch to the organisation's registry. The row is written locally and queued
 * as a normal `branches` change, so it reaches the cloud and, from there, every branch. The branch
 * PC itself joins later with an enrollment code for this code and name.
 */
export function registerBranch(
  db: Db,
  ctx: WriteContext,
  input: { code: string; name: string },
): BranchSummary {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  if (!BRANCH_CODE_PATTERN.test(code))
    throw new DomainError(
      'INVALID',
      'Branch code: 2-8 capital letters or digits, starting with a letter',
    );
  if (name.length < 2) throw new DomainError('INVALID', 'Branch name is too short');
  return db.transaction((tx) => {
    const me = tx.select().from(branches).where(eq(branches.id, ctx.branchId)).get();
    if (!me?.isHeadOffice)
      throw new DomainError('INVALID', 'Only Head Office can add branches to the organisation');
    const taken = tx
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.tenantId, ctx.tenantId), eq(branches.code, code)))
      .get();
    if (taken) throw new DomainError('CONFLICT', `Branch code ${code} is already used`);
    const now = isoNow(ctx);
    const row = {
      id: newId(),
      tenantId: ctx.tenantId,
      code,
      name,
      isHeadOffice: false,
      address: null,
      licenceNo: null,
      ntn: null,
      timezone: me.timezone,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(branches).values(row).run();
    recordChange(tx, ctx, { entityType: 'branches', entityId: row.id, op: 'insert', payload: row });
    appendAudit(tx, ctx, {
      action: 'branch.register',
      entityType: 'branch',
      entityId: row.id,
      newValue: { code, name },
    });
    return { id: row.id, code, name, isHeadOffice: false, status: row.status };
  });
}

export interface EnrollmentCloud {
  cloudUrl: string;
  /** Access token of this Head Office PC (`RefreshingTokenProvider.provider()`). */
  provider: TokenProvider;
  fetchImpl?: typeof fetch;
  /** `createEnrollmentCode` from @mediescare/sync (injected so tests use a fake). */
  createCode?: typeof createEnrollmentCode;
}

export interface BranchEnrollment {
  branch: BranchSummary;
  /** One-time code for the branch PC. Shown once, never stored or logged here. */
  code: string;
  expiresAt: string;
  /** False when the branch row already existed (a new code for a branch that has not joined yet). */
  branchCreated: boolean;
}

/**
 * Head Office adds a branch (if it is not registered yet) and asks the cloud for a one-time
 * enrollment code for it. Asking again for the same code and name just issues a new code (the old one
 * expired or was lost); the branch row is created once. If the cloud cannot be reached, the branch
 * row stays (it syncs later like any record) and the owner retries to get the code.
 */
export async function issueBranchEnrollment(
  db: Db,
  ctx: WriteContext,
  input: { code: string; name: string },
  cloud: EnrollmentCloud,
): Promise<BranchEnrollment> {
  const code = input.code.trim().toUpperCase();
  const name = input.name.trim();
  const existing = db
    .select()
    .from(branches)
    .where(and(eq(branches.tenantId, ctx.tenantId), eq(branches.code, code)))
    .get();
  let branch: BranchSummary;
  let branchCreated = false;
  if (existing) {
    if (existing.isHeadOffice)
      throw new DomainError('INVALID', 'Head Office is already part of the organisation');
    if (existing.name.trim().toLowerCase() !== name.toLowerCase())
      throw new DomainError(
        'CONFLICT',
        `Branch code ${code} is already used by "${existing.name}". Use that name, or choose another code`,
      );
    branch = {
      id: existing.id,
      code: existing.code,
      name: existing.name,
      isHeadOffice: false,
      status: existing.status,
    };
  } else {
    branch = registerBranch(db, ctx, { code, name });
    branchCreated = true;
  }

  let issued: { code: string; expiresAt: string };
  try {
    issued = await (cloud.createCode ?? createEnrollmentCode)(cloud.provider, {
      cloudUrl: cloud.cloudUrl,
      branchCode: code,
      branchName: name,
      fetchImpl: cloud.fetchImpl,
    });
  } catch (error) {
    throw new DomainError(
      'INVALID',
      `${branchCreated ? 'The branch was added here, but the' : 'The'} cloud did not issue a code: ${error instanceof Error ? error.message : 'unknown error'}. Try again when the internet works`,
    );
  }
  db.transaction((tx) => {
    appendAudit(tx, ctx, {
      action: 'branch.enrollment_code.create',
      entityType: 'branch',
      entityId: branch.id,
      newValue: { branchCode: code, expiresAt: issued.expiresAt },
    });
  });
  return { branch, code: issued.code, expiresAt: issued.expiresAt, branchCreated };
}
