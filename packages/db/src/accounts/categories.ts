import { and, asc, eq, sql } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import { expenseCategories } from '../schema/sqlite-all';

export const EXPENSE_KINDS = ['operating', 'payroll', 'rent', 'utilities', 'other'] as const;
export type ExpenseKind = (typeof EXPENSE_KINDS)[number];

/** Starting list. Owners rename, add and deactivate them freely: nothing in the code depends on a name. */
const DEFAULT_CATEGORIES: readonly { name: string; kind: ExpenseKind }[] = [
  { name: 'Rent', kind: 'rent' },
  { name: 'Salaries and wages', kind: 'payroll' },
  { name: 'Electricity', kind: 'utilities' },
  { name: 'Gas and water', kind: 'utilities' },
  { name: 'Internet and phone', kind: 'utilities' },
  { name: 'Repairs and maintenance', kind: 'operating' },
  { name: 'Transport and delivery', kind: 'operating' },
  { name: 'Cleaning and supplies', kind: 'operating' },
  { name: 'Bank and card charges', kind: 'operating' },
  { name: 'Licences and fees', kind: 'other' },
  { name: 'Marketing', kind: 'other' },
  { name: 'Miscellaneous', kind: 'other' },
];

export interface ExpenseCategoryRow {
  id: string;
  name: string;
  kind: ExpenseKind;
  isActive: boolean;
  sortOrder: number;
  version: number;
}

function toRow(r: typeof expenseCategories.$inferSelect): ExpenseCategoryRow {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as ExpenseKind,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    version: r.version,
  };
}

function cleanName(name: string): string {
  const n = name.trim().replace(/\s+/g, ' ');
  if (n.length < 2 || n.length > 60)
    throw new DomainError('INVALID', 'Name must be 2 to 60 letters');
  return n;
}

function assertKind(kind: string): asserts kind is ExpenseKind {
  if (!(EXPENSE_KINDS as readonly string[]).includes(kind))
    throw new DomainError('INVALID', 'Choose a category kind');
}

const countFor = (db: DbOrTx, tenantId: string): number =>
  Number(
    db
      .select({ n: sql<number>`count(*)` })
      .from(expenseCategories)
      .where(eq(expenseCategories.tenantId, tenantId))
      .get()?.n ?? 0,
  );

/** Put the default categories in the first time the list is opened (also on databases made before accounts existed). */
function ensureDefaults(db: Db, ctx: WriteContext): void {
  if (countFor(db, ctx.tenantId) > 0) return;
  db.transaction((tx) => {
    if (countFor(tx, ctx.tenantId) > 0) return;
    const now = isoNow(ctx);
    DEFAULT_CATEGORIES.forEach((c, i) => {
      const row = {
        id: newId(),
        tenantId: ctx.tenantId,
        name: c.name,
        kind: c.kind,
        isActive: true,
        sortOrder: i + 1,
        createdAt: now,
        updatedAt: now,
        hlc: ctx.clock.tick(),
        version: 1,
      };
      tx.insert(expenseCategories).values(row).run();
      recordChange(tx, ctx, {
        entityType: 'expense_categories',
        entityId: row.id,
        op: 'insert',
        payload: row,
      });
    });
    appendAudit(tx, ctx, {
      action: 'expense_category.seed',
      entityType: 'expense_category',
      newValue: { count: DEFAULT_CATEGORIES.length },
    });
  });
}

export function listExpenseCategories(
  db: Db,
  ctx: WriteContext,
  opts: { includeInactive?: boolean } = {},
): ExpenseCategoryRow[] {
  ensureDefaults(db, ctx);
  const where = opts.includeInactive
    ? eq(expenseCategories.tenantId, ctx.tenantId)
    : and(eq(expenseCategories.tenantId, ctx.tenantId), eq(expenseCategories.isActive, true));
  return db
    .select()
    .from(expenseCategories)
    .where(where)
    .orderBy(asc(expenseCategories.sortOrder), asc(expenseCategories.name))
    .all()
    .map(toRow);
}

