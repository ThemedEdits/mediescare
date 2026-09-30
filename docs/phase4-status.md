# Status: hardware, returns, stock take, settings, i18n and sync foundation

Last updated 2026-09-30. Builds on `phase3-status.md`.

## Checks run

Lint and typecheck clean. Tests: core 97, sync 34, db 259 (+1 scale test), web 195, desktop 40. `pnpm verify:packaged`: 152 smoke checks pass against the real packaged app. `pnpm test:e2e` passes (setup, sale, purchasing, settings, stock take through the real window). `pnpm bench` passes (stock list 172 ms, invoice save 6 ms, search 7 ms).

## Thermal printing and cash drawer (see `printing.md`)

ESC/POS encoder in `packages/core` (80 mm and 58 mm), raw printing through the Windows spooler from the desktop app, drawer kick through the printer's RJ11 port, auto-print and copies, and a Test print / Open drawer screen in Settings. **Not tested on a real printer or drawer.** Urdu on receipts is not supported (thermal printers need raster output).

## Purchase returns (Purchasing > Returns to suppliers)

Pick the batch going back, quantity in any unit, reason, optional supplier credit note number. Stock leaves the batch (ledger movement), the value at batch cost is a credit on the supplier ledger and aging. Expired and blocked batches can be returned. A return can never take a batch below zero. Posted returns cannot be edited or deleted.

## Stock take (`/stock-take`)

Start a count for everything, one category or one rack. The system quantity is frozen; count in packs plus loose units; the sheet shows differences and their value at cost (hidden without the cost right). Posting needs the separate approve right, writes only the differences (counted minus frozen, so sales during the count are kept), and can treat uncounted batches as "leave" or "not found". A loss larger than what is left is limited and reported. One open count per branch.

## Settings (`/settings`)

Rounding, invoice note, tax rate defaults (percent, stored as basis points), receipt printer, cloud sync status and terminal pairing code. All saved together and audited; a bad value saves nothing. The POS reads the print settings from `/api/lookups`. Tax defaults pre-fill the tax rate of new items and a "Fill taxes from branch rates" button on the receive form (sales tax and WHT on goods after discount, advance tax on goods plus sales tax). **That formula is an assumption; please confirm it.**

## Urdu / i18n foundation (see `i18n.md`)

Per-user language, cookie fallback, right-to-left layout, bundled Noto Nastaliq Urdu font (works offline). Translated: menu, top bar, login, change password, dashboard headings. All other screens are still English; `i18n.md` explains how to convert one.

## Sync foundation (see `sync.md`)

Outbox push worker with backoff, epoch fencing, status and "sync now"; LAN discovery and one-time pairing codes; manual promotion CLI. Tested against an in-memory cloud only. **Not built:** Postgres cloud store, applying pulled data locally, initial sync of a fresh branch, standby replication, pairing wizard UI.

## Decisions for the owner

1. Tax default formulas above.
2. Failover document number gap after promotion (`docs/sync.md`).
3. Head Office price fields: `retailRateUnitMicro`, `taxBp`, `taxInclusive`, `maxDiscountBp`.
4. How cloud device tokens are issued and rotated.
5. Receipt labels: Sub total is the sum of lines; Discount and Tax are shown as included information.
6. Printer name is per branch; terminals on other PCs with different printer names need per-terminal settings later.
