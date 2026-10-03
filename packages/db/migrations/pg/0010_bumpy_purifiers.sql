CREATE TABLE "cash_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"entry_date" text NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"mode_id" uuid NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"void_reason" text,
	"voided_by" text,
	"voided_at" text,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cash_adjustments" ADD CONSTRAINT "cash_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_adjustments" ADD CONSTRAINT "cash_adjustments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_adjustments" ADD CONSTRAINT "cash_adjustments_mode_id_payment_modes_id_fk" FOREIGN KEY ("mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_adjustments_tenant_docno_uq" ON "cash_adjustments" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "cash_adjustments_branch_date_idx" ON "cash_adjustments" USING btree ("branch_id","entry_date");