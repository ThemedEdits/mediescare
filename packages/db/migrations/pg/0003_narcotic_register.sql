CREATE TABLE "narcotic_register" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"sale_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"qty_base" bigint NOT NULL,
	"patient_name" text NOT NULL,
	"patient_cnic" text NOT NULL,
	"doctor_name" text NOT NULL,
	"prescription_ref" text,
	"sold_at" text NOT NULL,
	"sold_by" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"hlc" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "narcotic_register" ADD CONSTRAINT "narcotic_register_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narcotic_register" ADD CONSTRAINT "narcotic_register_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narcotic_register" ADD CONSTRAINT "narcotic_register_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narcotic_register" ADD CONSTRAINT "narcotic_register_sale_line_id_sale_lines_id_fk" FOREIGN KEY ("sale_line_id") REFERENCES "public"."sale_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "narcotic_register" ADD CONSTRAINT "narcotic_register_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "narcotic_register_time_idx" ON "narcotic_register" USING btree ("branch_id","sold_at");