export function createExpenseCategory(
  db: Db,
  ctx: WriteContext,
  input: { name: string; kind?: string },
): { id: string } {
  const name = cleanName(input.name);
  const kind = input.kind ?? 'operating';
  assertKind(kind);
  ensureDefaults(db, ctx);
  return db.transaction((tx) => {
    const dup = tx
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(
        and(
          eq(expenseCategories.tenantId, ctx.tenantId),
          sql`lower(${expenseCategories.name}) = ${name.toLowerCase()}`,
        ),
      )
      .get();
    if (dup) throw new DomainError('CONFLICT', 'A category with this name already exists');
    const max = tx
      .select({ m: sql<number>`COALESCE(MAX(${expenseCategories.sortOrder}), 0)` })
      .from(expenseCategories)
      .where(eq(expenseCategories.tenantId, ctx.tenantId))
      .get();
    const now = isoNow(ctx);
    const row = {
      id: newId(),
      tenantId: ctx.tenantId,
      name,
      kind,
      isActive: true,
      sortOrder: Number(max?.m ?? 0) + 1,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(expenseCategories).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'expense_categories',
      entityId: row.id,
      op: 'insert',
      payload: row,
    });
    appendAudit(tx, ctx, {
      action: 'expense_category.create',
      entityType: 'expense_category',
      entityId: row.id,
      newValue: { name, kind },
    });
    return { id: row.id };
  });
}

export interface UpdateExpenseCategoryInput {
  id: string;
  version: number;
  name?: string;
  kind?: string;
  isActive?: boolean;
}

/** Rename, change kind, or deactivate (a category with past expenses is never deleted, only hidden from new entries). */
export function updateExpenseCategory(
  db: Db,
  ctx: WriteContext,
  input: UpdateExpenseCategoryInput,
): ExpenseCategoryRow {
  return db.transaction((tx) => {
    const cur = tx
      .select()
      .from(expenseCategories)
      .where(and(eq(expenseCategories.id, input.id), eq(expenseCategories.tenantId, ctx.tenantId)))
      .get();
    if (!cur) throw new DomainError('NOT_FOUND', 'Category not found');
    if (cur.version !== input.version)
      throw new DomainError('VERSION_CONFLICT', 'Someone else changed this category. Reload it');
    const change: Partial<typeof expenseCategories.$inferInsert> = {};
    if (input.name !== undefined) {
      const name = cleanName(input.name);
      const dup = tx
        .select({ id: expenseCategories.id })
        .from(expenseCategories)
        .where(
          and(
            eq(expenseCategories.tenantId, ctx.tenantId),
            sql`lower(${expenseCategories.name}) = ${name.toLowerCase()}`,
            sql`${expenseCategories.id} <> ${cur.id}`,
          ),
        )
        .get();
      if (dup) throw new DomainError('CONFLICT', 'A category with this name already exists');
      change.name = name;
    }
    if (input.kind !== undefined) {
      assertKind(input.kind);
      change.kind = input.kind;
    }
    if (input.isActive !== undefined) change.isActive = input.isActive;
    if (Object.keys(change).length === 0) return toRow(cur);
    const full = {
      ...change,
      updatedAt: isoNow(ctx),
      hlc: ctx.clock.tick(),
      version: cur.version + 1,
    };
    tx.update(expenseCategories).set(full).where(eq(expenseCategories.id, cur.id)).run();
    recordChange(tx, ctx, {
      entityType: 'expense_categories',
      entityId: cur.id,
      op: 'update',
      payload: { id: cur.id, ...full, baseVersion: cur.version },
    });
    appendAudit(tx, ctx, {
      action: 'expense_category.update',
      entityType: 'expense_category',
      entityId: cur.id,
      oldValue: { name: cur.name, kind: cur.kind, isActive: cur.isActive },
      newValue: change,
    });
    return toRow({ ...cur, ...full });
  });
}
