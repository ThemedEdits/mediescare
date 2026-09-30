import { bigint, index, text, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';
import { branches, syncCols, tenants } from './pg';
import { items, saleLines, sales } from './pg-pharmacy';

export const narcoticRegister = pgTable(
  'narcotic_register',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    saleLineId: uuid('sale_line_id')
      .notNull()
      .references(() => saleLines.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    qtyBase: bigint('qty_base', { mode: 'number' }).notNull(),
    patientName: text('patient_name').notNull(),
    patientCnic: text('patient_cnic').notNull(),
    doctorName: text('doctor_name').notNull(),
    prescriptionRef: text('prescription_ref'),
    soldAt: text('sold_at').notNull(),
    soldBy: text('sold_by'),
    ...syncCols(),
  },
  (t) => [index('narcotic_register_time_idx').on(t.branchId, t.soldAt)],
);
