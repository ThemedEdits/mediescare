/**
 * Phase 2 (SQLite): pharmacy catalogue, batches, stock ledger, purchasing, shifts and POS sales.
 * Money columns: *_minor = integer paisa, *_unit_micro = per-unit rate in micro-PKR (ADR-0002).
 * Quantities are integers in the item's smallest unit (qty_base).
 * Must stay in parity with pg-pharmacy.ts (parity.test.ts).
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { branches, stores, syncCols, tenants, users } from './sqlite';

export const units = sqliteTable(
  'units',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    ...syncCols(),
  },
  (t) => [uniqueIndex('units_tenant_code_uq').on(t.tenantId, t.code)],
);

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  ...syncCols(),
});

export const manufacturers = sqliteTable('manufacturers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  ...syncCols(),
});

export const racks = sqliteTable('racks', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: text('branch_id')
    .notNull()
    .references(() => branches.id),
  code: text('code').notNull(),
  ...syncCols(),
});

export const suppliers = sqliteTable('suppliers', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  name: text('name').notNull(),
  phone: text('phone'),
  ntn: text('ntn'),
  strn: text('strn'),
  termsDays: integer('terms_days').notNull().default(0),
  creditLimitMinor: integer('credit_limit_minor').notNull().default(0),
  openingBalanceMinor: integer('opening_balance_minor').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  ...syncCols(),
});

export const customers = sqliteTable(
  'customers',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    mrNo: text('mr_no').notNull(),
    name: text('name').notNull(),
    phone: text('phone'),
    cnic: text('cnic'),
    gender: text('gender'),
    isWalkin: integer('is_walkin', { mode: 'boolean' }).notNull().default(false),
    creditLimitMinor: integer('credit_limit_minor').notNull().default(0),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    ...syncCols(),
  },
  (t) => [uniqueIndex('customers_tenant_mr_uq').on(t.tenantId, t.mrNo)],
);

export const items = sqliteTable(
  'items',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    genericName: text('generic_name'),
    strength: text('strength'),
    dosageForm: text('dosage_form'),
    categoryId: text('category_id').references(() => categories.id),
    manufacturerId: text('manufacturer_id').references(() => manufacturers.id),
    rackId: text('rack_id').references(() => racks.id),
    baseUnitId: text('base_unit_id')
      .notNull()
      .references(() => units.id),
    /** Default retail price per smallest unit. */
    retailRateUnitMicro: integer('retail_rate_unit_micro').notNull().default(0),
    taxBp: integer('tax_bp').notNull().default(0),
    taxInclusive: integer('tax_inclusive', { mode: 'boolean' }).notNull().default(false),
    reorderLevelBase: integer('reorder_level_base').notNull().default(0),
    isPrescription: integer('is_prescription', { mode: 'boolean' }).notNull().default(false),
    isNarcotic: integer('is_narcotic', { mode: 'boolean' }).notNull().default(false),
    isColdChain: integer('is_cold_chain', { mode: 'boolean' }).notNull().default(false),
    allowNegativeStock: integer('allow_negative_stock', { mode: 'boolean' })
      .notNull()
      .default(false),
    drapRegNo: text('drap_reg_no'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    deletedAt: text('deleted_at'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('items_tenant_sku_uq').on(t.tenantId, t.sku),
    index('items_name_idx').on(t.name),
  ],
);

export const itemUnits = sqliteTable(
  'item_units',
  {
    id: text('id').primaryKey(),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    /** How many smallest units are in one of this unit. */
    factorToBase: integer('factor_to_base').notNull(),
    isDefaultSale: integer('is_default_sale', { mode: 'boolean' }).notNull().default(false),
    isDefaultPurchase: integer('is_default_purchase', { mode: 'boolean' }).notNull().default(false),
    ...syncCols(),
  },
  (t) => [uniqueIndex('item_units_item_unit_uq').on(t.itemId, t.unitId)],
);

export const itemBarcodes = sqliteTable(
  'item_barcodes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    barcode: text('barcode').notNull(),
    unitId: text('unit_id').references(() => units.id),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('item_barcodes_tenant_barcode_uq').on(t.tenantId, t.barcode),
    index('item_barcodes_item_idx').on(t.itemId),
  ],
);

