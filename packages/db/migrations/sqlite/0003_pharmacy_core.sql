CREATE TABLE `batches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`item_id` text NOT NULL,
	`batch_no` text NOT NULL,
	`mfg_date` text,
	`expiry_date` text NOT NULL,
	`cost_unit_micro` integer NOT NULL,
	`mrp_unit_micro` integer DEFAULT 0 NOT NULL,
	`supplier_id` text,
	`is_blocked` integer DEFAULT false NOT NULL,
	`origin_doc_type` text,
	`origin_doc_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `batches_identity_uq` ON `batches` (`branch_id`,`item_id`,`batch_no`,`expiry_date`,`cost_unit_micro`);--> statement-breakpoint
CREATE INDEX `batches_item_expiry_idx` ON `batches` (`item_id`,`expiry_date`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `customers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`mr_no` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`cnic` text,
	`gender` text,
	`is_walkin` integer DEFAULT false NOT NULL,
	`credit_limit_minor` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customers_tenant_mr_uq` ON `customers` (`tenant_id`,`mr_no`);--> statement-breakpoint
CREATE TABLE `grn_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`grn_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`qty_units` integer NOT NULL,
	`qty_base` integer NOT NULL,
	`bonus_qty_base` integer DEFAULT 0 NOT NULL,
	`cost_unit_micro` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	FOREIGN KEY (`grn_id`) REFERENCES `grns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `grns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`supplier_id` text NOT NULL,
	`supplier_invoice_no` text,
	`supplier_invoice_date` text,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`sales_tax_minor` integer DEFAULT 0 NOT NULL,
	`advance_tax_minor` integer DEFAULT 0 NOT NULL,
	`wht_minor` integer DEFAULT 0 NOT NULL,
	`freight_minor` integer DEFAULT 0 NOT NULL,
	`sub_total_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`paid_minor` integer DEFAULT 0 NOT NULL,
	`stock_note` text,
	`status` text DEFAULT 'posted' NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grns_tenant_docno_uq` ON `grns` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE TABLE `hold_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`created_by` text NOT NULL,
	`label` text,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_barcodes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`barcode` text NOT NULL,
	`unit_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_barcodes_tenant_barcode_uq` ON `item_barcodes` (`tenant_id`,`barcode`);--> statement-breakpoint
CREATE INDEX `item_barcodes_item_idx` ON `item_barcodes` (`item_id`);--> statement-breakpoint
CREATE TABLE `item_units` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`factor_to_base` integer NOT NULL,
	`is_default_sale` integer DEFAULT false NOT NULL,
	`is_default_purchase` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_units_item_unit_uq` ON `item_units` (`item_id`,`unit_id`);--> statement-breakpoint
CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`generic_name` text,
	`strength` text,
	`dosage_form` text,
	`category_id` text,
	`manufacturer_id` text,
	`rack_id` text,
	`base_unit_id` text NOT NULL,
	`retail_rate_unit_micro` integer DEFAULT 0 NOT NULL,
	`tax_bp` integer DEFAULT 0 NOT NULL,
	`tax_inclusive` integer DEFAULT false NOT NULL,
	`reorder_level_base` integer DEFAULT 0 NOT NULL,
	`is_prescription` integer DEFAULT false NOT NULL,
	`is_narcotic` integer DEFAULT false NOT NULL,
	`is_cold_chain` integer DEFAULT false NOT NULL,
	`allow_negative_stock` integer DEFAULT false NOT NULL,
	`drap_reg_no` text,
	`is_active` integer DEFAULT true NOT NULL,
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `manufacturers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rack_id`) REFERENCES `racks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_tenant_sku_uq` ON `items` (`tenant_id`,`sku`);--> statement-breakpoint
CREATE INDEX `items_name_idx` ON `items` (`name`);--> statement-breakpoint
CREATE TABLE `manufacturers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `missed_sales` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`item_id` text,
	`item_text` text,
	`unit_id` text,
	`qty` integer DEFAULT 1 NOT NULL,
	`customer_phone` text,
	`supplier_id` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `payment_modes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`opens_drawer` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_modes_tenant_code_uq` ON `payment_modes` (`tenant_id`,`code`);--> statement-breakpoint
CREATE TABLE `racks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`code` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sale_line_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_line_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`qty_base` integer NOT NULL,
	`cost_unit_micro` integer NOT NULL,
	`cost_minor` integer NOT NULL,
	FOREIGN KEY (`sale_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sale_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`qty_units` integer NOT NULL,
	`qty_base` integer NOT NULL,
	`rate_unit_micro` integer NOT NULL,
	`tax_bp` integer DEFAULT 0 NOT NULL,
	`gross_minor` integer NOT NULL,
	`line_discount_minor` integer DEFAULT 0 NOT NULL,
	`bill_discount_share_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`net_minor` integer NOT NULL,
	`cost_minor` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sale_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`sale_id` text NOT NULL,
	`mode_id` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`reference` text,
	`paid_at` text NOT NULL,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mode_id`) REFERENCES `payment_modes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sale_return_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`sale_line_id` text NOT NULL,
	`item_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`qty_base` integer NOT NULL,
	`refund_minor` integer NOT NULL,
	`restock` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `sale_returns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sale_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`sale_id` text NOT NULL,
	`shift_id` text NOT NULL,
	`reason_code` text NOT NULL,
	`reason_text` text,
	`refund_minor` integer NOT NULL,
	`refund_mode_id` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`refund_mode_id`) REFERENCES `payment_modes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sale_returns_tenant_docno_uq` ON `sale_returns` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE TABLE `sales` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`customer_id` text,
	`shift_id` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`source` text DEFAULT 'pos' NOT NULL,
	`gross_minor` integer NOT NULL,
	`discount_minor` integer DEFAULT 0 NOT NULL,
	`tax_minor` integer DEFAULT 0 NOT NULL,
	`rounding_minor` integer DEFAULT 0 NOT NULL,
	`grand_total_minor` integer NOT NULL,
	`paid_minor` integer NOT NULL,
	`due_minor` integer DEFAULT 0 NOT NULL,
	`change_minor` integer DEFAULT 0 NOT NULL,
	`cost_minor` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_by` text,
	`device_id` text,
	`idempotency_key` text,
	`voided_by` text,
	`voided_at` text,
	`void_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shift_id`) REFERENCES `shifts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_tenant_docno_uq` ON `sales` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `sales_idempotency_uq` ON `sales` (`tenant_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `sales_branch_time_idx` ON `sales` (`branch_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sales_shift_idx` ON `sales` (`shift_id`);--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`opened_by` text NOT NULL,
	`opened_at` text NOT NULL,
	`float_minor` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`closed_by` text,
	`closed_at` text,
	`expected_cash_minor` integer,
	`counted_cash_minor` integer,
	`variance_minor` integer,
	`count_json` text,
	`device_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`opened_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shifts_tenant_docno_uq` ON `shifts` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE INDEX `shifts_open_idx` ON `shifts` (`branch_id`,`opened_by`,`status`);--> statement-breakpoint
CREATE TABLE `stock_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`store_id` text NOT NULL,
	`item_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`kind` text NOT NULL,
	`qty_base` integer NOT NULL,
	`unit_cost_micro` integer NOT NULL,
	`doc_type` text NOT NULL,
	`doc_id` text NOT NULL,
	`doc_line_id` text,
	`reverses_id` text,
	`occurred_at` text NOT NULL,
	`user_id` text,
	`hlc` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_movements_branch_item_batch_idx` ON `stock_movements` (`branch_id`,`item_id`,`batch_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_doc_idx` ON `stock_movements` (`doc_type`,`doc_id`);--> statement-breakpoint
CREATE INDEX `stock_movements_time_idx` ON `stock_movements` (`branch_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`ntn` text,
	`strn` text,
	`terms_days` integer DEFAULT 0 NOT NULL,
	`credit_limit_minor` integer DEFAULT 0 NOT NULL,
	`opening_balance_minor` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `units_tenant_code_uq` ON `units` (`tenant_id`,`code`);