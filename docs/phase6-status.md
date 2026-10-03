# Status: live cloud sync, accounting and LAN terminals

Last updated 2026-10-04. Builds on `phase5-status.md`.

## Real Supabase: live

- The Session pooler string is in `.env`; this PC reaches it over IPv4.
- `pnpm cloud:migrate` created the cloud tables in the real database (the `public` schema was empty first, so nothing was touched). Running it again reports "already applied".
- The 26-test cloud-store contract suite passes on the real database in a throw-away schema (opt-in, about 7 minutes, `MEDIESCARE_RUN_LIVE_DB_TESTS=1`).
- `pnpm cloud:check http://localhost:3220` (new): the cloud-mode app on this PC against the real Supabase, with a throw-away organisation. All 12 checks pass: Head Office links, a second branch (KHI02) joins with a one-time code, 100 sales and 2 items upload (about 12 s), each sale is stored exactly once in the real database, master data comes back to the other branch only, sales are not sent to other branches, tokens rotate. The test organisation is deleted afterwards.
- **Not done:** the Vercel deployment (needs the owner's login, steps in `cloud-deploy.md`). When it is deployed, run `pnpm cloud:check https://<your-app>.vercel.app`.

## Refresh token grace window (15 seconds)

A refresh token replaced less than 15 seconds ago (only the newest three retired tokens) is accepted once more and rotated again, so a lost response does not revoke an honest device. Anything later or older still revokes it. Six new tests; configurable in tests. Trade-off: a copied token replayed within 15 s of its use is not detected.

## Basic cash flow and profit and loss (`/accounts`, see `accounts.md`)

Expenses (categories, vouchers numbered EXP, void with reason, optional "taken from my till" that reduces the shift's expected cash), cash book (opening, in and out by payment mode, closing), net profit (revenue, cost of goods, gross profit, expenses by category), reports with Excel export. English and Urdu. No double entry, balance sheet or payroll.

## LAN terminal wizard (see `lan-terminals.md`)

First-run wizard for a branch terminal: search the LAN, pick a server or type its address, enter the 8-digit pairing code, pair, open the server. Friendly errors, firewall help (exact commands, opt-in elevated button), offline page with Retry, Re-pair and Change server, server address and pairing code in the branch-server menu. Verified by launching a real server and a real terminal as two processes on this PC (19 of 19 checks). **Not verified:** a real second PC, the Windows firewall prompt, the packaged installer's menus.

## Checks run

Lint and typecheck clean. Tests: core 97, sync 78, db 443 (live-database tests skipped unless opted in), web 266, desktop 55. `pnpm verify:packaged`: 188 smoke checks. `pnpm test:e2e` passes. `pnpm bench`: search 7 ms, barcode 1.2 ms, invoice save 6 ms, stock list 167 ms.

## Open decisions

1. Opening cash starts at zero on the first day (no opening-cash setting yet).
2. A till expense cannot be voided after its shift closes (a correcting entry is the way).
3. Existing databases need `finance.expense.delete` granted to Branch Manager on the Roles screen.
4. Cloud retention (500 MB free): documented, not automatic. Cloud reports or backup only?
5. Terminals still sign in with user sessions; the device token is not yet used to authenticate terminal requests.
6. Vercel Hobby is personal and non-commercial; any free Node host that allows commercial use also runs the cloud app.
