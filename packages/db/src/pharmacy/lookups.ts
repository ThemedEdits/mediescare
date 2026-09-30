import { and, asc, eq, like, or } from 'drizzle-orm';
import { newId } from '@mediescare/sync';
import { appendAudit } from '../audit';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { DomainError } from '../errors';
import { recordChange } from '../outbox';
import {
  categories,
  customers,
  manufacturers,
  paymentModes,
  racks,
  suppliers,
  units,
} from '../schema/sqlite-all';

export function listUnits(db: DbOrTx, tenantId: string) {
  return db
    .select({ id: units.id, code: units.code, name: units.name })
    .from(units)
    .where(eq(units.tenantId, tenantId))
    .orderBy(asc(units.name))
    .all();
}

export function listPaymentModes(db: DbOrTx, tenantId: string) {
  return db
    .select({
      id: paymentModes.id,
      code: paymentModes.code,
      name: paymentModes.name,
      kind: paymentModes.kind,
      opensDrawer: paymentModes.opensDrawer,
    })
    .from(paymentModes)
    .where(and(eq(paymentModes.tenantId, tenantId), eq(paymentModes.isActive, true)))
    .orderBy(asc(paymentModes.sortOrder))
    .all();
}

export function listCategories(db: DbOrTx, tenantId: string) {
  return db
    .select({ id: categories.id, name: categories.name })
    .from(categories)
    .where(eq(categories.tenantId, tenantId))
    .orderBy(asc(categories.name))
    .all();
}

export function listManufacturers(db: DbOrTx, tenantId: string) {
  return db
    .select({ id: manufacturers.id, name: manufacturers.name })
    .from(manufacturers)
    .where(eq(manufacturers.tenantId, tenantId))
    .orderBy(asc(manufacturers.name))
    .all();
}

export function listRacks(db: DbOrTx, branchId: string) {
  return db
    .select({ id: racks.id, code: racks.code })
    .from(racks)
    .where(eq(racks.branchId, branchId))
    .orderBy(asc(racks.code))
    .all();
}

export function listSuppliers(db: DbOrTx, tenantId: string, q?: string) {
  const term = q?.trim();
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      phone: suppliers.phone,
      ntn: suppliers.ntn,
      strn: suppliers.strn,
      termsDays: suppliers.termsDays,
      isActive: suppliers.isActive,
    })
    .from(suppliers)
    .where(
      and(
        eq(suppliers.tenantId, tenantId),
        term
          ? or(like(suppliers.name, `%${term}%`), like(suppliers.phone, `%${term}%`))
          : undefined,
      ),
    )
    .orderBy(asc(suppliers.name))
    .limit(200)
    .all();
}

function named<T extends { id: string }>(
  tx: DbOrTx,
  ctx: WriteContext,
  entity: string,
  table: 'categories' | 'manufacturers',
  name: string,
  find: () => T | undefined,
  insert: (row: Record<string, unknown>) => void,
): string {
  const clean = name.trim();
  if (clean.length < 2) throw new DomainError('INVALID', 'Name is too short');
  if (find()) throw new DomainError('CONFLICT', `${entity} "${clean}" already exists`);
  const now = isoNow(ctx);
  const row = {
    id: newId(),
    tenantId: ctx.tenantId,
    name: clean,
    createdAt: now,
    updatedAt: now,
    hlc: ctx.clock.tick(),
    version: 1,
  };
  insert(row);
  recordChange(tx, ctx, { entityType: table, entityId: row.id, op: 'insert', payload: row });
  appendAudit(tx, ctx, {
    action: `${table}.create`,
    entityType: table,
    entityId: row.id,
    newValue: { name: clean },
  });
  return row.id;
}

export function createCategory(db: Db, ctx: WriteContext, name: string): string {
  return db.transaction((tx) =>
    named(
      tx,
      ctx,
      'Category',
      'categories',
      name,
      () =>
        tx
          .select({ id: categories.id })
          .from(categories)
          .where(and(eq(categories.tenantId, ctx.tenantId), eq(categories.name, name.trim())))
          .get(),
      (row) =>
        tx
          .insert(categories)
          .values({ ...(row as typeof categories.$inferInsert), parentId: null })
          .run(),
    ),
  );
}

export function createManufacturer(db: Db, ctx: WriteContext, name: string): string {
  return db.transaction((tx) =>
    named(
      tx,
      ctx,
      'Manufacturer',
      'manufacturers',
      name,
      () =>
        tx
          .select({ id: manufacturers.id })
          .from(manufacturers)
          .where(and(eq(manufacturers.tenantId, ctx.tenantId), eq(manufacturers.name, name.trim())))
          .get(),
      (row) =>
        tx
          .insert(manufacturers)
          .values(row as typeof manufacturers.$inferInsert)
          .run(),
    ),
  );
}

