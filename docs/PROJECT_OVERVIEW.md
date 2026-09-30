# Mediescare: what is built, where data lives, and how offline and cloud sync work

Last updated 2026-09-30. Plain-language summary of the whole project today. Details per area are in `docs/phase3-status.md`, `docs/phase4-status.md`, `docs/sync.md`, `docs/printing.md` and `docs/i18n.md`.

---

## 1. What Mediescare is

An installable Windows desktop program for a pharmacy: point of sale (POS), stock, purchasing, reports. It is built to work **with no internet at all**, and later to grow into a hospital system.

## 2. Technology used

| Part                         | What is used                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Desktop shell                | Electron (the window and the installer)                                                                              |
| App (screens + server)       | Next.js 16 + React + TypeScript + Tailwind CSS                                                                       |
| **Local database**           | **SQLite, encrypted with SQLCipher**, through `better-sqlite3` and Drizzle ORM                                       |
| **Cloud database (planned)** | PostgreSQL (Supabase or any other host), same tables, through Drizzle                                                |
| Login                        | Own system: argon2 password hashes, signed session cookie, quick PIN for the counter. **No internet login service.** |
| Excel                        | `exceljs`                                                                                                            |
| Tests                        | Vitest, Playwright (real-window tests)                                                                               |

The app has two parts running on the same PC: the **window** (Electron) and a small **local web server** (Next.js) that the window talks to. The server owns the database.

---

## 3. WHERE IS THE DATA STORED? (the important part)

### 3.1 Packaged app (the installed Mediescare.exe), running offline or online

Everything is saved **on the PC, in an encrypted database file**:

