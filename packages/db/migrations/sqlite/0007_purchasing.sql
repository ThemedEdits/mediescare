CREATE TABLE `po_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`po_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`qty_units` integer NOT NULL,
	`ordered_base` integer NOT NULL,
	`unit_price_micro` integer DEFAULT 0 NOT NULL,
	`received_base` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`po_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`unit_id`) REFERENCES `units`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `po_lines_po_idx` ON `po_lines` (`po_id`);--> statement-breakpoint
CREATE INDEX `po_lines_item_idx` ON `po_lines` (`item_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`supplier_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`expected_date` text,
	`note` text,
	`sub_total_minor` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`approved_by` text,
	`approved_at` text,
	`cancel_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_tenant_docno_uq` ON `purchase_orders` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE INDEX `purchase_orders_branch_status_idx` ON `purchase_orders` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `purchase_orders_supplier_idx` ON `purchase_orders` (`supplier_id`);--> statement-breakpoint
CREATE TABLE `supplier_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`supplier_id` text NOT NULL,
	`grn_id` text,
	`amount_minor` integer NOT NULL,
	`mode_id` text NOT NULL,
	`reference` text,
	`note` text,
	`paid_at` text NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mode_id`) REFERENCES `payment_modes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `supplier_payments_tenant_docno_uq` ON `supplier_payments` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE INDEX `supplier_payments_supplier_idx` ON `supplier_payments` (`supplier_id`,`paid_at`);--> statement-breakpoint
CREATE INDEX `supplier_payments_grn_idx` ON `supplier_payments` (`grn_id`);--> statement-breakpoint
ALTER TABLE `grns` ADD `po_id` text;
--> statement-breakpoint
CREATE TRIGGER supplier_payments_no_update BEFORE UPDATE ON supplier_payments
BEGIN SELECT RAISE(ABORT, 'supplier payments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER supplier_payments_no_delete BEFORE DELETE ON supplier_payments
BEGIN SELECT RAISE(ABORT, 'supplier payments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER purchase_orders_no_delete BEFORE DELETE ON purchase_orders
BEGIN SELECT RAISE(ABORT, 'purchase orders are never deleted, cancel them instead'); END;
