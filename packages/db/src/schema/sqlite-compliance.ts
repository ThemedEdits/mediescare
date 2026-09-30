/** Controlled-drug register (CLAUDE.md §6). One row per narcotic sale line, written with the sale. */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { branches, syncCols, tenants } from './sqlite';
import { items, saleLines, sales } from './sqlite-pharmacy';

export const narcoticRegister = sqliteTable(
  'narcotic_register',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id),
    saleLineId: text('sale_line_id')
      .notNull()
      .references(() => saleLines.id),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    qtyBase: integer('qty_base').notNull(),
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
