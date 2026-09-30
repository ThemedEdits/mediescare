# Status: purchasing, reports hub and item import

Last updated 2026-09-30. Builds on the Phase 2 slice (`phase2-status.md`).

## Decisions confirmed by the owner

- **Purchase formula:** bill total = goods − discount + sales tax + advance tax + freight. WHT is kept separately.
- **Rounding:** whole-rupee rounding is the default. It is a per-branch setting (`pos.rounding`: `none`, `rupee`, `half_rupee`) read on the server when a sale is saved, so a terminal cannot choose its own. Admins change it through `PUT /api/settings/pos`. There is no settings screen yet.
- **Printers:** standard 80 mm receipt layout. Receipts still print through the browser print dialog; raw ESC/POS output and cash drawer kick are **not built**.

## Purchasing (`/purchasing`)

- **Purchase orders:** draft → approved → partial → received, or cancelled with a reason. Only a draft can be edited (optimistic version check). Approval needs `purchasing.purchase_order.approve`. The order gets a branch-prefixed number (`KHI01-PO-000001`).
- **Order suggestions:** "Fill from low stock" adds items at or below their reorder level (target: twice the reorder level) and items customers asked for and did not find in the last 30 days, priced at the latest batch cost.
- **Receiving against an order:** the goods receipt form takes an order, pre-fills supplier, quantities still outstanding and prices, and on save counts the delivered quantity against the order lines. Delivering less leaves the order partial; delivering everything closes it. A draft, cancelled or another supplier's order is refused.
- **Supplier bills:** every goods receipt is a bill. The amount owed is the total less WHT. Filter by supplier, date, supplier invoice number, unpaid only.
- **Supplier payments:** immutable documents (`KHI01-PAY-000001`). A payment can be tied to one bill (cannot exceed what that bill still owes) or be on account. Payments are back-office and do not change a cashier shift's expected cash.
- **Supplier ledger:** opening balance + bills − payments with a running balance, printable statement, and ageing buckets (not due, 1–30, 31–60, 61–90, over 90) from the supplier's credit terms. Payments on account are applied to the oldest amounts first, so an advance never hides an overdue bill.
- **Print:** purchase order and supplier statement print on A4 through the browser print dialog.
- Migrations: SQLite `0007_purchasing`, Postgres `0005_purchasing` (tables `purchase_orders`, `po_lines`, `supplier_payments`, and `grns.po_id`). Payments and orders cannot be deleted; payments cannot be edited (triggers).

## Reports hub (`/reports`)

13 reports, each with date range and filters, on-screen table, print (A4 landscape) and Excel export:
daily sales, invoices, sales by item, discounts, sales by cashier, sales by payment method, current stock, stock valuation, low stock, expiry (0–30, 31–60, 61–90, 91–180 days and expired), profit and loss, narcotic register, missed sales.

- Permission per report (`reports.<group>.view` / `export`). Cost and profit columns are removed on the server for roles without the right.
- Excel export is generated on the server (`exceljs`) with a title, the filters used, frozen header, money as numbers with two decimals and a totals row.
- **Print / Save as PDF** uses the window's print path. In the desktop app it goes through a guarded `printToPdf` bridge that only the app's own pages can call. This path has not been exercised in a real window yet.
- Profit: revenue excludes tax and is net of returns on the day they are made; restocked returns take their cost back, damaged returns stay a loss.

## Item import from Excel or CSV (`/items/import`, permission `pharmacy.item.import`)

Upload, map columns, review, import. Nothing is written until you press import.

- **Files:** .xlsx or .csv, up to 25 MB and 200,000 rows. A starter template is available on the page.
- **Columns:** matched by header name (for example Item Name, Barcode, Category, Manufacturer, Unit, Conversion Unit, Unit Cost, Retail Price, Reordering Level, Available Qty, Expiry Date, Batch No). You can change any mapping before importing. Expired Qty and Dead Item are never imported.
- **Checks:** missing name, bad price/cost/quantity/expiry are errors and that row is skipped. Items whose barcode or item code already exist are skipped, so the same file can be imported again safely. Warnings (zero price, blank category, duplicate or fake barcode, possible duplicate name) still import. A CSV of all issues can be downloaded.
- **Opening stock (optional):** rows with a quantity become an opening batch in the stock ledger at their cost. Rows with no expiry use a default expiry you choose; rows with no cost or an expired date are left out and counted.
- **Speed** (53,000 fake rows, encrypted database, this PC): validation 0.3 s, import 14 to 24 s in 1,000-row chunks, search afterwards 1 to 14 ms.
- **Limits:** import jobs live in memory for 30 minutes (a restart loses an unfinished one). Re-import only recognises rows that have a barcode or item code. Suppliers in the file are not created.

## Checks run for this slice

Lint and typecheck clean. Tests: core 82, db 214 (+1 scale test), web 138, desktop 6. `pnpm verify:packaged`: 127 smoke checks pass against the real packaged app. `pnpm test:e2e` passes, including the purchasing flow through the real window. `pnpm bench` passes (stock list 164 ms). The bench first failed (stock list 345 ms) because a search ran twice per page; the count now comes from the same query.

## Not done

Raw ESC/POS printing and cash drawer, Urdu/i18n, purchase returns, stock take, multiple branches and LAN terminals, cloud sync, inter-branch transfers.
