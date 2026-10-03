CREATE TABLE `cash_adjustments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`entry_date` text NOT NULL,
	`kind` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`mode_id` text NOT NULL,
	`note` text NOT NULL,
	`status` text DEFAULT 'posted' NOT NULL,
	`void_reason` text,
	`voided_by` text,
	`voided_at` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mode_id`) REFERENCES `payment_modes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cash_adjustments_tenant_docno_uq` ON `cash_adjustments` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE INDEX `cash_adjustments_branch_date_idx` ON `cash_adjustments` (`branch_id`,`entry_date`);--> statement-breakpoint
CREATE TRIGGER cash_adjustments_no_delete BEFORE DELETE ON cash_adjustments
BEGIN SELECT RAISE(ABORT, 'cash book entries are never deleted, void them instead'); END;
--> statement-breakpoint
CREATE TRIGGER cash_adjustments_frozen BEFORE UPDATE ON cash_adjustments
WHEN OLD.status <> 'posted' OR NEW.status NOT IN ('posted', 'void')
  OR NEW.amount_minor <> OLD.amount_minor OR NEW.entry_date <> OLD.entry_date OR NEW.kind <> OLD.kind
  OR NEW.mode_id <> OLD.mode_id OR NEW.note <> OLD.note OR NEW.doc_no <> OLD.doc_no
BEGIN SELECT RAISE(ABORT, 'a posted cash book entry cannot be changed, only voided'); END;
