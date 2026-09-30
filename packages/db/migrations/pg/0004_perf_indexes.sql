CREATE INDEX "stock_movements_batch_idx" ON "stock_movements" USING btree ("batch_id");
--> statement-breakpoint
CREATE INDEX sale_lines_sale_idx ON sale_lines (sale_id);
--> statement-breakpoint
CREATE INDEX sale_line_allocations_line_idx ON sale_line_allocations (sale_line_id);
--> statement-breakpoint
CREATE INDEX sale_payments_sale_idx ON sale_payments (sale_id);
--> statement-breakpoint
CREATE INDEX sale_returns_sale_idx ON sale_returns (sale_id);
--> statement-breakpoint
CREATE INDEX sale_return_lines_return_idx ON sale_return_lines (return_id);
--> statement-breakpoint
CREATE INDEX grn_lines_grn_idx ON grn_lines (grn_id);
--> statement-breakpoint
CREATE INDEX narcotic_register_sale_idx ON narcotic_register (sale_id);
--> statement-breakpoint
CREATE INDEX batches_branch_item_idx ON batches (branch_id, item_id);
--> statement-breakpoint
CREATE INDEX item_units_item_idx ON item_units (item_id);

--> statement-breakpoint
CREATE INDEX items_name_lower_idx ON items (tenant_id, lower(name));