export const batches = sqliteTable(
  'batches',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    batchNo: text('batch_no').notNull(),
    mfgDate: text('mfg_date'),
    /** 'YYYY-MM-DD' */
    expiryDate: text('expiry_date').notNull(),
    costUnitMicro: integer('cost_unit_micro').notNull(),
    mrpUnitMicro: integer('mrp_unit_micro').notNull().default(0),
    supplierId: text('supplier_id').references(() => suppliers.id),
    /** Recalled or in quarantine: never sold. */
    isBlocked: integer('is_blocked', { mode: 'boolean' }).notNull().default(false),
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

/** Append-only stock ledger. Stock = SUM(qty_base). Update and delete are blocked by triggers. */
export const stockMovements = sqliteTable(
  'stock_movements',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    storeId: text('store_id')
      .notNull()
      .references(() => stores.id),
    itemId: text('item_id')
      .notNull()
      .references(() => items.id),
    batchId: text('batch_id')
      .notNull()
      .references(() => batches.id),
    kind: text('kind').notNull(),
    /** Signed: negative takes stock out. */
    qtyBase: integer('qty_base').notNull(),
    unitCostMicro: integer('unit_cost_micro').notNull(),
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
    index('stock_movements_batch_idx').on(t.batchId),
  ],
);

export const grns = sqliteTable(
  'grns',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    supplierId: text('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    supplierInvoiceNo: text('supplier_invoice_no'),
    supplierInvoiceDate: text('supplier_invoice_date'),
    discountMinor: integer('discount_minor').notNull().default(0),
    salesTaxMinor: integer('sales_tax_minor').notNull().default(0),
    advanceTaxMinor: integer('advance_tax_minor').notNull().default(0),
    whtMinor: integer('wht_minor').notNull().default(0),
    freightMinor: integer('freight_minor').notNull().default(0),
    subTotalMinor: integer('sub_total_minor').notNull(),
    totalMinor: integer('total_minor').notNull(),
    paidMinor: integer('paid_minor').notNull().default(0),
    stockNote: text('stock_note'),
    status: text('status').notNull().default('posted'),
    createdBy: text('created_by'),
    ...syncCols(),
  },
  (t) => [uniqueIndex('grns_tenant_docno_uq').on(t.tenantId, t.docNo)],
);

export const grnLines = sqliteTable('grn_lines', {
  id: text('id').primaryKey(),
  grnId: text('grn_id')
    .notNull()
    .references(() => grns.id),
  lineNo: integer('line_no').notNull(),
  itemId: text('item_id')
    .notNull()
    .references(() => items.id),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id),
  unitId: text('unit_id')
    .notNull()
    .references(() => units.id),
  qtyUnits: integer('qty_units').notNull(),
  qtyBase: integer('qty_base').notNull(),
  bonusQtyBase: integer('bonus_qty_base').notNull().default(0),
  costUnitMicro: integer('cost_unit_micro').notNull(),
  lineTotalMinor: integer('line_total_minor').notNull(),
});

export const paymentModes = sqliteTable(
  'payment_modes',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(), // cash | card | wallet | bank | qr | credit
    opensDrawer: integer('opens_drawer', { mode: 'boolean' }).notNull().default(false),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    ...syncCols(),
  },
  (t) => [uniqueIndex('payment_modes_tenant_code_uq').on(t.tenantId, t.code)],
);

export const shifts = sqliteTable(
  'shifts',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    openedBy: text('opened_by')
      .notNull()
      .references(() => users.id),
    openedAt: text('opened_at').notNull(),
    floatMinor: integer('float_minor').notNull().default(0),
    status: text('status').notNull().default('open'), // open | closed
    closedBy: text('closed_by'),
    closedAt: text('closed_at'),
    /** Cash the system expects in the drawer at close: float + cash sales - cash refunds. */
    expectedCashMinor: integer('expected_cash_minor'),
    /** Blind count entered by the cashier (they do not see the expected amount first). */
    countedCashMinor: integer('counted_cash_minor'),
    varianceMinor: integer('variance_minor'),
    countJson: text('count_json'),
    deviceId: text('device_id'),
    ...syncCols(),
  },
  (t) => [
    uniqueIndex('shifts_tenant_docno_uq').on(t.tenantId, t.docNo),
    index('shifts_open_idx').on(t.branchId, t.openedBy, t.status),
  ],
);

