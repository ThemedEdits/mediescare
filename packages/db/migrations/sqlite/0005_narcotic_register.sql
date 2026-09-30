CREATE TABLE `narcotic_register` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`sale_id` text NOT NULL,
	`sale_line_id` text NOT NULL,
	`item_id` text NOT NULL,
	`qty_base` integer NOT NULL,
	`patient_name` text NOT NULL,
	`patient_cnic` text NOT NULL,
	`doctor_name` text NOT NULL,
	`prescription_ref` text,
	`sold_at` text NOT NULL,
	`sold_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_id`) REFERENCES `sales`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`sale_line_id`) REFERENCES `sale_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `narcotic_register_time_idx` ON `narcotic_register` (`branch_id`,`sold_at`);