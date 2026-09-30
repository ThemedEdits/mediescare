# Phase 2 status: pharmacy core and POS (vertical slice)

Last updated 2026-09-30. This is a working **slice**, not all of Phase 2. It covers item master, batches, inventory ledger and the keyboard-first POS, plus the backup/recovery and users/roles/PIN work that was done first.

## Verified

| Check                         | Result                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm lint`, `pnpm typecheck` | pass                                                                                                                                                               |
| `pnpm test`                   | **359** tests pass (core 82, sync 12, db 163, web 98, desktop 4)                                                                                                   |
| `pnpm verify:packaged`        | build, package and **87** smoke checks against the real packaged app pass                                                                                          |
| `pnpm test:e2e`               | real-window UI test passes: setup, recovery key, sign-in, create item, receive stock, open shift, sell by barcode scan and by keyboard, stock and dashboard update |
| `pnpm bench` (100,000 items)  | typed search 7.6 ms (budget 100), barcode 1.2 ms, stock list page 144 ms (300), invoice save 6.9 ms (300)                                                          |

The benchmark found two real problems that are now fixed: a missing index on `stock_movements.batch_id` (every search scanned the whole ledger) and missing query statistics (the planner chose a wide scan: invoice save took 1.5 s instead of 7 ms). The server now refreshes statistics at start and daily.

The end-to-end test found a real desktop bug: quick-add buttons used `window.prompt()`, which Electron does not support. They now use an in-app dialog.

## What is in the slice

- **Items:** name, generic name, strength, form, category, manufacturer, rack, multiple barcodes, units and packs (tablet / strip / box with conversion), price per unit, sales tax, reorder level, prescription, narcotic, cold chain, allow-negative-stock, active. Optimistic locking. Units per pack cannot change after creation.
- **Search:** exact barcode, then names starting with the typed text (index), then words anywhere via FTS5. Hits carry sellable stock, earliest expiry and batches.
- **Stock:** append-only ledger (database triggers block update and delete). On hand is always the sum of movements. Goods receipt with batch, expiry, bonus units (lowers batch cost), discount, sales tax, advance tax, WHT, freight. Expired stock refused. Adjustments with reasons. Stock list, batches with expiry badges, stock value (only for roles that may see cost).
- **POS:** scan or type, first-expiry-first batch allocation with manual batch choice, expired and blocked batches never sold, unit switching, line and bill discounts, tax, price change, split payments, change only on cash, sale on account within credit limit, hold and recall on the server, missed sale, controlled items need patient, CNIC and doctor and are written to the narcotic register, idempotent retry, receipt printing (browser print, 80 mm layout).
- **Approvals:** discount above the role limit, price change, selling below cost, void and refund above the limit need a manager PIN. One use, two minutes, logged.
- **Shifts:** open with a float, blind cash count at close, expected cash = float + cash sales - cash refunds, variance.
- **Sales:** list, detail, void (open shift only, stock comes back, invoice stays in the books), partial and full returns with refund in proportion, restock or damaged.
- **Immutability:** posted invoices, GRNs, returns, lines and payments cannot be edited or deleted, even by direct database access (triggers).
- **Field-level rules:** cost and profit fields are removed from API responses for users without the right (cashier responses verified in the smoke test).

## Assumptions to confirm (owner questions still open)

1. **Purchase totals (Q7):** `total = goods - discount + sales tax + advance tax + freight`. WHT is stored as the amount withheld when paying the supplier. The real tax treatment is not confirmed.
2. **Bill rounding (Q12):** default is no rounding. The code supports nearest rupee and half rupee, but there is no settings screen yet.
3. **Below-cost sales:** always need a manager approval. Confirm this is wanted.
4. **Expiry:** a batch is sellable through its printed expiry date and expired from the next day. Near-expiry windows 30/60/90/180 are shown as badges only.
5. **Negative stock:** off by default, enabled per item.

## Not done in Phase 2 (still to build)

Purchase orders, purchase returns and supplier credit notes; supplier payments and ledgers; customer ledger and receipts on account; stock take and cycle counts; expiry and dead-stock reports and the rest of the reports hub; Excel export; barcode label printing; ESC/POS thermal printing, cash drawer and customer display (needs printer models); prescription image attach; doctor-wise sales; generic substitution search; loyalty; item import from Excel; urdu/i18n; settings screens (rounding, invoice note, shifts definitions, near-expiry windows); column customisation in grids. The hold-invoice screen works across counters of a branch only on the same server (no LAN terminals yet).

## Known limits

- Stock value sums use JavaScript numbers for the sum of `qty x cost`. Fine at PKR 10 crore scale, to be moved to BigInt sums before very large catalogues.
- The search index ranks prefix matches first and then matches in insertion order. There is no relevance scoring for words found in the middle of names (ranking thousands of matches cost more than the 100 ms budget).
- `synchronous=FULL` is kept for power-cut safety. Invoice save measured 7 ms on the development PC. An old HDD may be slower. Re-measure on the real shop PC.
- The UI test covers the main path. Void, return, override and narcotic dialogs are covered by API and database tests and the smoke test, not by the UI test yet.