export const sales = sqliteTable(
  'sales',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    customerId: text('customer_id').references(() => customers.id),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id),
    status: text('status').notNull().default('posted'), // posted | void
    source: text('source').notNull().default('pos'),
    grossMinor: integer('gross_minor').notNull(),
    discountMinor: integer('discount_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    roundingMinor: integer('rounding_minor').notNull().default(0),
    grandTotalMinor: integer('grand_total_minor').notNull(),
    paidMinor: integer('paid_minor').notNull(),
    dueMinor: integer('due_minor').notNull().default(0),
    changeMinor: integer('change_minor').notNull().default(0),
    costMinor: integer('cost_minor').notNull().default(0),
    note: text('note'),
    createdBy: text('created_by'),
    deviceId: text('device_id'),
    /** Sent by the POS so a retried request returns the original sale instead of creating another. */
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

export const saleLines = sqliteTable('sale_lines', {
  id: text('id').primaryKey(),
  saleId: text('sale_id')
    .notNull()
    .references(() => sales.id),
  lineNo: integer('line_no').notNull(),
  itemId: text('item_id')
    .notNull()
    .references(() => items.id),
  unitId: text('unit_id')
    .notNull()
    .references(() => units.id),
  qtyUnits: integer('qty_units').notNull(),
  qtyBase: integer('qty_base').notNull(),
  rateUnitMicro: integer('rate_unit_micro').notNull(),
  taxBp: integer('tax_bp').notNull().default(0),
  grossMinor: integer('gross_minor').notNull(),
  lineDiscountMinor: integer('line_discount_minor').notNull().default(0),
  billDiscountShareMinor: integer('bill_discount_share_minor').notNull().default(0),
  taxMinor: integer('tax_minor').notNull().default(0),
  netMinor: integer('net_minor').notNull(),
  costMinor: integer('cost_minor').notNull().default(0),
});

export const saleLineAllocations = sqliteTable('sale_line_allocations', {
  id: text('id').primaryKey(),
  saleLineId: text('sale_line_id')
    .notNull()
    .references(() => saleLines.id),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id),
  qtyBase: integer('qty_base').notNull(),
  costUnitMicro: integer('cost_unit_micro').notNull(),
  costMinor: integer('cost_minor').notNull(),
});

export const salePayments = sqliteTable('sale_payments', {
  id: text('id').primaryKey(),
  saleId: text('sale_id')
    .notNull()
    .references(() => sales.id),
  modeId: text('mode_id')
    .notNull()
    .references(() => paymentModes.id),
  kind: text('kind').notNull(),
  amountMinor: integer('amount_minor').notNull(),
  reference: text('reference'),
  paidAt: text('paid_at').notNull(),
});

export const saleReturns = sqliteTable(
  'sale_returns',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    branchId: text('branch_id')
      .notNull()
      .references(() => branches.id),
    docNo: text('doc_no').notNull(),
    saleId: text('sale_id')
      .notNull()
      .references(() => sales.id),
    shiftId: text('shift_id')
      .notNull()
      .references(() => shifts.id),
    reasonCode: text('reason_code').notNull(),
    reasonText: text('reason_text'),
    refundMinor: integer('refund_minor').notNull(),
    refundModeId: text('refund_mode_id')
      .notNull()
      .references(() => paymentModes.id),
    createdBy: text('created_by'),
    ...syncCols(),
  },
  (t) => [uniqueIndex('sale_returns_tenant_docno_uq').on(t.tenantId, t.docNo)],
);

export const saleReturnLines = sqliteTable('sale_return_lines', {
  id: text('id').primaryKey(),
  returnId: text('return_id')
    .notNull()
    .references(() => saleReturns.id),
  saleLineId: text('sale_line_id')
    .notNull()
    .references(() => saleLines.id),
  itemId: text('item_id')
    .notNull()
    .references(() => items.id),
  batchId: text('batch_id')
    .notNull()
    .references(() => batches.id),
  qtyBase: integer('qty_base').notNull(),
  refundMinor: integer('refund_minor').notNull(),
  /** true: goes back on the shelf (stock movement). false: damaged, written off, no stock movement. */
  restock: integer('restock', { mode: 'boolean' }).notNull().default(true),
});

/** Carts parked at one counter and resumed at any counter of the branch. Mutable until posted or deleted. */
export const holdInvoices = sqliteTable('hold_invoices', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: text('branch_id')
    .notNull()
    .references(() => branches.id),
  createdBy: text('created_by')
    .notNull()
    .references(() => users.id),
  label: text('label'),
  payloadJson: text('payload_json').notNull(),
  ...syncCols(),
});

/** Items customers asked for that were not available. Feeds purchasing suggestions. */
export const missedSales = sqliteTable('missed_sales', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id),
  branchId: text('branch_id')
    .notNull()
    .references(() => branches.id),
  itemId: text('item_id').references(() => items.id),
  itemText: text('item_text'),
  unitId: text('unit_id').references(() => units.id),
  qty: integer('qty').notNull().default(1),
  customerPhone: text('customer_phone'),
  supplierId: text('supplier_id').references(() => suppliers.id),
  createdBy: text('created_by'),
  ...syncCols(),
});