| What                            | Where                                                                     |
| ------------------------------- | ------------------------------------------------------------------------- |
| **Main database**               | `C:\Users\<your user>\AppData\Roaming\Mediescare\data\mediescare.db`      |
| Automatic and manual backups    | `C:\Users\<your user>\AppData\Roaming\Mediescare\backups\`                |
| Encryption keys and app secrets | `C:\Users\<your user>\AppData\Roaming\Mediescare\` (protected by Windows) |
| App mode and port               | `...\Mediescare\config.json`                                              |
| Logs                            | `...\Mediescare\logs\`                                                    |

- The database is encrypted. Opening the file with a normal SQLite viewer shows nothing readable.
- **The recovery key** shown once at setup is the only way to open a backup on a different PC. Keep it safe.
- Nothing is sent to the internet. No internet is needed to install, sign in, sell, print or restore.

### 3.2 Running in the browser (`pnpm dev`, http://localhost:3210)

This is the **development mode**. The data is still **not in the browser**.

| What         | Where                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| Database     | `apps/web/data/mediescare.db` inside the project folder (same encrypted SQLite) |
| Backups      | `apps/web/backups/`                                                             |
| Database key | `MEDIESCARE_DB_KEY` in the project's `.env` file                                |

What the browser itself keeps: only two small cookies, **the login session** (`mediescare_session`, 12 hours, not readable by scripts) and **the language choice** (`mediescare_lang`). No sales, items or customer data are saved in the browser (no localStorage, no IndexedDB).

Consequences:

- If you clear browser data, nothing is lost except being signed out.
- Dev data and packaged-app data are **two different databases**. Items created in `pnpm dev` do not appear in the installed app.
- A second browser or another PC can open the same server address and will see the same data, because the data lives on the server PC, not in the browser.

---

## 4. Does it work offline and sync to the cloud later?

### Offline: YES, fully built

- The local database is the main database. The POS never waits for the internet.
- Every change (sale, stock receipt, price, setting...) is also written into a **sync queue (outbox)** in the same database transaction, so nothing can be saved without being queued for sync.

### Sync to the cloud when internet returns: the FOUNDATION is built, the CLOUD END is NOT finished

Built and tested (against an in-memory test cloud):

- Background worker that sends the queue when internet is available, retries with waiting time, never slows the counter.
- Safe against duplicates, out-of-order delivery, partial failures, clock mistakes.
- "Sync now" button and status (waiting, last success, errors) in **Settings**.
- Rules for conflicts (Head Office wins price and tax fields), failover numbering, LAN pairing codes for terminals.

**Not built yet, so be clear about it:**

- The **PostgreSQL / Supabase cloud store does not exist yet** (the cloud endpoint answers "not implemented" on purpose, so it cannot pretend to sync).
- Data pulled from the cloud is not yet applied to the local database.
- First-time full upload of an existing branch (initial sync) is not built.
- Sync is **off by default**. It only starts when `MEDIESCARE_CLOUD_URL` and a device token are configured.

So today: **your data is safe on the PC and queued; it does not reach a cloud database yet.** The next step for real cloud sync is the Postgres cloud store, device token issue and refresh, and applying pulled changes.

---

## 5. Features built so far

**Start and security**

- First-run setup (owner account, recovery key), sign in with password, quick PIN for the counter
- Users and roles (12 built-in roles, custom roles), permissions checked on the server for every action
- Manager PIN override for big discounts, price changes, below-cost sales, refunds
- Audit log for every change (tamper-evident chain)
- Backup and restore (encrypted), recovery key, restore on a new PC

**Items and stock**

- Item master: generic name, barcodes, packs (strip/box/tablet), prescription, narcotic, cold-chain flags, reorder level, tax
- **Excel / CSV import** of the whole item list (tested on 53,000 rows in about 20 seconds)
- Batches with expiry; expired batches are never sold; first-expiry-first selling
- Stock is a ledger (append-only), so the count can always be explained
- Stock list, adjustments with reasons, **stock take** (physical count and reconciliation)

**POS (counter)**

- Barcode scan, fast search (under 10 ms on 100,000 items), keyboard shortcuts
- Discounts, tax, split payments, sale on account, hold and recall bills
- Whole-rupee rounding by default (changeable in Settings)
- Returns and voids, narcotic register, missed-sale capture
- Shifts: open with float, blind cash count at close
- **Thermal receipt printing (ESC/POS) and cash drawer kick** (not yet tested on a real printer)

**Purchasing**

- Purchase orders (draft, approve, partial receive, cancel), suggestions from low stock
- Goods receipt / supplier bills (Goods - Discount + Sales Tax + Advance Tax + Freight, WHT separate)
- Supplier payments and supplier ledger with aging
- **Returns to suppliers** with credit on the ledger

**Reports** (13): daily sales, invoices, by item, discounts, by cashier, by payment method, stock, valuation, low stock, expiry, profit and loss, narcotic register, missed sales. Print and Excel export. Cost and profit hidden from roles without the right.

**Settings**: rounding, invoice note, tax defaults, receipt printer, sync status, terminal pairing code.

**Languages**: English and Urdu foundation with right-to-left layout and offline Urdu font. Only the menu, top bar, login and dashboard are translated so far.

---

## 6. Not built yet

- Real cloud database sync end to end (see section 4)
- Multiple branches working together, Head Office to branch transfers, LAN terminals wizard
- Urdu on most screens and on printed receipts
- Accounts (double entry), HR, payroll, expenses
- Hospital modules (patients, doctors, lab...)
- Purchase-tax treatment beyond what is built (owner confirmed the current formula)
- Testing with a real thermal printer and cash drawer

## 7. How to run

- Development (browser): `pnpm install`, then `pnpm dev`, open http://localhost:3210
- Development (desktop window): `pnpm dev:desktop`
- Installer: `pnpm package` creates `release/Mediescare-Setup-0.1.0.exe`
- All checks: `pnpm lint && pnpm typecheck && pnpm test`, `pnpm verify:packaged`, `pnpm test:e2e`, `pnpm bench`

Do not run `pnpm dev:desktop` while packaging: it locks the build folder.
