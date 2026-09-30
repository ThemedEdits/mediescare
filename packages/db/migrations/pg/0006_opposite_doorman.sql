CREATE TABLE "purchase_return_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"return_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"qty_base" bigint NOT NULL,
	"cost_unit_micro" bigint NOT NULL,
	"line_total_minor" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_returns" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"grn_id" text,
	"reason" text NOT NULL,
	"note" text,
	"credit_note_no" text,
	"total_minor" bigint NOT NULL,
	"status" text DEFAULT 'posted' NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_take_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"take_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"system_qty_base" bigint NOT NULL,
	"counted_qty_base" bigint,
	"cost_unit_micro" bigint NOT NULL,
	"counted_by" text,
	"counted_at" text
);
--> statement-breakpoint
CREATE TABLE "stock_takes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"note" text,
	"started_by" text,
	"posted_by" text,
	"posted_at" text,
	"cancel_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_return_id_purchase_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."purchase_returns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_take_id_stock_takes_id_fk" FOREIGN KEY ("take_id") REFERENCES "public"."stock_takes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_lines" ADD CONSTRAINT "stock_take_lines_batch_id_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_takes" ADD CONSTRAINT "stock_takes_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_return_lines_return_idx" ON "purchase_return_lines" USING btree ("return_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_returns_tenant_docno_uq" ON "purchase_returns" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "purchase_returns_supplier_idx" ON "purchase_returns" USING btree ("supplier_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_take_lines_take_idx" ON "stock_take_lines" USING btree ("take_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_take_lines_take_batch_uq" ON "stock_take_lines" USING btree ("take_id","batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_takes_tenant_docno_uq" ON "stock_takes" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "stock_takes_branch_status_idx" ON "stock_takes" USING btree ("branch_id","status");