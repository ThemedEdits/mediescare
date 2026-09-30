CREATE TABLE `sync_epochs` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`device_id` text NOT NULL,
	`epoch` integer NOT NULL,
	`promoted_by` text,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`hlc` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_epochs_branch_epoch_uq` ON `sync_epochs` (`branch_id`,`epoch`);