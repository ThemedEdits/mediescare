CREATE TABLE "stock_requisition_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requisition_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"qty_requested_base" bigint NOT NULL,
	"qty_approved_base" bigint
);
--> statement-breakpoint
CREATE TABLE "stock_requisitions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"needed_by" text,
	"note" text,
	"created_by" text,
	"approved_by" text,
	"approved_at" text,
	"transfer_id" text,
	"cancel_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_transfer_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transfer_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"source_batch_id" text NOT NULL,
	"batch_no" text NOT NULL,
	"mfg_date" text,
	"expiry_date" text NOT NULL,
	"mrp_unit_micro" bigint DEFAULT 0 NOT NULL,
	"cost_unit_micro" bigint NOT NULL,
	"qty_dispatched" bigint NOT NULL,
	"qty_received" bigint DEFAULT 0 NOT NULL,
	"qty_damaged" bigint DEFAULT 0 NOT NULL,
	"qty_short" bigint DEFAULT 0 NOT NULL,
	"received_batch_id" text
);
--> statement-breakpoint
CREATE TABLE "stock_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_branch_id" uuid NOT NULL,
	"to_branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"requisition_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"note" text,
	"created_by" text,
	"dispatched_by" text,
	"dispatched_at" text,
	"received_by" text,
	"received_at" text,
	"receive_note" text,
	"cancel_reason" text,
	"dispatched_cost_minor" bigint DEFAULT 0 NOT NULL,
	"received_cost_minor" bigint DEFAULT 0 NOT NULL,
	"damaged_cost_minor" bigint DEFAULT 0 NOT NULL,
	"short_cost_minor" bigint DEFAULT 0 NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_requisition_lines" ADD CONSTRAINT "stock_requisition_lines_requisition_id_stock_requisitions_id_fk" FOREIGN KEY ("requisition_id") REFERENCES "public"."stock_requisitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requisition_lines" ADD CONSTRAINT "stock_requisition_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requisitions" ADD CONSTRAINT "stock_requisitions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requisitions" ADD CONSTRAINT "stock_requisitions_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_requisitions" ADD CONSTRAINT "stock_requisitions_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_transfer_id_stock_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."stock_transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfer_lines" ADD CONSTRAINT "stock_transfer_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_from_branch_id_branches_id_fk" FOREIGN KEY ("from_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_transfers" ADD CONSTRAINT "stock_transfers_to_branch_id_branches_id_fk" FOREIGN KEY ("to_branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_requisition_lines_req_idx" ON "stock_requisition_lines" USING btree ("requisition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_requisition_lines_req_line_uq" ON "stock_requisition_lines" USING btree ("requisition_id","line_no");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_requisitions_tenant_docno_uq" ON "stock_requisitions" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "stock_requisitions_from_status_idx" ON "stock_requisitions" USING btree ("from_branch_id","status");--> statement-breakpoint
CREATE INDEX "stock_requisitions_to_status_idx" ON "stock_requisitions" USING btree ("to_branch_id","status");--> statement-breakpoint
CREATE INDEX "stock_transfer_lines_transfer_idx" ON "stock_transfer_lines" USING btree ("transfer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfer_lines_transfer_line_uq" ON "stock_transfer_lines" USING btree ("transfer_id","line_no");--> statement-breakpoint
CREATE INDEX "stock_transfer_lines_item_idx" ON "stock_transfer_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_transfers_tenant_docno_uq" ON "stock_transfers" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "stock_transfers_from_status_idx" ON "stock_transfers" USING btree ("from_branch_id","status");--> statement-breakpoint
CREATE INDEX "stock_transfers_to_status_idx" ON "stock_transfers" USING btree ("to_branch_id","status");--> statement-breakpoint
CREATE INDEX "stock_transfers_requisition_idx" ON "stock_transfers" USING btree ("requisition_id");