CREATE TABLE "po_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"po_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"qty_units" bigint NOT NULL,
	"ordered_base" bigint NOT NULL,
	"unit_price_micro" bigint DEFAULT 0 NOT NULL,
	"received_base" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"expected_date" text,
	"note" text,
	"sub_total_minor" bigint DEFAULT 0 NOT NULL,
	"created_by" text,
	"approved_by" text,
	"approved_at" text,
	"cancel_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"supplier_id" uuid NOT NULL,
	"grn_id" text,
	"amount_minor" bigint NOT NULL,
	"mode_id" uuid NOT NULL,
	"reference" text,
	"note" text,
	"paid_at" text NOT NULL,
	"created_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "grns" ADD COLUMN "po_id" text;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_po_id_purchase_orders_id_fk" FOREIGN KEY ("po_id") REFERENCES "public"."purchase_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "po_lines" ADD CONSTRAINT "po_lines_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_mode_id_payment_modes_id_fk" FOREIGN KEY ("mode_id") REFERENCES "public"."payment_modes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "po_lines_po_idx" ON "po_lines" USING btree ("po_id");--> statement-breakpoint
CREATE INDEX "po_lines_item_idx" ON "po_lines" USING btree ("item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_tenant_docno_uq" ON "purchase_orders" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "purchase_orders_branch_status_idx" ON "purchase_orders" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_payments_tenant_docno_uq" ON "supplier_payments" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "supplier_payments_supplier_idx" ON "supplier_payments" USING btree ("supplier_id","paid_at");--> statement-breakpoint
CREATE INDEX "supplier_payments_grn_idx" ON "supplier_payments" USING btree ("grn_id");