CREATE TABLE "sync_epochs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"epoch" integer NOT NULL,
	"promoted_by" uuid,
	"reason" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_epochs" ADD CONSTRAINT "sync_epochs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_epochs" ADD CONSTRAINT "sync_epochs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_epochs" ADD CONSTRAINT "sync_epochs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_epochs_branch_epoch_uq" ON "sync_epochs" USING btree ("branch_id","epoch");