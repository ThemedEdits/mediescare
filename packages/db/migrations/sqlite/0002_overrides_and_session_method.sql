ALTER TABLE `override_events` ADD `expires_at` text;--> statement-breakpoint
ALTER TABLE `override_events` ADD `consumed_at` text;--> statement-breakpoint
ALTER TABLE `override_events` ADD `consumed_reference` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `auth_method` text DEFAULT 'password' NOT NULL;