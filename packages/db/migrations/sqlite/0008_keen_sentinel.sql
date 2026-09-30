CREATE TABLE `purchase_return_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`return_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`qty_base` integer NOT NULL,
	`cost_unit_micro` integer NOT NULL,
	`line_total_minor` integer NOT NULL,
	FOREIGN KEY (`return_id`) REFERENCES `purchase_returns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `purchase_return_lines_return_idx` ON `purchase_return_lines` (`return_id`);--> statement-breakpoint
CREATE TABLE `purchase_returns` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`supplier_id` text NOT NULL,
	`grn_id` text,
	`reason` text NOT NULL,
	`note` text,
	`credit_note_no` text,
	`total_minor` integer NOT NULL,
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
CREATE UNIQUE INDEX `purchase_returns_tenant_docno_uq` ON `purchase_returns` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE INDEX `purchase_returns_supplier_idx` ON `purchase_returns` (`supplier_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `stock_take_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`take_id` text NOT NULL,
	`item_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`system_qty_base` integer NOT NULL,
	`counted_qty_base` integer,
	`cost_unit_micro` integer NOT NULL,
	`counted_by` text,
	`counted_at` text,
	FOREIGN KEY (`take_id`) REFERENCES `stock_takes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_take_lines_take_idx` ON `stock_take_lines` (`take_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_take_lines_take_batch_uq` ON `stock_take_lines` (`take_id`,`batch_id`);--> statement-breakpoint
CREATE TABLE `stock_takes` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text,
	`started_by` text,
	`posted_by` text,
	`posted_at` text,
	`cancel_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_takes_tenant_docno_uq` ON `stock_takes` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE INDEX `stock_takes_branch_status_idx` ON `stock_takes` (`branch_id`,`status`);--> statement-breakpoint
CREATE TRIGGER purchase_returns_no_update BEFORE UPDATE ON purchase_returns
BEGIN SELECT RAISE(ABORT, 'posted purchase returns are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER purchase_returns_no_delete BEFORE DELETE ON purchase_returns
BEGIN SELECT RAISE(ABORT, 'posted purchase returns are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER purchase_return_lines_no_update BEFORE UPDATE ON purchase_return_lines
BEGIN SELECT RAISE(ABORT, 'purchase return lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER purchase_return_lines_no_delete BEFORE DELETE ON purchase_return_lines
BEGIN SELECT RAISE(ABORT, 'purchase return lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER stock_takes_no_delete BEFORE DELETE ON stock_takes
BEGIN SELECT RAISE(ABORT, 'stock takes are never deleted, cancel them instead'); END;
--> statement-breakpoint
CREATE TRIGGER stock_takes_posted_frozen BEFORE UPDATE ON stock_takes WHEN OLD.status <> 'open'
BEGIN SELECT RAISE(ABORT, 'a posted or cancelled stock take cannot change'); END;
--> statement-breakpoint
CREATE TRIGGER stock_take_lines_no_delete BEFORE DELETE ON stock_take_lines
BEGIN SELECT RAISE(ABORT, 'stock take lines are never deleted'); END;
