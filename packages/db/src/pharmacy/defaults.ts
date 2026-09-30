import { and, eq } from 'drizzle-orm';
import { HybridLogicalClock, newId } from '@mediescare/sync';
import type { Db, DbOrTx } from '../client';
import { isoNow, type WriteContext } from '../context';
import { getServerIdentity, hlcDeviceId } from '../identity';
import { recordChange } from '../outbox';
import { categories, customers, paymentModes, units } from '../schema/sqlite-all';

export const DEFAULT_UNITS = [
  ['tablet', 'Tablet'],
  ['capsule', 'Capsule'],
  ['strip', 'Strip'],
  ['box', 'Box'],
  ['bottle', 'Bottle'],
  ['piece', 'Piece'],
  ['tube', 'Tube'],
  ['sachet', 'Sachet'],
  ['vial', 'Vial'],
] as const;

export const DEFAULT_PAYMENT_MODES = [
  { code: 'cash', name: 'Cash', kind: 'cash', opensDrawer: true },
  { code: 'wallet', name: 'Easypaisa / JazzCash', kind: 'wallet', opensDrawer: false },
  { code: 'card', name: 'Card', kind: 'card', opensDrawer: false },
  { code: 'bank', name: 'Bank transfer', kind: 'bank', opensDrawer: false },
  { code: 'credit', name: 'On account (credit)', kind: 'credit', opensDrawer: false },
] as const;

export const DEFAULT_CATEGORIES = [
  'Medicines',
  'Over the counter',
  'Wellness and beauty',
  'Baby care',
  'General retail',
] as const;

/**
 * Units, payment modes, the walk-in customer and starter categories. Idempotent: only missing rows
 * are added, so it is safe on a fresh install and on an existing database after an upgrade.
 * Nothing here is hard-coded business policy: every row is editable data (CLAUDE.md §12).
 */
export function seedPharmacyDefaults(tx: DbOrTx, ctx: WriteContext): void {
  const now = isoNow(ctx);
  const sync = () => ({ createdAt: now, updatedAt: now, hlc: ctx.clock.tick(), version: 1 });

  DEFAULT_UNITS.forEach(([code, name]) => {
    if (
      tx
        .select({ id: units.id })
        .from(units)
        .where(and(eq(units.tenantId, ctx.tenantId), eq(units.code, code)))
        .get()
    )
      return;
    const row = { id: newId(), tenantId: ctx.tenantId, code, name, ...sync() };
    tx.insert(units).values(row).run();
    recordChange(tx, ctx, { entityType: 'units', entityId: row.id, op: 'insert', payload: row });
  });

  DEFAULT_PAYMENT_MODES.forEach((m, i) => {
    if (
      tx
        .select({ id: paymentModes.id })
        .from(paymentModes)
        .where(and(eq(paymentModes.tenantId, ctx.tenantId), eq(paymentModes.code, m.code)))
        .get()
    )
      return;
    const row = {
      id: newId(),
      tenantId: ctx.tenantId,
      ...m,
      isActive: true,
      sortOrder: i + 1,
      ...sync(),
    };
    tx.insert(paymentModes).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'payment_modes',
      entityId: row.id,
      op: 'insert',
      payload: row,
    });
  });

  if (
    !tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.tenantId, ctx.tenantId), eq(customers.isWalkin, true)))
      .get()
  ) {
    const row = {
      id: newId(),
      tenantId: ctx.tenantId,
      mrNo: '100001',
      name: 'Walk-in Customer',
      phone: null,
      cnic: null,
      gender: null,
      isWalkin: true,
      creditLimitMinor: 0,
      isActive: true,
      ...sync(),
    };
    tx.insert(customers).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'customers',
      entityId: row.id,
      op: 'insert',
      payload: row,
    });
  }

  DEFAULT_CATEGORIES.forEach((name) => {
    if (
      tx
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.tenantId, ctx.tenantId), eq(categories.name, name)))
        .get()
    )
      return;
    const row = { id: newId(), tenantId: ctx.tenantId, parentId: null, name, ...sync() };
    tx.insert(categories).values(row).run();
    recordChange(tx, ctx, {
      entityType: 'categories',
      entityId: row.id,
      op: 'insert',
      payload: row,
    });
  });
}

/** Run at server start-up: brings an already set-up database up to date with the default data. */
export function ensurePharmacyDefaults(db: Db): void {
  const identity = getServerIdentity(db);
  if (!identity) return; // not set up yet: first-run setup seeds these itself
  const ctx: WriteContext = {
    ...identity,
    userId: null,
    clock: new HybridLogicalClock(hlcDeviceId(identity.deviceId)),
  };
  db.transaction((tx) => seedPharmacyDefaults(tx, ctx));
}
