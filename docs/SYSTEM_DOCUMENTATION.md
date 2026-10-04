# Mediescare: System Documentation

Pharmacy Management, Point of Sale and (planned) Hospital Management System for a multi-branch pharmacy chain in Pakistan. This document describes the system as it is built today (2026-10-04): its architecture, every feature, how data is stored and synchronised, how to run and operate it, and, just as important, what has and has not been verified.

Detailed per-area documents are linked throughout. Where this document and a detailed one disagree, the detailed one and the code win; please report it.

## Contents

1. [System overview and technical stack](#1-system-overview-and-technical-stack)
2. [Complete feature breakdown](#2-complete-feature-breakdown)
3. [Security model](#3-security-model)
4. [Operating the system](#4-operating-the-system)
5. [Verification status and known limits](#5-verification-status-and-known-limits)
6. [Appendices](#6-appendices)

---

## 1. System overview and technical stack

### 1.1 What Mediescare is

An installable **Windows desktop application** for pharmacy operations. Its defining requirements:

- **100% offline.** Every sale, stock movement and report works with no internet. The point of sale never waits for the network.
- **Local, encrypted database** on the branch PC. The PC is the source of truth for its branch.
- **Multiple users per branch** at the same time, and **multiple branches** (a Head Office plus branches).
- **Synchronisation to a cloud database** when internet is available, in the background, without ever blocking the counter.
- Currency **PKR**. Tax fields: Sales Tax, Advance Tax and Withholding Tax (WHT). Bilingual **English and Urdu** (right-to-left).
- **Free to run:** no paid subscriptions (Supabase free tier for the cloud database; any free Node host for the cloud endpoint).

### 1.2 Technology stack

| Layer                 | Technology                                                                                                                                | Notes                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Desktop shell         | **Electron 44** (bundles Node 24), `electron-builder` (Windows NSIS installer)                                                            | Window, installer, menus, printing, LAN discovery, secure storage. Unsigned installer (no code-signing certificate). |
| Application framework | **Next.js 16** (App Router, `output: "standalone"`)                                                                                       | UI, API route handlers and server actions in one codebase. Runs as a local server inside the desktop app.            |
| UI                    | **React 19**, **Tailwind CSS 4**, TypeScript 5.9 (strict)                                                                                 | Design tokens sampled from the Mediescare logo; white background.                                                    |
| Language and runtime  | **TypeScript** everywhere; **Node.js** (Electron's Node 24 at runtime; Node 22.12+ for development tooling)                               | One language across UI, server, database layer and desktop shell.                                                    |
| Local database        | **SQLite** via `better-sqlite3-multiple-ciphers` (SQLCipher-compatible, AES-256), **Drizzle ORM**, WAL mode, `synchronous=FULL`, FTS5     | Encrypted at rest. See 1.4.                                                                                          |
| Cloud database        | **PostgreSQL on Supabase** (free tier) through the **Session Pooler** (IPv4), `postgres` driver, Drizzle schema for parity                | Cloud-only tables are plain SQL. Supabase Auth is **not** used.                                                      |
| Validation            | **Zod** 4                                                                                                                                 | Source of truth for API input types, shared by client and server.                                                    |
| Authentication        | Own implementation: **argon2** password hashing, signed session cookies (**jose**), PIN login for the counter                             | No auth service that needs internet.                                                                                 |
| Tokens (sync)         | **jose** HS256 JWTs                                                                                                                       | See 1.5.                                                                                                             |
| Excel                 | **exceljs**                                                                                                                               | Report export and the item import.                                                                                   |
| Printing              | ESC/POS bytes generated in TypeScript; sent to the Windows spooler by a fixed PowerShell script                                           | No native printer dependency.                                                                                        |
| Internationalisation  | In-house message catalogue (English and Urdu), Noto Nastaliq Urdu font bundled for offline use                                            | See 2.9.                                                                                                             |
| Monorepo              | **pnpm** workspaces + **Turborepo**                                                                                                       | Packages: `core`, `db`, `sync`, `config`; apps: `web`, `desktop`.                                                    |
| Tests                 | **Vitest** (unit and integration), **Playwright** (real-window end-to-end), a 198-check packaged-app smoke test, a 100,000-item benchmark | See section 5.                                                                                                       |

### 1.3 Architecture

```
 Branch PC (Windows)
 ┌────────────────────────────────────────────────────────────────────┐
 │  Electron shell ── window ──►  Next.js server (local, 127.0.0.1)   │
 │   • printing / drawer           • UI + API routes (Zod → RBAC →    │
 │   • LAN discovery, pairing        domain code → one DB transaction)│
 │   • DPAPI-sealed secrets        • background jobs: backups, sync   │
 │                                         │                          │
 │                                         ▼                          │
 │                      Encrypted SQLite (SQLCipher, WAL)             │
 │        domain tables + append-only stock ledger + audit chain      │
 │                    + sync_outbox (same transaction)                │
 └─────────────────────────────────┬──────────────────────────────────┘
                                   │ HTTPS, when internet is available
                                   ▼
        Cloud endpoint (the same Next.js app in "cloud" mode, no SQLite)
                                   │
                                   ▼
        Supabase PostgreSQL (Session Pooler): event log, devices, branches
```

Principles that shape the code:

- **Business rules live in `packages/core`** (pure, heavily unit-tested: money, tax, stock rules, numbering, permissions, ESC/POS encoding), never in React components or route handlers.
- **Route handlers are thin:** validate with Zod, authorise (RBAC, server-side), call domain code inside **one database transaction**, write the audit entry and the sync outbox row in that same transaction, respond.
- **Money is never a float.** Amounts are integer **paisa**. Per-unit rates that need sub-paisa precision use **micro-PKR** (1 paisa = 10,000 micro-PKR). Rounding is centralised and tested (BigInt half-up). See [ADR-0002](adr/0002-money-scale.md).
- **Stock is a ledger, not a number.** Stock on hand is the sum of append-only `stock_movements`. Database triggers block updates and deletes of movements.
- **Posted documents are immutable** (invoices, goods receipts, returns, payments, expenses, transfers, cash book entries). Mistakes are fixed with a void (reason, user, time; stays in reports) or a reversing document, never an edit. Enforced by database triggers, not only by code.
- **IDs** are UUIDv7. **Timestamps** are stored in UTC and ordered across devices with a **Hybrid Logical Clock**, so wrong PC clocks do not corrupt ordering.

### 1.4 Runtime modes

One codebase, selected by `MEDIESCARE_MODE`:

| Mode            | What runs                                                                                              | Status                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `single`        | One PC: Electron, local Next.js server, SQLite                                                         | Built and tested (packaged app)                            |
| `branch-server` | As `single`, but bound to the LAN so terminals can connect; announces itself by UDP                    | Built; tested on one PC                                    |
| `terminal`      | Electron window that connects to the branch server over the LAN; holds no data                         | Built; tested with two processes on one PC                 |
| `cloud`         | The same app deployed on a server; talks to Postgres only; serves only `/api/health` and `/api/sync/*` | Built; run locally against the real Supabase; not deployed |

The first-run wizard asks Single PC, Branch server or Branch terminal. A terminal pairs with a server using a one-time code (see 1.6).

### 1.5 Database layer

#### Local database (every branch)

- **SQLite**, encrypted with a **SQLCipher-compatible AES-256 build**. The database file cannot be read with a normal SQLite viewer, and a copied file or backup is useless without its key.
- **Key management:** a random 256-bit key is created at first run and **wrapped with the Windows credential store (Electron `safeStorage`, which uses DPAPI)**. The wrapped key is stored next to the database and unwrapped at start, so the PC boots to the login screen without a password prompt. Device tokens for sync are sealed the same way. See [ADR-0001](adr/0001-sqlite-encryption.md).
- **Recovery key:** shown once at setup (32 characters in 8 groups). Backups are encrypted with a key derived from it, so **a backup can be restored on a different PC**. Without the recovery key a copied backup cannot be opened. The owner must keep it safe.
- **Durability and concurrency:** WAL mode, `synchronous=FULL` (a power cut cannot lose a committed sale), a busy timeout, a single writer process, short transactions, and optimistic locking (`version` column) on editable master data.
- **Search:** SQLite **FTS5** index for items (exact barcode, then name prefix index, then full-text words). Measured on 100,000 items: typed search about 7 ms, barcode scan about 1 ms.
- **Migrations:** forward-only, generated with drizzle-kit for SQLite and Postgres, applied at start. A safety backup is taken automatically before any schema change on an existing database. A parity test fails if a table or column exists in one dialect and not the other.
- **Size of the schema:** about 60 tables across catalogue, stock ledger, sales, shifts, purchasing, returns, stock take, transfers, expenses and cash book, users and roles, audit, sync and settings.

#### Cloud database

- **PostgreSQL on Supabase (free tier) reached through the Session Pooler.** The direct Supabase host is IPv6-only on the free tier, so the IPv4 pooler string is required (Supabase dashboard, Connect, Session pooler). Prepared statements are not used, for pooler compatibility.
- **Cloud-only tables** (plain SQL in `packages/db/cloud/`, applied with `pnpm cloud:migrate`): `tenants`, `branches` (registry), `devices` (refresh-token hashes), `enrollment_codes`, `sync_events` (the append-only event log), `entity_heads` (merged master-data state), `push_batches`, `epochs`, `sync_conflicts`.
- **Role of the cloud:** backup and the essential branch-to-branch sync only. The cloud does not compute reports; reports stay local to each branch (an owner decision to respect the free 500 MB limit).
- The cloud app never opens SQLite and never loads native modules, so it can run on a serverless host.

### 1.6 Sync architecture

Sync is **opt-in** (off until a PC is connected to the cloud). When it is off, the application behaves exactly as a standalone system.

**Offline-first outbox.** Every business write appends a row to `sync_outbox` **in the same transaction** as the write, so a change can never be saved without being queued. A background worker (never on the request path) pushes queued events when the network is available.

**Push (up).** Events are sent in batches (under 1 MB and 500 events, sized for serverless limits) with an idempotency key. The cloud stores each event exactly once. Duplicates are answered "duplicate" and skipped; a failed batch is retried with exponential backoff; a row is marked sent only after the cloud acknowledges it. Everything saved before the PC was connected is uploaded in order on first connection (resumable, with progress; 50,000 events upload in about 8 seconds into the test store).

**Pull (down).** Master data flows from Head Office to branches; transactions flow up and are not applied on other branches:

| Direction                        | What                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Down (pulled and applied)        | Branches, units, categories, manufacturers, payment modes, suppliers, items (pack units, barcodes), and transfer documents addressed to the branch |
| Up (pushed, stored in the cloud) | Sales, stock movements, purchases, returns, expenses, cash book entries, settings, user and role changes, requisitions and receipts                |
| Local only                       | Users and roles (each branch creates its own), racks, customers, stock quantities                                                                  |

Pulled changes are applied in dependency order (branches, then lookups, suppliers, items, then documents). If a parent record has not arrived yet, the applier waits and the runner retries, so a child is never applied before its parent. Appliers are idempotent and never write to the outbox (a pulled change is not pushed back). Pulling 53,000 items to a brand-new branch took about 65 seconds in the test.

**Conflict rules.** Stock and finance never conflict, because they are append-only. Master data is merged field by field, last writer wins by Hybrid Logical Clock, with a version check and a conflict note. **Head Office always wins the price-policy fields** (retail rate, tax rate, tax-inclusive). Branch-local fields (reorder level, negative-stock allowance, rack) are never overwritten by a pull. On a branch, creating items and changing prices is refused ("Prices and tax rates are set by Head Office").

**Authentication of devices.**

| Item                   | Detail                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access token           | JWT (HS256), **15 minutes**, claims: device, tenant, branch; checked against the device table on every request (instant revocation)                                                                                                                                                                                                                      |
| Refresh token          | Random, only its **SHA-256 hash** is stored, **rotates on every use**                                                                                                                                                                                                                                                                                    |
| Replay protection      | Presenting an already used refresh token **revokes the device**                                                                                                                                                                                                                                                                                          |
| **Grace window**       | A refresh token replaced **less than 15 seconds ago** (only the newest three retired tokens) is accepted once more and rotated again, so a refresh response lost on the network does not revoke an honest device. Older or other retired tokens still revoke the device. Trade-off: a copied token replayed within 15 seconds of its use is not detected |
| Enrolling a branch     | Head Office creates a one-time enrollment code (80 random bits, hashed, 24 hours, single use); the branch PC trades it for a device and tokens                                                                                                                                                                                                           |
| First Head Office link | A bootstrap code (environment variable on the cloud host), usable once per organisation                                                                                                                                                                                                                                                                  |
| Ids                    | A database that already exists keeps its own tenant, branch and device ids, which the cloud adopts, because its outbox events carry them                                                                                                                                                                                                                 |

**LAN terminal pairing wizard.** A branch terminal needs no data of its own. The first-run wizard:

1. searches the LAN for branch servers (UDP broadcast on port 3211; the server announces name, branch code and port, never secrets),
2. lists them, or accepts a typed address (credentials in the address are refused),
3. asks for the **8-digit pairing code** shown on the server (Settings, "New terminal pairing code": single use, valid 10 minutes, rate limited, stored only as a hash, burned after 5 wrong guesses),
4. pairs, stores the device token sealed with DPAPI, saves the configuration and opens the server's login page.

It shows friendly errors, the exact Windows Firewall commands (TCP 3210 and UDP 3211, limited to the local subnet) with an opt-in elevated button, and an offline page ("cannot reach the branch server") with Retry, Re-pair and Change server. See [lan-terminals.md](lan-terminals.md).

**Failover.** A server epoch number is carried on every push. A standby PC can be promoted manually (CLI), which bumps the epoch and advances document counters past a gap (invoice number gaps after failover are accepted by the owner). A fenced old primary stops pushing and exports its unsent events to a file for review instead of dropping or merging them.

**Offline queue behaviour.** If the network is down the queue simply grows; the status panel (Settings) shows waiting count, oldest waiting age, last success and last error, and "Sync now" wakes the worker. On return, the access token refreshes by itself and everything is delivered exactly once.

**The "12-step" live check.** `pnpm cloud:check <url>` is an end-to-end verification (not an architecture component): it creates a throw-away organisation with invented data and runs 12 checks (health, cloud mode, Head Office link, branch join, same organisation, one-time code, upload, each side receives the other's items and not its own, sales not sent to other branches, token refresh, each sale stored exactly once in the real database), then deletes everything it created. It passed against the real Supabase on 2026-10-04 through the cloud app running on this PC. It can be pointed at a deployed URL. See [cloud-deploy.md](cloud-deploy.md) and [sync.md](sync.md).

---

## 2. Complete feature breakdown

Each feature lists what it does and its current verification status. "Unit/integration tested" means automated tests pass; "packaged-app tested" means the real installed build was driven over HTTP and through its real window.

### 2.1 POS and checkout

**What it does**

- **Keyboard-first counter** with large touch targets. Shortcuts: **F2** customer, **F3** search, **F4** hold invoice, **F5** recall held invoice, **F8** record a missed sale, **F9** exact cash, **F10** save sale, **F12** close shift, **Esc** clear search.
- **Barcode scanning** with a USB keyboard-wedge scanner: digits plus Enter in the search box; an exact barcode match is tried first and the item is added with its stock and batches.
- **Instant search** by name, generic name, code or barcode (about 7 ms on 100,000 items).
- **Batch handling at the till:** first-expiry-first batch allocation, manual batch choice, expired and blocked batches are never sold. Stock is taken out server-side inside the sale transaction; a sale that would take stock below zero is refused unless negative stock is allowed for that item.
- **Units:** sell in strips or tablets (any configured unit); quantities are stored in the smallest unit.
- **Discounts and tax:** per-line and whole-bill discounts; tax per item in basis points, inclusive or exclusive; bill rounding is a branch setting (default **nearest whole rupee**; also nearest 50 paisa or none), applied by the server so no terminal can differ.
- **Limits and overrides:** discount, refund and price-change limits per role. Going beyond a limit, selling below cost, changing a price, voiding or refunding above the limit needs a **manager PIN override**: single use, valid 2 minutes, logged.
- **Payments:** split tender across cash, card, wallet, bank or QR; change only on cash; **sale on account** within the customer's credit limit.
- **Hold and recall:** held invoices are stored on the server so any terminal can resume them.
- **Controlled drugs:** narcotic items require patient, CNIC and doctor and are written to the **narcotic register**.
- **Missed sale** capture (item wanted but not available), which feeds purchasing suggestions.
- **Returns and voids:** partial or full returns with proportional refund and restock or damaged handling; void of an invoice (stock returns to the ledger; the invoice stays in the books and in reports).
- **Idempotent sale saving:** a retried request returns the same sale, never a second one.
- **Shifts:** open with a float, **blind cash count** at close, expected cash = float + cash sales − cash refunds − cash expenses taken from that till, variance.
- **Receipts:** English layout (see 2.1.1).

#### 2.1.1 Thermal printing and cash drawer

- **ESC/POS 80 mm** (48 columns) standard layout; **58 mm** (32 columns) supported. PC858 code page, bold and double height for the total, wrapped item names, right-aligned money (integer paisa), feed and partial cut.
- **RJ11 cash drawer** is kicked through the printer (ESC p pulse, pin 2 or pin 5), when a sale has a cash payment (setting), as part of the same print job when there is one copy.
- **Settings:** printer picked from the Windows printer list, paper width, drawer pin, copies (1 to 3), auto-print, receipt header and footer; **Print test receipt** and **Open cash drawer** buttons use the values on screen before saving.
- **Fallback:** if native printing is unavailable (browser) or fails, the normal print dialog is used; **the sale is always saved first** and a print problem never loses it. Cost and profit are never printed.
- **Urdu on receipts:** not supported (thermal printers need bitmap output); receipts stay English by owner decision.
- **Status:** encoder, desktop print path and settings are unit tested. **Not tested on a physical printer or cash drawer** (none was available).

### 2.2 Inventory and stock management

**Item master**

- Name, generic name, strength, form, category, manufacturer, rack, multiple barcodes, units and packs with conversion (tablet / strip / box), retail price, sales tax and inclusive flag, reorder level, prescription, narcotic and cold-chain flags, allow-negative-stock, active.
- **Scale:** the **Excel / CSV import** loads the whole catalogue: validated on 53,000 rows in 0.3 s and committed in 14 to 24 s (encrypted database). The system is benchmarked on **100,000 items**. The import maps columns by header name (with a manual override), skips rows that already exist (safe to re-import), reports every issue in a downloadable CSV, and can create opening stock batches.
- Units per pack cannot change after creation; edits use optimistic locking.

**Batches, expiry and the ledger**

- Every stock line has a **batch and expiry date**. First-expiry-first selling; **expired batches are never sold**. Batch cost is kept, so profit is computed from the batch cost at the time of sale.
- **Expiry alerts:** near-expiry windows are configurable (default 30 / 60 / 90 / 180 days) and shown as badges on batches and stock; the **Expiry report** lists expired stock and stock expiring in 0-30, 31-60, 61-90 and 91-180 days. (There are no pop-up or push notifications.)
- **Strip / tablet level breakdown:** stock is kept in the smallest unit and displayed per pack, for example "12 Strip + 3 Tablet", in the stock list, in goods receipts and in the stock-take count sheet.
- **Stock list** (server-side paging and search), batches with expiry badges, **stock value** (visible only to roles with the cost right), **adjustments** with reasons (damage, loss, found, expired write-off, internal consumption and so on).
- **Stock ledger integrity check:** recomputes per-batch balances from the ledger and flags negatives or movements pointing at missing batches (also shown in the Transfers reconciliation tab).

**Physical stock take and audits (`/stock-take`)**

- Start a count for everything, one category or one rack. Starting freezes the system quantity per batch. Only one count can be open per branch.
- Counters enter what they find **in packs plus loose units**; the sheet filters all / not counted / differences and shows differences with their value at cost (cost hidden from roles without the right).
- **Posting** needs a separate **approve** right. It writes **only the differences** (counted minus frozen quantity) to the ledger as adjustments, so sales made during the count are not undone. Uncounted batches can be left as they are or treated as not found; a loss larger than what is left on the shelf (sold meanwhile) is limited and reported. Posted counts are immutable; they can be cancelled with a reason before posting.
- Every step is audited.
- **Status:** unit/integration tested, packaged-app tested over HTTP and through the real window.

### 2.3 Purchasing and suppliers

- **Purchase orders:** draft, approved (needs the approve right), partial, received, cancelled (with a reason). Only drafts are edited. **Suggestions** build an order from items at or below their reorder level (target: twice the level) and items customers asked for and did not find in the last 30 days, priced at the latest batch cost. Orders print on A4.
- **Supplier bills (goods receipt / "Add stock"):** supplier, supplier invoice number and date, one row per item with batch, expiry, quantity, **bonus quantity** (lowers the effective batch cost), price per pack, optional MRP. Receiving can be done **against an approved order**, which counts delivered quantities and moves the order to partial or received. Expired stock is refused.
- **Standard tax formula (owner-approved):**

  `Bill total = Goods − Discount + Sales Tax + Advance Tax + Freight`

  **WHT** (withholding tax) is stored separately; **amount payable to the supplier = Bill total − WHT**. A "Fill taxes from branch rates" button pre-fills the tax boxes from the branch's default rates (sales tax and WHT on goods after discount; advance tax on goods after discount plus sales tax). Every value can be edited. The rates are set by the owner in Settings; none are assumed.

- **Supplier payments:** immutable documents, optionally applied to one bill (cannot exceed what that bill still owes) or on account. They do not change a cashier's shift cash.
- **Supplier ledger:** opening balance + bills (payable) − payments − returns, running balance, printable statement, **aging** buckets (not due, 1-30, 31-60, 61-90, over 90 days) from the supplier's credit terms; payments on account settle the oldest amounts first.
- **Purchase returns (returns to supplier):** pick the batch going back, quantity in any unit, reason (damaged, expired, near expiry, wrong item, overstock, recall, other) and the supplier's credit note number. Stock leaves the batch through the ledger and the value **at batch cost becomes a credit on the supplier ledger**. Expired and blocked batches can be returned; a return can never take a batch below zero. Posted returns are immutable.
- **Status:** unit/integration tested and packaged-app tested.

### 2.4 Multi-branch and transfers

- **Branches:** Head Office **HO01 (Karachi)** and Branch **KHI02**; more can be added. A new branch PC joins from the setup screen with a one-time enrollment code created in the Head Office `/branches` screen, then pulls all master data.
- **Head Office centralised pricing control:** only Head Office creates items and sets retail rates and tax rules; branches see these read-only and the server refuses changes. Pulled price fields always follow Head Office.
- **Workflow (`/transfers`)** (CLAUDE.md rule: Head Office to branch):
  1. **Requisition:** a branch asks Head Office for items.
  2. **Approval:** Head Office approves (and may change quantities).
  3. **Transfer note:** batches are picked **first-expiry-first** (editable); expired, blocked or insufficient batches are refused; printable on A4.
  4. **Dispatch:** the quantities leave the Head Office ledger (`transfer_out`); the goods are **in transit**, visible on the document and not in anyone's stock.
  5. **Receiving at the branch**, per line: received, **damaged** and **short**. Only the received quantity enters the branch ledger (`transfer_in`) with the same batch number and expiry; damaged units are written off at receipt; shortages are recorded as a loss at cost. Receiving happens once.
  6. **Closed;** Head Office sees the receipt after sync.
- **Transfers are at cost** (the source batch cost, no inter-branch margin).
- **Inter-branch ledger and reconciliation:** for each branch the system reports value dispatched, received, in transit, and shortage/damage loss at cost, and a reconciliation report (dispatched vs received vs in transit vs loss, per transfer and per item) that adds up to the paisa. The ledger integrity check is shown beside it.
- Posted transfer documents are immutable (triggers); events flow through the cloud and are applied exactly once, tolerant of out-of-order delivery.
- **Status:** the whole cycle is tested on two real SQLite databases through the real sync runner and cloud store; the screens open in the packaged app. **Not yet run on two physical PCs.** See [transfers.md](transfers.md) and [multi-branch.md](multi-branch.md).

### 2.5 Accounts and cash book (`/accounts`)

Basic cash-flow and profit-and-loss accounting (no double entry, no balance sheet; owner decision).

- **Daily expenses:** categories (rent, utilities, salaries and so on; editable; defaults are seeded), expense vouchers numbered `EXP`, payment mode, payee, reference, note. Posted expenses are immutable; a wrong one is **voided with a reason** and stays on record.
- **Till cash deductions:** an expense can be flagged **"taken from my till"** (cash only, dated today, needs the user's open shift). It reduces that shift's expected cash. A till expense cannot be voided once its shift is closed; a **correcting entry** is required instead (owner decision).
- **Cash book:** opening cash, cash in and out (cash sales, refunds, expenses, supplier payments, entries), closing cash, by payment mode, by expense category and day by day. Shift floats are movements between safe and till, not income or expense. Credit sales are not money until paid.
- **Opening balance management:** the cash book starts at **zero**; an **opening entry** (one per branch, not negative) sets the cash already on hand, and **adjustments** add or remove cash (a count that did not match, money the owner puts in or takes out) with a required note. Entries are numbered `CSH`, immutable, voidable with a reason, and permission-controlled (`finance.ledger.create`). An entry dated before the viewed range is part of the opening cash.
- **Profit and loss:** net revenue (excluding tax, net of returns) − cost of goods (batch cost, restocked returns take their cost back) = gross profit; − operating expenses by category = **net profit**. Purchases are stock, not expenses; supplier payables are shown below the line. Cost and profit lines are hidden from roles without the right, also in Excel.
- **Excel and print:** the expenses, cash flow, net profit and all other reports export to **Excel** (`exceljs`: title, filters used, frozen header, money as numbers, totals row) and print (A4 landscape).
- **Reports hub:** 16 reports with date range and filters: sales daily, invoices, sales by item, discounts, sales by cashier, sales by payment method, current stock, stock valuation, low stock, expiry, profit and loss, narcotic register, missed sales, expenses, cash flow, net profit.
- **Status:** unit/integration tested (hand-computed scenarios; cash book reconciled to shift cash) and packaged-app tested. Salaries are plain expenses (no payroll yet). See [accounts.md](accounts.md).

### 2.6 Users, roles and security features

- **12 built-in roles:** Super Admin, HO Admin, Branch Manager, Pharmacist (Senior and Junior), Cashier, Store Keeper, Purchase Officer, Accountant, HR Manager, Auditor (read-only), Quality Control Manager; plus **custom roles**.
- Permissions at `module.resource.action` granularity, **enforced on the server for every route**. Branch-scoped access.
- **Field-level rules:** cost and profit fields are removed from API responses for roles without the right (verified on real cashier responses).
- Sign in with password or **quick PIN** for the counter (PIN sessions lock after 5 idle minutes and cannot reach administration). 5 failed logins lock an account for 15 minutes. A user can be disabled, which signs them out. Temporary passwords force a change.
- **Audit log:** every create, update, void, login and permission change with old and new values, user, branch and time; **tamper-evident hash chain** that can be verified.

### 2.7 Backup and recovery

- **Encrypted backups:** scheduled (rolling retention), manual, and automatic before schema changes or restores. Export to an external drive. Backups are verified and can be **restored on a different PC with the recovery key**. A restore tool ships in the installer.
- Cloud backup of events through sync (backup and essential branch sync only).

### 2.8 Settings

Per-branch settings screen (admin): bill rounding, invoice note, default tax rates (percent, stored as basis points), receipt printer and drawer, cloud sync status and "Connect to cloud", terminal pairing code. Saves are all-or-nothing, validated and audited.

### 2.9 Internationalisation (i18n): English and Urdu with RTL

- **Every screen** is available in **English and Urdu**: POS, sales, items and import, stock, stock take, purchasing, transfers, branches, reports, accounts, users, roles, backups, settings and setup. English is the source text and default.
- **Per-user language** (saved on the user, audited and synced), with a cookie for the login page; switch from the top bar. The document direction switches to **right-to-left** for Urdu.
- **Urdu font:** Noto Nastaliq Urdu (SIL OFL) is **bundled**, so Urdu works with no internet; Nastaliq line heights are handled so glyphs are not clipped.
- **RTL layout:** logical direction classes (start/end) throughout; tables, dialogs and sticky headers adapt; **codes, document numbers, barcodes, dates and money stay Western digits and left-to-right**.
- **Natural Pakistani Urdu** with common shop loan words kept (POS, stock, batch, invoice, barcode, expiry).
- **Tests:** key parity between English and Urdu, placeholder parity, every key used in code exists, and every screen was loaded in Urdu over real HTTP in the packaged-app smoke test (right-to-left, no errors).
- **Not translated by design:** receipts and printed documents (English by owner decision), data values from the database, and server-generated error text (shown in English; client-side messages for common error codes are translated).
- **Not verified:** nobody has reviewed the Urdu layout visually in a browser. See [i18n.md](i18n.md).

---

## 3. Security model

| Area                | Measure                                                                                                                                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data at rest        | SQLCipher AES-256 database; key wrapped with Windows DPAPI; backups encrypted with a key derived from the recovery key                                                                                      |
| Authentication      | argon2 password hashes; signed, HTTP-only session cookies (12-hour sessions); PIN login limited to the counter; lockout after 5 failures                                                                    |
| Authorisation       | RBAC on every API route and page, server-side; a test enforces a literal permission key on every route; UI hiding is cosmetic only                                                                          |
| Field-level privacy | Cost and profit stripped from responses for roles without rights, including Excel exports                                                                                                                   |
| Integrity           | Append-only ledger and immutable posted documents (database triggers); hash-chained audit log; idempotent writes                                                                                            |
| Sync                | Short-lived JWT access tokens; rotating hashed refresh tokens; replay detection with a 15-second grace window; one-time hashed enrollment and pairing codes; rate limits; HTTPS required except to loopback |
| LAN                 | Pairing codes single use, 10 minutes, hashed, burned after 5 wrong guesses; discovery packets carry no secrets; firewall rules limited to the local subnet                                                  |
| Secrets             | `.env` is git-ignored; secrets are never logged; a `.env.example` lists variable names only; the real Supabase URL and JWT secret exist only in `.env` and the cloud host                                   |
| Data hygiene        | Seeds, tests and fixtures use invented data only; reference screenshots with real names are git-ignored                                                                                                     |

---

## 4. Operating the system

### 4.1 Data locations

| What                                          | Where                                                                                                    |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Installed app: database                       | `C:\Users\<user>\AppData\Roaming\Mediescare\data\mediescare.db` (encrypted)                              |
| Installed app: backups, logs, config, secrets | `...\Mediescare\backups\`, `logs\`, `config.json`, sealed key files                                      |
| Development (`pnpm dev`)                      | `apps/web/data/mediescare.db`, backups in `apps/web/backups/`, key from `.env`                           |
| Browser                                       | Only two small cookies: the session (12 hours) and the language. No business data is kept in the browser |

Development and installed data are **separate databases**.

### 4.2 Commands

```
pnpm install                 # once
pnpm dev                     # web dev server, http://localhost:3210 (reads the root .env)
pnpm dev:desktop             # Electron + local server
pnpm package                 # installer: release/Mediescare-Setup-0.1.0.exe
pnpm lint && pnpm typecheck && pnpm test
pnpm verify:packaged         # build, package and run the packaged-app smoke test
pnpm test:e2e                # real-window test against the packaged app
pnpm bench                   # 100,000-item benchmark
pnpm cloud:migrate           # create/update the cloud tables (needs the Session Pooler URL)
pnpm cloud:dev               # the cloud-mode app on this PC (port 3220)
pnpm cloud:check <url>       # live end-to-end check of a cloud endpoint
```

Close `pnpm dev:desktop` before packaging (it locks the build folder).

### 4.3 First run

1. Start the app (installer or `pnpm dev`). Choose **Single PC**, **Branch server** or **Branch terminal**.
2. For a first PC, the setup screen creates the organisation, the first branch (Head Office), the owner account and shows the **recovery key once**. Save it somewhere safe.
3. To add a branch, use Head Office `/branches` to create an enrollment code; on the new PC choose "Join an existing organisation".
4. To use the cloud, link Head Office in Settings, "Connect to cloud" (cloud URL, bootstrap code, organisation name). The first upload runs in the background.

Environment variables are listed in `.env.example` (names only). The cloud host needs `MEDIESCARE_MODE=cloud`, the pooler URL, the JWT secret and the bootstrap code ([cloud-deploy.md](cloud-deploy.md)).

### 4.4 Document numbers

Branch-prefixed sequences so offline branches never collide, for example `KHI02-INV-000123`. Types: `INV` invoice, `RET` sale return, `GRN` goods receipt, `PO` purchase order, `PRT` purchase return, `STK` stock take, `REQ` requisition, `TRF` transfer, `ADJ` stock adjustment, `CSH` cash book entry, `EXP` expense, `PAY` supplier payment, `SHF` shift.

---

## 5. Verification status and known limits

### 5.1 What was verified (2026-10-04)

| Check                               | Result                                                                                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lint, typecheck (6 packages)        | Clean                                                                                                                                                                                                                                                                |
| Unit and integration tests          | core 97, sync 78, db 428, web 270, desktop 55 (928 passing). 28 further db tests are opt-in (live-database contract suite and the 53,000-item scale test)                                                                                                            |
| Packaged-app smoke test             | 198 checks pass against the real packaged app (setup, users, roles, PIN, overrides, items, goods receipt, sales, returns, shifts, purchasing, reports and Excel, import, settings, accounts, cash book, transfers, sync status, pairing codes, every screen in Urdu) |
| Real-window end-to-end (Playwright) | Passes (setup, sale, purchasing, transfers and branches screens, settings, stock take, reports)                                                                                                                                                                      |
| Performance on 100,000 items        | Typed search about 7 ms, barcode 1 ms, stock list page about 170 ms, invoice save about 6 ms (budgets: 100, 100, 300, 300 ms)                                                                                                                                        |
| Real Supabase                       | Cloud tables created with `pnpm cloud:migrate`; the 26-test cloud-store contract suite passes on the real database (throw-away schema); `pnpm cloud:check` passed all 12 steps against the real database through the cloud app running locally                       |

### 5.2 What has not been verified, or is not built

**Not verified on the real thing**

- **Thermal printer and cash drawer:** no physical device was available; code and unit tests only.
- **Vercel deployment:** not done (needs the owner's login; steps in `cloud-deploy.md`). Vercel Hobby is personal and non-commercial; any free Node host that allows commercial use also runs the cloud app.
- **Two physical branch PCs** syncing and transferring stock; the LAN wizard across a real router and the Windows Firewall prompt; the packaged installer's menus.
- **Urdu layout** has not been reviewed visually.
- **Barcode scanner** model compatibility (keyboard-wedge scanners should work; none tested).

**Known limits and not built**

- Terminals still sign in with user sessions; the device token does not yet authenticate terminal requests.
- **Users and roles are not synchronised** between branches (each branch creates its own); racks and customers are local.
- Cloud retention: the free 500 MB database fills in roughly 2 to 6 months for three busy branches; the cleanup plan is documented but not automatic.
- Free-tier behaviour: Supabase pauses an idle free project after about 7 days (the first request may fail and the worker retries); serverless limits (function time and body size) are respected by small batches.
- The installer is **unsigned** (Windows SmartScreen will warn).
- No double-entry accounting, balance sheet, payroll, HR/attendance, customer loyalty or SMS (messaging placeholders only), and no hospital modules (out of scope for this phase).
- Not built yet: standby server replication and "Promote" screens, receipts in Urdu, ZKTeco attendance, barcode label printing, an auto-updater.

### 5.3 Production readiness

The software is functionally complete for a single-branch pharmacy and for the Head Office plus branch scenario in the tests, and its core invariants (stock ledger, immutable documents, audit chain, money arithmetic, offline operation) are enforced by the database and covered by tests. Before relying on it in production the owner should: (1) run a pilot on the real hardware (printer, drawer, scanner), (2) deploy the cloud endpoint and run `pnpm cloud:check` against it, (3) try the branch join and a transfer on two real PCs, (4) store the recovery key safely and test a restore on a second PC, and (5) enable a second protection layer such as BitLocker.

---

## 6. Appendices

### 6.1 Repository layout

```
madiescare/
  CLAUDE.md                  working rules for the project
  docs/                      this file, status documents, ADRs, branding, per-area guides
  apps/
    web/                     Next.js app: UI, API routes, server code, i18n
    desktop/                 Electron: window, menus, printing, discovery, pairing, installer config
  packages/
    core/                    pure domain logic: money, tax, stock rules, numbering, permissions, ESC/POS
    db/                      Drizzle schema (SQLite + Postgres), migrations, services, reports, sync, cloud
    sync/                    outbox contract, clock, backoff, conflict rules, cloud client and adapters
    config/                  shared TypeScript, lint and design tokens
  scripts/                   dev and cloud launchers, verification
```

### 6.2 Further reading

| Topic                                        | Document                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sync design and status                       | [sync.md](sync.md), [adr/0013](adr/0013-cloud-sync-store-and-device-auth.md), [adr/0004](adr/0004-branch-server-failover.md)                                         |
| Cloud setup, deploy and live check           | [cloud-deploy.md](cloud-deploy.md)                                                                                                                                   |
| Multi-branch and transfers                   | [multi-branch.md](multi-branch.md), [transfers.md](transfers.md)                                                                                                     |
| Accounts and cash book                       | [accounts.md](accounts.md)                                                                                                                                           |
| Printing and drawer                          | [printing.md](printing.md)                                                                                                                                           |
| LAN terminals                                | [lan-terminals.md](lan-terminals.md)                                                                                                                                 |
| Urdu and RTL                                 | [i18n.md](i18n.md)                                                                                                                                                   |
| Encryption, money, auth, packaging decisions | [adr/0001](adr/0001-sqlite-encryption.md), [adr/0002](adr/0002-money-scale.md), [adr/0003](adr/0003-auth-approach.md), [adr/0007](adr/0007-packaging-and-runtime.md) |
| Progress history                             | [phase3-status.md](phase3-status.md) to [phase6-status.md](phase6-status.md), [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)                                             |

### 6.3 Glossary

- **Paisa / micro-PKR:** integer money units (1 PKR = 100 paisa; 1 paisa = 10,000 micro-PKR for per-unit rates).
- **Batch:** a received lot of an item with its own batch number, expiry and cost.
- **FEFO:** first-expiry-first-out batch selection.
- **GRN:** goods receipt note (a supplier bill in the system).
- **WHT:** withholding tax, kept separate from the bill total and deducted from what is paid to the supplier.
- **HLC:** Hybrid Logical Clock, used to order changes across devices with imperfect clocks.
- **Outbox:** the queue of changes waiting to be sent to the cloud, written in the same transaction as the change.
- **Epoch:** a number that increases when a standby server is promoted, so an old primary cannot push stale data.
- **Session Pooler:** Supabase's IPv4 connection pooler, required for the free tier from PCs without IPv6.
