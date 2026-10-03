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

(Items about opening cash, closed-shift expenses, the Branch Manager role and cloud retention were decided on 2026-10-04, see below.)

1. Terminals still sign in with user sessions; the device token is not yet used to authenticate terminal requests.
2. Vercel Hobby is personal and non-commercial; any free Node host that allows commercial use also runs the cloud app.

## Owner decisions (2026-10-04) and what was done

1. **Opening cash:** stays at zero; adjustable through a cash book opening entry. Built (see `accounts.md`).
2. **Closed-shift till expenses:** a correcting entry is required instead of voiding. Already how it works.
3. **Branch Manager role:** migration added (`0013` SQLite, `0011` Postgres) granting `finance.expense.delete`, `finance.expense.export` and `finance.ledger.create` on existing databases. Tested, including running it twice.
4. **Cloud retention:** the cloud keeps backup and the essential branch sync only (master data down, events up). Reports stay local to each branch PC; there are no cloud reports. This matches what is built: the cloud never computes reports.

Checks after this change: lint and typecheck clean; tests core 97, sync 78, db 428 (28 skipped, live-database and scale tests), web 270, desktop 55; `pnpm verify:packaged` 198 smoke checks; `pnpm test:e2e` passes; stock list 180 ms in the bench.
