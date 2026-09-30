/** Failover epochs (ADR-0004). One row per promotion; the branch's current epoch is the highest one. */
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { branches, devices, syncCols, tenants } from './sqlite';

export const syncEpochs = sqliteTable(
  'sync_epochs',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    /** The device that became (or stays) the branch server at this epoch. */
    deviceId: text('device_id')
      .notNull()
      .references(() => devices.id),
    epoch: integer('epoch').notNull(),
    promotedBy: text('promoted_by'),
    reason: text('reason').notNull(),
    ...syncCols(),
  },
  (t) => [uniqueIndex('sync_epochs_branch_epoch_uq').on(t.branchId, t.epoch)],
);
