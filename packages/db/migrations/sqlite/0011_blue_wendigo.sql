CREATE TABLE `expense_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'operating' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expense_categories_tenant_name_uq` ON `expense_categories` (`tenant_id`,`name`);--> statement-breakpoint
CREATE TABLE `expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`doc_no` text NOT NULL,
	`expense_date` text NOT NULL,
	`category_id` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`mode_id` text NOT NULL,
	`payee` text,
	`reference` text,
	`note` text,
	`shift_id` text,
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
	FOREIGN KEY (`category_id`) REFERENCES `expense_categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mode_id`) REFERENCES `payment_modes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `expenses_tenant_docno_uq` ON `expenses` (`tenant_id`,`doc_no`);--> statement-breakpoint
CREATE INDEX `expenses_branch_date_idx` ON `expenses` (`branch_id`,`expense_date`);--> statement-breakpoint
CREATE INDEX `expenses_category_idx` ON `expenses` (`category_id`);--> statement-breakpoint
CREATE INDEX `expenses_shift_idx` ON `expenses` (`shift_id`);--> statement-breakpoint
CREATE TRIGGER expenses_no_delete BEFORE DELETE ON expenses
BEGIN SELECT RAISE(ABORT, 'expenses are never deleted, void them instead'); END;
--> statement-breakpoint
CREATE TRIGGER expenses_only_void BEFORE UPDATE ON expenses
WHEN NOT (
  OLD.status = 'posted' AND NEW.status = 'void'
  AND NEW.id = OLD.id AND NEW.tenant_id = OLD.tenant_id AND NEW.branch_id = OLD.branch_id
  AND NEW.doc_no = OLD.doc_no AND NEW.expense_date = OLD.expense_date
  AND NEW.category_id = OLD.category_id AND NEW.amount_minor = OLD.amount_minor
  AND NEW.mode_id = OLD.mode_id AND NEW.payee IS OLD.payee AND NEW.reference IS OLD.reference
  AND NEW.note IS OLD.note AND NEW.shift_id IS OLD.shift_id AND NEW.created_by IS OLD.created_by
)
BEGIN SELECT RAISE(ABORT, 'posted expenses are immutable, only a void is allowed'); END;
