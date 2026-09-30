/**
 * Phase 2 (PostgreSQL): mirrors sqlite-pharmacy.ts table for table and column for column.
 * Integer money and quantities use bigint (number mode) where they can grow large.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { branches, stores, syncCols, tenants, users } from './pg';

const big = (name: string) => bigint(name, { mode: 'number' });

export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    ...syncCols(),
  },
  (t) => [uniqueIndex('units_tenant_code_uq').on(t.tenantId, t.code)],
);

export const categories = pgTable('categories', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  ...syncCols(),
});

export const manufacturers = pgTable('manufacturers', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  ...syncCols(),
});

export const racks = pgTable('racks', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  code: text('code').notNull(),
  ...syncCols(),
});

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  phone: text('phone'),
  ntn: text('ntn'),
  strn: text('strn'),
  termsDays: integer('terms_days').notNull().default(0),
  creditLimitMinor: big('credit_limit_minor').notNull().default(0),
  openingBalanceMinor: big('opening_balance_minor').notNull().default(0),
  isActive: boolean('is_active').notNull().default(true),
  ...syncCols(),
});

export const customers = pgTable(
  'customers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    mrNo: text('mr_no').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    cnic: text('cnic'),
    gender: text('gender'),
    isWalkin: boolean('is_walkin').notNull().default(false),
    creditLimitMinor: big('credit_limit_minor').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...syncCols(),
  },
  (t) => [uniqueIndex('customers_tenant_mr_uq').on(t.tenantId, t.mrNo)],
);

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    genericName: text('generic_name'),
    strength: text('strength'),
    dosageForm: text('dosage_form'),
    categoryId: uuid('category_id').references(() => categories.id),
    manufacturerId: uuid('manufacturer_id').references(() => manufacturers.id),
    rackId: uuid('rack_id').references(() => racks.id),
    baseUnitId: uuid('base_unit_id')
      .notNull()
      .references(() => units.id),
    retailRateUnitMicro: big('retail_rate_unit_micro').notNull().default(0),
    taxBp: integer('tax_bp').notNull().default(0),
    taxInclusive: boolean('tax_inclusive').notNull().default(false),
    reorderLevelBase: big('reorder_level_base').notNull().default(0),
    isPrescription: boolean('is_prescription').notNull().default(false),
    isNarcotic: boolean('is_narcotic').notNull().default(false),
    isColdChain: boolean('is_cold_chain').notNull().default(false),
    allowNegativeStock: boolean('allow_negative_stock').notNull().default(false),
    drapRegNo: text('drap_reg_no'),
    isActive: boolean('is_active').notNull().default(true),
    deletedAt: text('deleted_at'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('items_tenant_sku_uq').on(t.tenantId, t.sku),
    index('items_name_idx').on(t.name),
  ],
);

export const itemUnits = pgTable(
  'item_units',
  {
    id: uuid('id').primaryKey(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id),
    factorToBase: integer('factor_to_base').notNull(),
    isDefaultSale: boolean('is_default_sale').notNull().default(false),
    isDefaultPurchase: boolean('is_default_purchase').notNull().default(false),
    ...syncCols(),
  },
  (t) => [uniqueIndex('item_units_item_unit_uq').on(t.itemId, t.unitId)],
);

export const itemBarcodes = pgTable(
  'item_barcodes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    barcode: text('barcode').notNull(),
    unitId: uuid('unit_id').references(() => units.id),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('item_barcodes_tenant_barcode_uq').on(t.tenantId, t.barcode),
    index('item_barcodes_item_idx').on(t.itemId),
  ],
);

export const batches = pgTable(
  'batches',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    batchNo: text('batch_no').notNull(),
    mfgDate: text('mfg_date'),
    expiryDate: text('expiry_date').notNull(),
    costUnitMicro: big('cost_unit_micro').notNull(),
    mrpUnitMicro: big('mrp_unit_micro').notNull().default(0),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    isBlocked: boolean('is_blocked').notNull().default(false),
    originDocType: text('origin_doc_type'),
    originDocId: text('origin_doc_id'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('batches_identity_uq').on(
      t.branchId,
      t.itemId,
      t.batchNo,
      t.expiryDate,
      t.costUnitMicro,
    ),
    index('batches_item_expiry_idx').on(t.itemId, t.expiryDate),
  ],
);

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id),
    kind: text('kind').notNull(),
    qtyBase: big('qty_base').notNull(),
    unitCostMicro: big('unit_cost_micro').notNull(),
    docType: text('doc_type').notNull(),
    docId: text('doc_id').notNull(),
    docLineId: text('doc_line_id'),
    reversesId: text('reverses_id'),
    occurredAt: text('occurred_at').notNull(),
    userId: text('user_id'),
    hlc: text('hlc').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [
    index('stock_movements_branch_item_batch_idx').on(t.branchId, t.itemId, t.batchId),
    index('stock_movements_doc_idx').on(t.docType, t.docId),
    index('stock_movements_time_idx').on(t.branchId, t.occurredAt),
  ],
);

export const grns = pgTable(
  'grns',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    supplierInvoiceNo: text('supplier_invoice_no'),
    supplierInvoiceDate: text('supplier_invoice_date'),
    discountMinor: big('discount_minor').notNull().default(0),
    salesTaxMinor: big('sales_tax_minor').notNull().default(0),
    advanceTaxMinor: big('advance_tax_minor').notNull().default(0),
    whtMinor: big('wht_minor').notNull().default(0),
    freightMinor: big('freight_minor').notNull().default(0),
    subTotalMinor: big('sub_total_minor').notNull(),
    totalMinor: big('total_minor').notNull(),
    paidMinor: big('paid_minor').notNull().default(0),
    stockNote: text('stock_note'),
    status: text('status').notNull().default('posted'),
    createdBy: text('created_by'),
    ...syncCols(),
  },
  (t) => [uniqueIndex('grns_tenant_docno_uq').on(t.tenantId, t.docNo)],
);

export const grnLines = pgTable('grn_lines', {
  id: uuid('id').primaryKey(),
  grnId: uuid('grn_id')
    .notNull()
    .references(() => grns.id),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id),
  batchId: uuid('batch_id')
    .notNull()
    .references(() => batches.id),
  unitId: uuid('unit_id')
    .notNull()
    .references(() => units.id),
  qtyUnits: big('qty_units').notNull(),
  qtyBase: big('qty_base').notNull(),
  bonusQtyBase: big('bonus_qty_base').notNull().default(0),
  costUnitMicro: big('cost_unit_micro').notNull(),
  lineTotalMinor: big('line_total_minor').notNull(),
});

export const paymentModes = pgTable(
  'payment_modes',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    opensDrawer: boolean('opens_drawer').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...syncCols(),
  },
  (t) => [uniqueIndex('payment_modes_tenant_code_uq').on(t.tenantId, t.code)],
);

export const shifts = pgTable(
  'shifts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    openedBy: uuid('opened_by')
      .notNull()
      .references(() => users.id),
    openedAt: text('opened_at').notNull(),
    floatMinor: big('float_minor').notNull().default(0),
    status: text('status').notNull().default('open'),
    closedBy: text('closed_by'),
    closedAt: text('closed_at'),
    expectedCashMinor: big('expected_cash_minor'),
    countedCashMinor: big('counted_cash_minor'),
    varianceMinor: big('variance_minor'),
    countJson: text('count_json'),
    deviceId: text('device_id'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('shifts_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('shifts_open_idx').on(t.branchId, t.openedBy, t.status),
  ],
);

export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    customerId: uuid('customer_id').references(() => customers.id),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id),
    status: text('status').notNull().default('posted'),
    source: text('source').notNull().default('pos'),
    grossMinor: big('gross_minor').notNull(),
    discountMinor: big('discount_minor').notNull().default(0),
    taxMinor: big('tax_minor').notNull().default(0),
    roundingMinor: big('rounding_minor').notNull().default(0),
    grandTotalMinor: big('grand_total_minor').notNull(),
    paidMinor: big('paid_minor').notNull(),
    dueMinor: big('due_minor').notNull().default(0),
    changeMinor: big('change_minor').notNull().default(0),
    costMinor: big('cost_minor').notNull().default(0),
    note: text('note'),
    createdBy: text('created_by'),
    deviceId: text('device_id'),
    idempotencyKey: text('idempotency_key'),
    voidedBy: text('voided_by'),
    voidedAt: text('voided_at'),
    voidReason: text('void_reason'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('sales_tenant_docno_uq').on(t.tenantId, t.docNo),
    uniqueIndex('sales_idempotency_uq').on(t.tenantId, t.idempotencyKey),
    index('sales_branch_time_idx').on(t.branchId, t.createdAt),
    index('sales_shift_idx').on(t.shiftId),
  ],
);

export const saleLines = pgTable('sale_lines', {
  id: uuid('id').primaryKey(),
  saleId: uuid('sale_id')
    .notNull()
    .references(() => sales.id),
  lineNo: integer('line_no').notNull(),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id),
  unitId: uuid('unit_id')
    .notNull()
    .references(() => units.id),
  qtyUnits: big('qty_units').notNull(),
  qtyBase: big('qty_base').notNull(),
  rateUnitMicro: big('rate_unit_micro').notNull(),
  taxBp: integer('tax_bp').notNull().default(0),
  grossMinor: big('gross_minor').notNull(),
  lineDiscountMinor: big('line_discount_minor').notNull().default(0),
  billDiscountShareMinor: big('bill_discount_share_minor').notNull().default(0),
  taxMinor: big('tax_minor').notNull().default(0),
  netMinor: big('net_minor').notNull(),
  costMinor: big('cost_minor').notNull().default(0),
});

export const saleLineAllocations = pgTable('sale_line_allocations', {
  id: uuid('id').primaryKey(),
  saleLineId: uuid('sale_line_id')
    .notNull()
    .references(() => saleLines.id),
  batchId: uuid('batch_id')
    .notNull()
    .references(() => batches.id),
  qtyBase: big('qty_base').notNull(),
  costUnitMicro: big('cost_unit_micro').notNull(),
  costMinor: big('cost_minor').notNull(),
});

export const salePayments = pgTable('sale_payments', {
  id: uuid('id').primaryKey(),
  saleId: uuid('sale_id')
    .notNull()
    .references(() => sales.id),
  modeId: uuid('mode_id')
    .notNull()
    .references(() => paymentModes.id),
  kind: text('kind').notNull(),
  amountMinor: big('amount_minor').notNull(),
  reference: text('reference'),
  paidAt: text('paid_at').notNull(),
});

export const saleReturns = pgTable(
  'sale_returns',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shifts.id),
    reasonCode: text('reason_code').notNull(),
    reasonText: text('reason_text'),
    refundMinor: big('refund_minor').notNull(),
    refundModeId: uuid('refund_mode_id')
      .notNull()
      .references(() => paymentModes.id),
    createdBy: text('created_by'),
    ...syncCols(),
  },
  (t) => [uniqueIndex('sale_returns_tenant_docno_uq').on(t.tenantId, t.docNo)],
);

export const saleReturnLines = pgTable('sale_return_lines', {
  id: uuid('id').primaryKey(),
  returnId: uuid('return_id')
    .notNull()
    .references(() => saleReturns.id),
  saleLineId: uuid('sale_line_id')
    .notNull()
    .references(() => saleLines.id),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id),
  batchId: uuid('batch_id')
    .notNull()
    .references(() => batches.id),
  qtyBase: big('qty_base').notNull(),
  refundMinor: big('refund_minor').notNull(),
  restock: boolean('restock').notNull().default(true),
});

export const holdInvoices = pgTable('hold_invoices', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  label: text('label'),
  payloadJson: text('payload_json').notNull(),
  ...syncCols(),
});

export const missedSales = pgTable('missed_sales', {
  id: uuid('id').primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: uuid('branch_id')
    .notNull()
    .references(() => branches.id),
  itemId: uuid('item_id').references(() => items.id),
  itemText: text('item_text'),
  unitId: uuid('unit_id').references(() => units.id),
  qty: big('qty').notNull().default(1),
  customerPhone: text('customer_phone'),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  createdBy: text('created_by'),
  ...syncCols(),
});
