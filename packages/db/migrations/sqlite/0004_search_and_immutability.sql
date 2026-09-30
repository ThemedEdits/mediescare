-- Item search: SQLite FTS5 index (local only, rebuilt from items; not synced). Prefix indexes make
-- typing "para" match "Paracetamol" fast on 100k+ items (POS search budget: under 100 ms).
CREATE VIRTUAL TABLE items_fts USING fts5(
  item_id UNINDEXED,
  name,
  generic_name,
  barcodes,
  sku,
  tokenize = 'unicode61 remove_diacritics 2',
  prefix = '2 3 4'
);
--> statement-breakpoint

-- Stock ledger is append-only (CLAUDE.md §4.3 rule 4): corrections are new reversing movements.
CREATE TRIGGER stock_movements_no_update BEFORE UPDATE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER stock_movements_no_delete BEFORE DELETE ON stock_movements
BEGIN SELECT RAISE(ABORT, 'stock_movements is append-only'); END;
--> statement-breakpoint

-- Posted financial documents are immutable (CLAUDE.md §4.3 rule 5). Lines and payments never change.
CREATE TRIGGER sale_lines_no_update BEFORE UPDATE ON sale_lines
BEGIN SELECT RAISE(ABORT, 'posted sale lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sale_lines_no_delete BEFORE DELETE ON sale_lines
BEGIN SELECT RAISE(ABORT, 'posted sale lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sale_line_allocations_no_update BEFORE UPDATE ON sale_line_allocations
BEGIN SELECT RAISE(ABORT, 'sale allocations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sale_line_allocations_no_delete BEFORE DELETE ON sale_line_allocations
BEGIN SELECT RAISE(ABORT, 'sale allocations are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sale_payments_no_update BEFORE UPDATE ON sale_payments
BEGIN SELECT RAISE(ABORT, 'sale payments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sale_payments_no_delete BEFORE DELETE ON sale_payments
BEGIN SELECT RAISE(ABORT, 'sale payments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sale_return_lines_no_update BEFORE UPDATE ON sale_return_lines
BEGIN SELECT RAISE(ABORT, 'return lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sale_return_lines_no_delete BEFORE DELETE ON sale_return_lines
BEGIN SELECT RAISE(ABORT, 'return lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sale_returns_no_update BEFORE UPDATE ON sale_returns
BEGIN SELECT RAISE(ABORT, 'sale returns are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER sale_returns_no_delete BEFORE DELETE ON sale_returns
BEGIN SELECT RAISE(ABORT, 'sale returns are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER grn_lines_no_update BEFORE UPDATE ON grn_lines
BEGIN SELECT RAISE(ABORT, 'posted GRN lines are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER grn_lines_no_delete BEFORE DELETE ON grn_lines
BEGIN SELECT RAISE(ABORT, 'posted GRN lines are immutable'); END;
--> statement-breakpoint

-- Invoice and GRN headers: never deleted. An invoice may only move posted -> void (with reason),
-- and no money or number field may change. Sync bookkeeping columns (hlc, version, updated_at) may.
CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales
BEGIN SELECT RAISE(ABORT, 'invoices are never deleted, void them instead'); END;
--> statement-breakpoint
CREATE TRIGGER sales_immutable_fields BEFORE UPDATE ON sales
WHEN NEW.doc_no IS NOT OLD.doc_no
  OR NEW.gross_minor IS NOT OLD.gross_minor
  OR NEW.discount_minor IS NOT OLD.discount_minor
  OR NEW.tax_minor IS NOT OLD.tax_minor
  OR NEW.rounding_minor IS NOT OLD.rounding_minor
  OR NEW.grand_total_minor IS NOT OLD.grand_total_minor
  OR NEW.paid_minor IS NOT OLD.paid_minor
  OR NEW.due_minor IS NOT OLD.due_minor
  OR NEW.cost_minor IS NOT OLD.cost_minor
  OR NEW.shift_id IS NOT OLD.shift_id
  OR NEW.customer_id IS NOT OLD.customer_id
  OR NEW.created_by IS NOT OLD.created_by
  OR (OLD.status = 'void' AND NEW.status IS NOT 'void')
BEGIN SELECT RAISE(ABORT, 'posted invoices are immutable: void or return instead'); END;
--> statement-breakpoint
CREATE TRIGGER grns_no_delete BEFORE DELETE ON grns
BEGIN SELECT RAISE(ABORT, 'GRNs are never deleted'); END;
--> statement-breakpoint
CREATE TRIGGER grns_immutable_fields BEFORE UPDATE ON grns
WHEN NEW.doc_no IS NOT OLD.doc_no
  OR NEW.supplier_id IS NOT OLD.supplier_id
  OR NEW.sub_total_minor IS NOT OLD.sub_total_minor
  OR NEW.total_minor IS NOT OLD.total_minor
  OR NEW.discount_minor IS NOT OLD.discount_minor
  OR NEW.sales_tax_minor IS NOT OLD.sales_tax_minor
  OR NEW.advance_tax_minor IS NOT OLD.advance_tax_minor
  OR NEW.wht_minor IS NOT OLD.wht_minor
BEGIN SELECT RAISE(ABORT, 'posted GRNs are immutable'); END;
