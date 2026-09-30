CREATE TABLE `stock_requisition_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`requisition_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` text NOT NULL,
	`qty_requested_base` integer NOT NULL,
	`qty_approved_base` integer,
	FOREIGN KEY (`requisition_id`) REFERENCES `stock_requisitions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_requisition_lines_req_idx` ON `stock_requisition_lines` (`requisition_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_requisition_lines_req_line_uq` ON `stock_requisition_lines` (`requisition_id`,`line_no`);--> statement-breakpoint
CREATE TABLE `stock_requisitions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`from_branch_id` text NOT NULL,
	`to_branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`status` text DEFAULT 'submitted' NOT NULL,
	`needed_by` text,
	`note` text,
	`created_by` text,
	`approved_by` text,
	`approved_at` text,
	`transfer_id` text,
	`cancel_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_requisitions_tenant_docno_uq` ON `stock_requisitions` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE INDEX `stock_requisitions_from_status_idx` ON `stock_requisitions` (`from_branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `stock_requisitions_to_status_idx` ON `stock_requisitions` (`to_branch_id`,`status`);--> statement-breakpoint
CREATE TABLE `stock_transfer_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`transfer_id` text NOT NULL,
	`line_no` integer NOT NULL,
	`item_id` text NOT NULL,
	`source_batch_id` text NOT NULL,
	`batch_no` text NOT NULL,
	`mfg_date` text,
	`expiry_date` text NOT NULL,
	`mrp_unit_micro` integer DEFAULT 0 NOT NULL,
	`cost_unit_micro` integer NOT NULL,
	`qty_dispatched` integer NOT NULL,
	`qty_received` integer DEFAULT 0 NOT NULL,
	`qty_damaged` integer DEFAULT 0 NOT NULL,
	`qty_short` integer DEFAULT 0 NOT NULL,
	`received_batch_id` text,
	FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `stock_transfer_lines_transfer_idx` ON `stock_transfer_lines` (`transfer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `stock_transfer_lines_transfer_line_uq` ON `stock_transfer_lines` (`transfer_id`,`line_no`);--> statement-breakpoint
CREATE INDEX `stock_transfer_lines_item_idx` ON `stock_transfer_lines` (`item_id`);--> statement-breakpoint
CREATE TABLE `stock_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`from_branch_id` text NOT NULL,
	`to_branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`requisition_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`note` text,
	`created_by` text,
	`dispatched_by` text,
	`dispatched_at` text,
	`received_by` text,
	`received_at` text,
	`receive_note` text,
	`cancel_reason` text,
	`dispatched_cost_minor` integer DEFAULT 0 NOT NULL,
	`received_cost_minor` integer DEFAULT 0 NOT NULL,
	`damaged_cost_minor` integer DEFAULT 0 NOT NULL,
	`short_cost_minor` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stock_transfers_tenant_docno_uq` ON `stock_transfers` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE INDEX `stock_transfers_from_status_idx` ON `stock_transfers` (`from_branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `stock_transfers_to_status_idx` ON `stock_transfers` (`to_branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `stock_transfers_requisition_idx` ON `stock_transfers` (`requisition_id`);--> statement-breakpoint
CREATE TRIGGER stock_requisitions_no_delete BEFORE DELETE ON stock_requisitions
BEGIN SELECT RAISE(ABORT, 'requisitions are never deleted, cancel them instead'); END;
--> statement-breakpoint
CREATE TRIGGER stock_requisitions_status_forward BEFORE UPDATE ON stock_requisitions
WHEN NOT (
  (OLD.status = 'submitted' AND NEW.status IN ('approved', 'cancelled'))
  OR (OLD.status = 'approved' AND NEW.status = 'fulfilled')
)
BEGIN SELECT RAISE(ABORT, 'a requisition status only moves forward'); END;
--> statement-breakpoint
CREATE TRIGGER stock_requisitions_identity_frozen BEFORE UPDATE ON stock_requisitions
WHEN NEW.doc_no <> OLD.doc_no OR NEW.from_branch_id <> OLD.from_branch_id
  OR NEW.to_branch_id <> OLD.to_branch_id OR NEW.tenant_id <> OLD.tenant_id
BEGIN SELECT RAISE(ABORT, 'a requisition number and branches cannot change'); END;
--> statement-breakpoint
CREATE TRIGGER stock_requisition_lines_no_delete BEFORE DELETE ON stock_requisition_lines
BEGIN SELECT RAISE(ABORT, 'requisition lines are never deleted'); END;
--> statement-breakpoint
CREATE TRIGGER stock_requisition_lines_frozen BEFORE UPDATE ON stock_requisition_lines
WHEN NEW.item_id <> OLD.item_id OR NEW.qty_requested_base <> OLD.qty_requested_base
  OR NEW.requisition_id <> OLD.requisition_id OR NEW.line_no <> OLD.line_no
  OR (SELECT status FROM stock_requisitions WHERE id = OLD.requisition_id) <> 'submitted'
BEGIN SELECT RAISE(ABORT, 'requisition lines can only be approved while the requisition is submitted'); END;
--> statement-breakpoint
CREATE TRIGGER stock_transfers_no_delete BEFORE DELETE ON stock_transfers
BEGIN SELECT RAISE(ABORT, 'transfer notes are never deleted, cancel them instead'); END;
--> statement-breakpoint
CREATE TRIGGER stock_transfers_status_forward BEFORE UPDATE ON stock_transfers
WHEN NOT (
  (OLD.status = 'draft' AND NEW.status IN ('dispatched', 'cancelled'))
  OR (OLD.status = 'dispatched' AND NEW.status = 'received')
)
BEGIN SELECT RAISE(ABORT, 'a posted transfer note cannot be edited, it only moves forward'); END;
--> statement-breakpoint
CREATE TRIGGER stock_transfers_identity_frozen BEFORE UPDATE ON stock_transfers
WHEN NEW.doc_no <> OLD.doc_no OR NEW.from_branch_id <> OLD.from_branch_id
  OR NEW.to_branch_id <> OLD.to_branch_id OR NEW.tenant_id <> OLD.tenant_id
  OR (OLD.status <> 'draft' AND NEW.dispatched_cost_minor <> OLD.dispatched_cost_minor)
BEGIN SELECT RAISE(ABORT, 'a transfer note number, branches and dispatched value cannot change'); END;
--> statement-breakpoint
CREATE TRIGGER stock_transfer_lines_no_delete BEFORE DELETE ON stock_transfer_lines
BEGIN SELECT RAISE(ABORT, 'transfer lines are never deleted'); END;
--> statement-breakpoint
CREATE TRIGGER stock_transfer_lines_receipt_only BEFORE UPDATE ON stock_transfer_lines
WHEN NEW.item_id <> OLD.item_id OR NEW.transfer_id <> OLD.transfer_id OR NEW.line_no <> OLD.line_no
  OR NEW.source_batch_id <> OLD.source_batch_id OR NEW.batch_no <> OLD.batch_no
  OR NEW.expiry_date <> OLD.expiry_date OR NEW.cost_unit_micro <> OLD.cost_unit_micro
  OR NEW.qty_dispatched <> OLD.qty_dispatched
  OR (SELECT status FROM stock_transfers WHERE id = OLD.transfer_id) <> 'dispatched'
  OR NEW.qty_received < 0 OR NEW.qty_damaged < 0 OR NEW.qty_short < 0
  OR NEW.qty_received + NEW.qty_damaged + NEW.qty_short <> NEW.qty_dispatched
BEGIN SELECT RAISE(ABORT, 'transfer lines can only record the receipt of a dispatched transfer'); END;
