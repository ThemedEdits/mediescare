ALTER TABLE "override_events" ADD COLUMN "expires_at" text;--> statement-breakpoint
ALTER TABLE "override_events" ADD COLUMN "consumed_at" text;--> statement-breakpoint
ALTER TABLE "override_events" ADD COLUMN "consumed_reference" text;