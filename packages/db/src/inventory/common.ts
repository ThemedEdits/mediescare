import { and, eq, inArray } from 'drizzle-orm';
import type { DbOrTx } from '../client';
import type { WriteContext } from '../context';
import { DomainError } from '../errors';
import { branches, itemUnits, items, units } from '../schema/sqlite-all';

export interface BranchInfo {
  id: string;
  code: string;
  name: string;
  isHeadOffice: boolean;
  status: string;
}

const pick = (b: typeof branches.$inferSelect): BranchInfo => ({
  id: b.id,
  code: b.code,
  name: b.name,
  isHeadOffice: b.isHeadOffice,
  status: b.status,
});

export function getBranchInfo(tx: DbOrTx, tenantId: string, id: string): BranchInfo | undefined {
  const row = tx
    .select()
    .from(branches)
    .where(and(eq(branches.id, id), eq(branches.tenantId, tenantId)))
    .get();
  return row ? pick(row) : undefined;
}

/** The branch this server belongs to. */
export function ownBranch(tx: DbOrTx, ctx: WriteContext): BranchInfo {
  const b = getBranchInfo(tx, ctx.tenantId, ctx.branchId);
  if (!b) throw new DomainError('INVALID', 'This branch is not set up');
  return b;
}

export function headOfficeBranch(tx: DbOrTx, tenantId: string): BranchInfo | undefined {
  const row = tx
    .select()
    .from(branches)
    .where(and(eq(branches.tenantId, tenantId), eq(branches.isHeadOffice, true)))
    .get();
  return row ? pick(row) : undefined;
}

/** Branch names for display, by id. */
export function branchMap(tx: DbOrTx, tenantId: string, ids: string[]): Map<string, BranchInfo> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  return new Map(
    tx
      .select()
      .from(branches)
      .where(and(eq(branches.tenantId, tenantId), inArray(branches.id, unique)))
      .all()
      .map((b) => [b.id, pick(b)]),
  );
}

export const clampPage = (page?: number, pageSize?: number) => {
  const size = Math.min(Math.max(pageSize ?? 25, 1), 200);
  return { size, offset: (Math.max(page ?? 1, 1) - 1) * size };
};

export function positiveInt(value: number, message: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new DomainError('INVALID', message);
  return value;
}

export interface ItemInfo {
  id: string;
  sku: string;
  name: string;
  /** Units the item is counted in, largest first, for showing "2 box + 3 strip". */
  units: { name: string; factorToBase: number }[];
}

/** Names and units of items for display. Items are master data shared by every branch. */
export function itemInfoMap(tx: DbOrTx, tenantId: string, ids: string[]): Map<string, ItemInfo> {
  const unique = [...new Set(ids)];
  const out = new Map<string, ItemInfo>();
  if (unique.length === 0) return out;
  for (const r of tx
    .select({ id: items.id, sku: items.sku, name: items.name })
    .from(items)
    .where(and(eq(items.tenantId, tenantId), inArray(items.id, unique)))
    .all())
    out.set(r.id, { ...r, units: [] });
  for (const u of tx
    .select({ itemId: itemUnits.itemId, name: units.name, factorToBase: itemUnits.factorToBase })
    .from(itemUnits)
    .innerJoin(units, eq(units.id, itemUnits.unitId))
    .where(inArray(itemUnits.itemId, unique))
    .all())
    out.get(u.itemId)?.units.push({ name: u.name, factorToBase: u.factorToBase });
  for (const info of out.values()) info.units.sort((a, b) => b.factorToBase - a.factorToBase);
  return out;
}

/** Active branches other than this one: where a transfer can be sent. */
export function listOtherBranches(tx: DbOrTx, ctx: WriteContext): BranchInfo[] {
  return tx
    .select()
    .from(branches)
    .where(and(eq(branches.tenantId, ctx.tenantId), eq(branches.status, 'active')))
    .orderBy(branches.code)
    .all()
    .filter((b) => b.id !== ctx.branchId)
    .map(pick);
}

/** Who this server is: its branch and whether it is Head Office. Lets a screen choose what to offer. */
export function describeOwnBranch(tx: DbOrTx, ctx: WriteContext): BranchInfo {
  return ownBranch(tx, ctx);
}
