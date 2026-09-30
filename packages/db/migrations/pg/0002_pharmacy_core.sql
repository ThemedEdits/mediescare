CREATE TABLE "batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"mfg_date" text,
	"expiry_date" text NOT NULL,
	"cost_unit_micro" bigint NOT NULL,
	"mrp_unit_micro" bigint DEFAULT 0 NOT NULL,
	"supplier_id" uuid,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"origin_doc_type" text,
	"origin_doc_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"mr_no" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"cnic" text,
	"gender" text,
	"is_walkin" boolean DEFAULT false NOT NULL,
	"credit_limit_minor" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grn_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grn_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"qty_units" bigint NOT NULL,
	"qty_base" bigint NOT NULL,
	"bonus_qty_base" bigint DEFAULT 0 NOT NULL,
	"cost_unit_micro" bigint NOT NULL,
	"line_total_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "grns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_invoice_no" text,
	"supplier_invoice_date" text,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"sales_tax_minor" bigint DEFAULT 0 NOT NULL,
	"advance_tax_minor" bigint DEFAULT 0 NOT NULL,
	"wht_minor" bigint DEFAULT 0 NOT NULL,
	"freight_minor" bigint DEFAULT 0 NOT NULL,
	"sub_total_minor" bigint NOT NULL,
	"total_minor" bigint NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"stock_note" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hold_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"label" text,
	"payload_json" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_barcodes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"barcode" text NOT NULL,
	"unit_id" uuid,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"factor_to_base" integer NOT NULL,
	"is_default_sale" boolean DEFAULT false NOT NULL,
	"is_default_purchase" boolean DEFAULT false NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"generic_name" text,
	"strength" text,
	"dosage_form" text,
	"category_id" uuid,
	"manufacturer_id" uuid,
	"rack_id" uuid,
	"base_unit_id" uuid NOT NULL,
	"retail_rate_unit_micro" bigint DEFAULT 0 NOT NULL,
	"tax_bp" integer DEFAULT 0 NOT NULL,
	"tax_inclusive" boolean DEFAULT false NOT NULL,
	"reorder_level_base" bigint DEFAULT 0 NOT NULL,
	"is_prescription" boolean DEFAULT false NOT NULL,
	"is_narcotic" boolean DEFAULT false NOT NULL,
	"is_cold_chain" boolean DEFAULT false NOT NULL,
	"allow_negative_stock" boolean DEFAULT false NOT NULL,
	"drap_reg_no" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"deleted_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manufacturers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "missed_sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"item_id" uuid,
	"item_text" text,
	"unit_id" uuid,
	"qty" bigint DEFAULT 1 NOT NULL,
	"customer_phone" text,
	"supplier_id" uuid,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_modes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"opens_drawer" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "racks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"code" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_line_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"qty_base" bigint NOT NULL,
	"cost_unit_micro" bigint NOT NULL,
	"cost_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sale_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"qty_units" bigint NOT NULL,
	"qty_base" bigint NOT NULL,
	"rate_unit_micro" bigint NOT NULL,
	"tax_bp" integer DEFAULT 0 NOT NULL,
	"gross_minor" bigint NOT NULL,
	"line_discount_minor" bigint DEFAULT 0 NOT NULL,
	"bill_discount_share_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"net_minor" bigint NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"sale_id" uuid NOT NULL,
	"mode_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"reference" text,
	"paid_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_return_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"return_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"qty_base" bigint NOT NULL,
	"refund_minor" bigint NOT NULL,
	"restock" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sale_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"reason_code" text NOT NULL,
	"reason_text" text,
	"refund_minor" bigint NOT NULL,
	"refund_mode_id" uuid NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"customer_id" uuid,
	"shift_id" uuid NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"source" text DEFAULT 'pos' NOT NULL,
	"gross_minor" bigint NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"rounding_minor" bigint DEFAULT 0 NOT NULL,
	"grand_total_minor" bigint NOT NULL,
	"paid_minor" bigint NOT NULL,
	"due_minor" bigint DEFAULT 0 NOT NULL,
	"change_minor" bigint DEFAULT 0 NOT NULL,
	"cost_minor" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" text,
	"device_id" text,
	"idempotency_key" text,
	"voided_by" text,
	"voided_at" text,
	"void_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"opened_by" uuid NOT NULL,
	"opened_at" text NOT NULL,
	"float_minor" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_by" text,
	"closed_at" text,
	"expected_cash_minor" bigint,
	"counted_cash_minor" bigint,
	"variance_minor" bigint,
	"count_json" text,
	"device_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"qty_base" bigint NOT NULL,
	"unit_cost_micro" bigint NOT NULL,
	"doc_type" text NOT NULL,
	"doc_id" text NOT NULL,
	"doc_line_id" text,
	"reverses_id" text,
	"occurred_at" text NOT NULL,
	"user_id" text,
	"hlc" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"ntn" text,
	"strn" text,
	"terms_days" integer DEFAULT 0 NOT NULL,
	"credit_limit_minor" bigint DEFAULT 0 NOT NULL,
	"opening_balance_minor" bigint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "batches" ADD CONSTRAINT "batches_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_grn_id_grns_id_fk" FOREIGN KEY ("grn_id") REFERENCES "public"."grns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grn_lines" ADD CONSTRAINT "grn_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "grns" ADD CONSTRAINT "grns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold_invoices" ADD CONSTRAINT "hold_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold_invoices" ADD CONSTRAINT "hold_invoices_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hold_invoices" ADD CONSTRAINT "hold_invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_barcodes" ADD CONSTRAINT "item_barcodes_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_units" ADD CONSTRAINT "item_units_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_manufacturer_id_manufacturers_id_fk" FOREIGN KEY ("manufacturer_id") REFERENCES "public"."manufacturers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_rack_id_racks_id_fk" FOREIGN KEY ("rack_id") REFERENCES "public"."racks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_base_unit_id_units_id_fk" FOREIGN KEY ("base_unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_sales" ADD CONSTRAINT "missed_sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_sales" ADD CONSTRAINT "missed_sales_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_sales" ADD CONSTRAINT "missed_sales_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_sales" ADD CONSTRAINT "missed_sales_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missed_sales" ADD CONSTRAINT "missed_sales_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_modes" ADD CONSTRAINT "payment_modes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "racks" ADD CONSTRAINT "racks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "racks" ADD CONSTRAINT "racks_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_allocations" ADD CONSTRAINT "sale_line_allocations_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_line_allocations" ADD CONSTRAINT "sale_line_allocations_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_mode_id_payment_modes_id_fk" FOREIGN KEY ("mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_return_id_sale_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."sale_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_return_lines" ADD CONSTRAINT "sale_return_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_returns" ADD CONSTRAINT "sale_returns_refund_mode_id_payment_modes_id_fk" FOREIGN KEY ("refund_mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batches_identity_uq" ON "batches" USING btree ("branch_id","item_id","batch_no","expiry_date","cost_unit_micro");--> statement-breakpoint
CREATE INDEX "batches_item_expiry_idx" ON "batches" USING btree ("item_id","expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_mr_uq" ON "customers" USING btree ("tenant_id","mr_no");--> statement-breakpoint
CREATE UNIQUE INDEX "grns_tenant_docno_uq" ON "grns" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE UNIQUE INDEX "item_barcodes_tenant_barcode_uq" ON "item_barcodes" USING btree ("tenant_id","barcode");--> statement-breakpoint
CREATE INDEX "item_barcodes_item_idx" ON "item_barcodes" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "item_units_item_unit_uq" ON "item_units" USING btree ("item_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "items_tenant_sku_uq" ON "items" USING btree ("tenant_id","sku");--> statement-breakpoint
CREATE INDEX "items_name_idx" ON "items" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_modes_tenant_code_uq" ON "payment_modes" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_returns_tenant_docno_uq" ON "sale_returns" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tenant_docno_uq" ON "sales" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_idempotency_uq" ON "sales" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "sales_branch_time_idx" ON "sales" USING btree ("branch_id","created_at");--> statement-breakpoint
CREATE INDEX "sales_shift_idx" ON "sales" USING btree ("shift_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_tenant_docno_uq" ON "shifts" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "shifts_open_idx" ON "shifts" USING btree ("branch_id","opened_by","status");--> statement-breakpoint
CREATE INDEX "stock_movements_branch_item_batch_idx" ON "stock_movements" USING btree ("branch_id","item_id","batch_id");--> statement-breakpoint
CREATE INDEX "stock_movements_doc_idx" ON "stock_movements" USING btree ("doc_type","doc_id");--> statement-breakpoint
CREATE INDEX "stock_movements_time_idx" ON "stock_movements" USING btree ("branch_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "units_tenant_code_uq" ON "units" USING btree ("tenant_id","code");