export function createRack(db: Db, ctx: WriteContext, code: string): string {
  const clean = code.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9 _-]{0,19}$/.test(clean))
    throw new DomainError('INVALID', 'Rack code: letters, digits, dash, up to 20 characters');
  return db.transaction((tx) => {
    if (
      tx
        .select({ id: racks.id })
        .from(racks)
        .where(and(eq(racks.branchId, ctx.branchId), eq(racks.code, clean)))
        .get()
    )
      throw new DomainError('CONFLICT', 'That rack already exists');
    const now = isoNow(ctx);
    const row = {
      id: newId(),
      tenantId: ctx.tenantId,
      branchId: ctx.branchId,
      code: clean,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(racks).values(row).run();
    recordChange(tx, ctx, { entityType: 'racks', entityId: row.id, op: 'insert', payload: row });
    return row.id;
  });
}

export interface SupplierInput {
  name: string;
  phone?: string | null;
  ntn?: string | null;
  strn?: string | null;
  termsDays?: number;
  creditLimitMinor?: number;
}

export function createSupplier(db: Db, ctx: WriteContext, input: SupplierInput): string {
  const name = input.name.trim();
  if (name.length < 2) throw new DomainError('INVALID', 'Supplier name is too short');
  return db.transaction((tx) => {
    if (
      tx
        .select({ id: suppliers.id })
        .from(suppliers)
        .where(and(eq(suppliers.tenantId, ctx.tenantId), eq(suppliers.name, name)))
        .get()
    )
      throw new DomainError('CONFLICT', 'A supplier with this name already exists');
    const now = isoNow(ctx);
    const row = {
      id: newId(),
      tenantId: ctx.tenantId,
      name,
      phone: input.phone?.trim() || null,
      ntn: input.ntn?.trim() || null,
      strn: input.strn?.trim() || null,
      termsDays: input.termsDays ?? 0,
      creditLimitMinor: input.creditLimitMinor ?? 0,
      openingBalanceMinor: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(suppliers).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'suppliers',
      entityId: row.id,
      op: 'insert',
      payload: row,
    });
    appendAudit(tx, ctx, {
      action: 'supplier.create',
      entityType: 'supplier',
      entityId: row.id,
      newValue: { name },
    });
    return row.id;
  });
}

export function searchCustomers(db: DbOrTx, tenantId: string, q: string) {
  const term = q.trim();
  return db
    .select({
      id: customers.id,
      mrNo: customers.mrNo,
      name: customers.name,
      phone: customers.phone,
      isWalkin: customers.isWalkin,
      creditLimitMinor: customers.creditLimitMinor,
    })
    .from(customers)
    .where(
      and(
        eq(customers.tenantId, tenantId),
        eq(customers.isActive, true),
        term
          ? or(
              like(customers.name, `%${term}%`),
              like(customers.phone, `%${term}%`),
              like(customers.mrNo, `%${term}%`),
            )
          : undefined,
      ),
    )
    .orderBy(asc(customers.name))
    .limit(20)
    .all();
}

export function getWalkinCustomerId(db: DbOrTx, tenantId: string): string | null {
  return (
    db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.isWalkin, true)))
      .get()?.id ?? null
  );
}

export function createCustomer(
  db: Db,
  ctx: WriteContext,
  input: { name: string; phone?: string | null; cnic?: string | null; creditLimitMinor?: number },
): { id: string; mrNo: string } {
  const name = input.name.trim();
  if (name.length < 2) throw new DomainError('INVALID', 'Customer name is too short');
  return db.transaction((tx) => {
    const last = tx
      .select({ mr: customers.mrNo })
      .from(customers)
      .where(eq(customers.tenantId, ctx.tenantId))
      .orderBy(asc(customers.mrNo))
      .all()
      .at(-1);
    const mrNo = String((last && /^\d+$/.test(last.mr) ? Number(last.mr) : 100_000) + 1);
    const now = isoNow(ctx);
    const row = {
      id: newId(),
      tenantId: ctx.tenantId,
      mrNo,
      name,
      phone: input.phone?.trim() || null,
      cnic: input.cnic?.trim() || null,
      gender: null,
      isWalkin: false,
      creditLimitMinor: input.creditLimitMinor ?? 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      hlc: ctx.clock.tick(),
      version: 1,
    };
    tx.insert(customers).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'customers',
      entityId: row.id,
      op: 'insert',
      payload: row,
    });
    appendAudit(tx, ctx, {
      action: 'customer.create',
      entityType: 'customer',
      entityId: row.id,
      newValue: { mrNo, name },
    });
    return { id: row.id, mrNo };
  });
}
