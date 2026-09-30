import { integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { branches, devices, syncCols, tenants } from './pg';

export const syncEpochs = pgTable(
  'sync_epochs',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id),
    epoch: integer('epoch').notNull(),
    promotedBy: uuid('promoted_by'),
    reason: text('reason').notNull(),
    ...syncCols(),
  },
  (t) => [uniqueIndex('sync_epochs_branch_epoch_uq').on(t.branchId, t.epoch)],
);
