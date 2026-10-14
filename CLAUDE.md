# CLAUDE.md — Mediescare (Pharmacy POS + Hospital Management System)

Read this file fully at the start of every session. It is the single source of truth for how to work in this repo.

## 0. Project in one paragraph

**Mediescare** is an installable **desktop** Pharmacy Management + POS system that grows into a full **Hospital Management System (HMS)**. It must work **100% offline** with a **local database**, support **multiple simultaneous users per branch**, **multiple branches** (Head Office main store supplies branches), and **sync to a cloud database** when internet is available. The owner currently uses **HCloud (hcloud.pk)**; Mediescare must match every feature of it and go beyond.

Business is a Karachi-based pharmacy chain. Users speak Roman Urdu / English mix. Currency **PKR**. Tax fields include Sales Tax, Advance Tax, and WHT.

## 1. Reference documents (read before coding)

- `docs/MASTER_PROMPT.md` — full product brief (features, roles, sync, phases). Section **5A** is the screen-by-screen spec of HCloud. Treat as the requirements.
- `docs/hcloud_screenshots.pdf` — reference screenshots (contains real customer/staff names: never copy real names, phones, or emails into code, seeds, tests, or commits; use fake data).
- `docs/branding/` — logo and icon files from the ZIP. Colors must be **sampled from the logo**.
- `docs/adr/` — architecture decision records. Write one for every significant decision.

If code and docs disagree, stop and ask. If a requirement is unclear or missing, ask (one short, prioritized list), do not guess on money, stock, tax, or sync behavior.

## 2. Language and communication

- Talk to the user in the language they write (Roman Urdu or English). Keep replies short and practical.
- **All code, comments, commit messages, docs, and UI keys are in English.** UI text is bilingual (English + Urdu) via i18n.
- Before big work, give a short plan. After work, give: what changed, how to run/test it, what is left.
- Never say something works unless you ran it. Report failures honestly.

## 3. Tech stack (fixed, do not swap without an ADR and my approval)

Speed is the priority, so use one language (TypeScript) and one main framework.

| Layer            | Choice                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App framework    | **Next.js (App Router)** + **TypeScript (strict)**, latest stable at scaffold time; `output: "standalone"`                                                          |
| UI               | **Tailwind CSS** + **shadcn/ui** (Radix), **lucide-react** icons, **TanStack Table** (data grids), **TanStack Query** (client cache)                                |
| Forms/validation | **React Hook Form** + **Zod** (shared schemas client/server)                                                                                                        |
| i18n             | **next-intl** (or i18next) for English/Urdu, RTL for Urdu, Urdu font (Noto Nastaliq Urdu)                                                                           |
| Desktop shell    | **Electron** + **electron-builder** (Windows NSIS installer primary; mac/linux optional), auto-updater                                                              |
| Local DB         | **SQLite** (WAL mode) via **better-sqlite3** + **Drizzle ORM** + drizzle-kit migrations; encrypt at rest (SQLCipher build or OS-level, decide in ADR)               |
| Cloud DB         | **PostgreSQL** (Supabase / Neon / VPS, provider must be swappable) via Drizzle                                                                                      |
| Auth             | Custom, offline-capable: **argon2** password hashing, signed session cookies (**jose**), PIN login for POS, optional TOTP 2FA. No auth provider that needs internet |
| Realtime (LAN)   | Server-Sent Events or WebSocket from the branch server so terminals see stock/hold-invoice changes live                                                             |
| Printing         | ESC/POS thermal (58/80 mm) via node lib in Electron main; A4/A5 PDF via `@react-pdf/renderer` or headless print; barcode labels                                     |
| Charts           | Recharts (or Tremor)                                                                                                                                                |
| Exports          | `exceljs` (Excel), PDF via print pipeline                                                                                                                           |
| Testing          | **Vitest** (unit/integration), **Playwright** (E2E, incl. Electron), sync chaos tests                                                                               |
| Tooling          | **pnpm** workspaces + **Turborepo**, ESLint, Prettier, Husky + lint-staged, Conventional Commits                                                                    |

Rules for the stack:

- Do **not** add Prisma, Redux, NextAuth/Clerk/Supabase-Auth, Firebase, or any service that breaks offline mode.
- Before adding any dependency: check it works offline, is maintained, and has a Windows build. Prefer fewer dependencies.
- Native modules (better-sqlite3, serial/USB printer libs) must be rebuilt for Electron (`electron-rebuild` / electron-builder `npmRebuild`). Always test the **packaged** installer, not only `dev`.
- Verify current versions and APIs from official docs when scaffolding; do not rely on memory for Next.js/Electron config.

## 4. Architecture (offline-first, multi-user, multi-branch)

### 4.1 One codebase, several runtime modes

The same Next.js app runs in different modes, selected by `MEDIESCARE_MODE`:

- `single` — one PC runs Electron + embedded Next.js server + SQLite (small branch).
- `branch-server` — Electron starts the Next.js standalone server on a fixed port, bound to LAN (`0.0.0.0`), owns the branch SQLite DB and the sync worker.
- `terminal` — Electron window that connects to the branch server over LAN (auto-discovery via mDNS/UDP broadcast, or manual IP). Holds no primary data.
- `cloud` — the same app deployed on a server with Postgres for head-office/super-admin consolidated analytics and sync endpoints.

Installer first-run wizard asks: Single PC / Branch Server / Branch Terminal, then activation and branch binding. Windows firewall rule for the branch server port must be handled/explained.

### 4.2 Repository layout

```
mediescare/
  CLAUDE.md
  docs/                     # MASTER_PROMPT.md, adr/, branding/, api/, user-manuals/
  apps/
    web/                    # Next.js app (UI + route handlers + server actions)
      src/app/              # App Router: (auth), (app)/pharmacy, (app)/accounts, (app)/hr, (app)/hospital ...
      src/features/         # feature modules (pos, items, purchasing, inventory, reports, users, ...)
      src/components/       # shared UI (shadcn wrappers)
      src/i18n/             # en.json, ur.json
    desktop/                # Electron main/preload, updater, printing, discovery, server launcher
  packages/
    db/                     # Drizzle schema (sqlite + pg), migrations, seeds, parity tests
    core/                   # PURE domain logic: money, stock ledger, pricing, tax, doc numbering, permissions
    sync/                   # outbox, pull/push, HLC, conflict rules, cloud adapter
    config/                 # tsconfig, eslint, tailwind tokens
```

- Business rules live in `packages/core` (pure, heavily unit-tested), never inside React components or route handlers.
- Route handlers / server actions are thin: validate (Zod) → authorize (RBAC) → call core/db in a **transaction** → write audit + outbox → respond.
- Keep SQLite and Postgres schemas in parity: a test must fail if a table/column exists in one and not the other.

### 4.3 Data and sync rules (non-negotiable)

1. **IDs:** UUIDv7/ULID primary keys everywhere. No auto-increment IDs.
2. **Timestamps:** store UTC; use a **Hybrid Logical Clock** for ordering synced records. Tolerate device clock skew.
3. **Outbox:** every write also appends to `sync_outbox` in the **same transaction**. Push is idempotent and retried with backoff. Pull uses per-entity cursors. Provide initial-sync, delta-sync, and resync/repair tools.
4. **Stock is a ledger, not a number.** Stock = sum of append-only `stock_movements` (purchase, sale, sale-return, purchase-return, transfer-out, transfer-in, adjustment, expiry-writeoff, consume, opening). Sync movements, recompute balances. Never overwrite a quantity.
5. **Posted financial documents are immutable** (invoices, payments, vouchers, GRNs, transfers). Fix mistakes with reversal / return / credit note documents. "Deleted invoices" are soft-voided with reason, user, time, and remain in reports.
6. **Document numbers** are branch-prefixed sequences (e.g., `KHI01-INV-000123`) so offline branches never collide. Human-friendly numbers are separate from IDs.
7. **Money:** never use floats. Store integer minor units (paisa); per-unit cost/rate that needs sub-paisa precision uses a higher fixed scale defined once in `packages/core/money` (document it in an ADR). Rounding rules are centralized and tested.
8. **Conflicts:** master data = last-writer-wins with version check + audit; Head Office wins on price-policy fields; stock/finance never conflict because they are append-only.
9. **Head Office → branch flow:** Purchase at HO main store → requisition/indent → approve → transfer note (batch/expiry picking, FEFO) → dispatch (in-transit ledger) → receive (partial/shortage/damage handling) → close. Transfers at cost or configured transfer price with inter-branch accounting.
10. **Backups:** scheduled encrypted local backups with rolling retention, one-click restore, external-drive export, plus cloud backup.
11. Every offline feature must work with zero internet. The POS must **never** await the network.

### 4.4 Multi-user on one branch

- All terminals talk to the branch server (SQLite WAL, single writer process, short transactions, `busy_timeout` set). Use optimistic locking (`version` column) on editable master data.
- Stock deduction at POS happens server-side inside the sale transaction (FEFO batch allocation); reject the sale if stock is insufficient, unless negative-stock is explicitly enabled for that item/branch.
- Hold invoices and open carts are stored server-side so any terminal can resume them.

## 5. Roles, permissions, branches

- Roles: Super Admin, HO Admin, Branch Manager, Pharmacist (Sr/Jr), Cashier, Store Keeper, Purchase Officer, Accountant, HR Manager, Auditor (read-only), Quality Control Manager, plus custom roles (hospital roles later: Doctor, Nurse, Receptionist, Lab Tech, etc.).
- **RBAC at `module.resource.action` granularity** (view/create/edit/delete/approve/print/export/override-price/discount/void/refund/backdate/view-cost/view-profit), enforced **server-side on every route/action**. UI hiding is only cosmetic.
- Branch-scoped access: a user can access one, some, or all branches. **Super Admin** can log into every branch, switch branch context instantly, view **All Branches** consolidated or any single branch (all analytics + financials), and manage all users/roles across branches.
- Discount/refund/price-override limits per role; exceeding a limit requires a **manager PIN override** (logged).
- Field-level rules (e.g., cashier cannot see purchase cost or profit).
- Audit log for every create/update/delete/void/login/permission change with old and new values, user, device, branch, time. Tamper-evident (hash chain).
- Shifts are **configurable** (not hard-coded to two). Support cashier shift open/close with float, blind cash count, X/Z reports, roster/rotation, attendance, payroll, leave, expenses, petty cash.

## 6. Domain conventions (pharmacy)

- Item master supports pharma **and** general retail; fields per MASTER_PROMPT §5.1 and §5A.4 (generic name, salt, barcode(s), stocking unit + conversion unit, reorder level, rack, narcotic flag, prescription flag, cold-chain flag, dead-item flag, tags).
- **Batch + expiry on every stock line.** FEFO by default. **Block sale of expired batches.** Warn on near-expiry (30/60/90/180 days, configurable).
- Multi-UOM selling (pack/strip/loose tablet) with conversion; stock is kept in the smallest unit.
- Controlled/narcotic sales require doctor + patient + CNIC capture and feed the Narcotic register.
- **Missed Sale** capture (item wanted but not available) feeds Low Stock / purchase suggestions.
- Profit is computed from **batch cost** at time of sale. Bill-level profit/loss is visible only to permitted roles.
- Purchases capture Sales Tax, Advance Tax, WHT, discount, bonus qty, loose qty, supplier invoice no./date, attachments.
- Report requirements: every report in MASTER_PROMPT §5A.6–5A.7 must exist, with date range, filters, Excel export, print, and column customization.

## 7. UI / UX and branding

- **Colors:** primary + secondary sampled from the logo files (measure pixels, do not guess). Put them in Tailwind theme tokens / CSS variables (`--color-primary`, `--color-secondary`, tints, hover/active/disabled). **Background is white**; light neutral surfaces; dark neutral text.
- Use the supplied logo/icon in: window/taskbar icon, installer, login, sidebar, receipts, invoices, reports, PDF exports. Generate `.ico/.icns/.png` sets from the supplied files.
- Product name everywhere: **Mediescare**.
- **Keyboard-first POS:** F-key shortcuts, barcode-wedge scanning, instant item search (<100 ms on 100k+ SKUs using SQLite FTS5), hold/recall, large touch targets. POS screen layout follows §5A.3.
- Data grids: server-side pagination/filter/sort, column customization, sticky headers, Excel/Print buttons, empty/loading/error states.
- Personalization: per-user "Priority Modules" (4 pinned nav items, rest under More).
- Accessible, responsive down to small POS screens; consistent components; no dark mode required (optional).
- Urdu: full RTL support, correct fonts on screen and on printed receipts.

## 8. Coding standards

- TypeScript `strict`, no `any` without a comment explaining why. Zod schemas are the source of truth for input/output types.
- Small feature-based modules. No giant files (>400 lines is a smell). No dead code, no TODO placeholders in delivered features.
- Server code never trusts the client. Validate every input, authorize every action, wrap multi-step writes in one DB transaction.
- Never log secrets or PII. Never commit `.env`, DB files, or real data. Provide `.env.example`.
- Migrations are forward-only, reviewed, and tested on a copy of realistic data (50k+ items). Every migration works for both SQLite and Postgres where applicable.
- Naming: `snake_case` DB columns, `camelCase` TS, `PascalCase` components, kebab-case files.
- Conventional Commits (`feat:`, `fix:`, `chore:`...). Small, focused commits. One logical change per PR/branch.

## 9. Testing (required, not optional)

- **Unit tests** in `packages/core` for: money/rounding, tax/WHT, discount, FEFO batch allocation, unit conversion, stock ledger, profit calc, document numbering, permissions.
- **Integration tests** for: sale → stock deduction → ledger → outbox; return; purchase/GRN; transfer HO→branch (dispatch/receive/shortage); shift close.
- **Sync tests:** offline for days, duplicate pushes, out-of-order delivery, clock skew, two branches editing the same master item, partial network failure, resync/repair.
- **E2E (Playwright):** login → open shift → sale with split payment → print → return → close shift → report totals match. Run also against the **packaged** Electron build before each release.
- Performance budgets: POS search <100 ms, invoice save <300 ms, cold start <5 s on a 4 GB RAM Windows 10/11 machine. Add a benchmark script with a 100k-SKU seed.
- A change is **not done** until: typecheck, lint, unit + integration tests pass, and the affected flow was exercised end-to-end.

## 10. Commands (create/keep these working; update here if they change)

```
pnpm install
pnpm dev                 # Next.js dev server (web)
pnpm dev:desktop         # Electron + Next.js dev
pnpm build               # build web (standalone) + desktop
pnpm package             # electron-builder installer (Windows)
pnpm db:generate         # drizzle-kit generate (sqlite + pg)
pnpm db:migrate          # apply migrations to local sqlite
pnpm db:seed             # fake demo data (100k SKUs option)
pnpm test                # vitest
pnpm test:e2e            # playwright
pnpm lint && pnpm typecheck
pnpm bench               # 100k-SKU benchmark (search, stock list, invoice save)
pnpm verify:packaged     # build + package + packaged-app smoke test
pnpm --filter @mediescare/desktop release   # CI only: build installer + publish GitHub Release (auto-update feed, docs/updates.md)
```

## 11. How to work (process)

1. **Phase 0 first:** produce the feature matrix (HCloud → Mediescare → improvement), ER diagram, module map, permission matrix, sync design, UI style guide from the logo. Ask blocking questions. **Wait for my approval before Phase 1.**
2. Then follow the phases in `docs/MASTER_PROMPT.md` §9. Ship a **runnable vertical slice per phase** with a short demo script. Priority order: foundation → Pharmacy core + POS → multi-branch/sync → users/HR/finance → hospital modules → hardening.
3. Build **vertical slices** (DB → core logic → API → UI → tests), not layers. Get POS selling end-to-end early, then widen.
4. For every feature, check MASTER_PROMPT §5A for the exact fields/columns/filters/buttons of the HCloud screen it replaces.
5. Use seed data with **fake** names. Include a realistic seed (50k+ items, 3 branches, multiple users) to test performance.
6. Keep `docs/` updated as you go: ADRs, schema diagram, sync protocol, user manual per role, installer/backup guide.
7. When blocked or unsure about money/stock/tax/sync/security behavior: stop and ask. Otherwise proceed without asking permission for routine decisions.

## 12. Do NOT

- Do not use floats for money, or store stock as an editable number.
- Do not let any POS/inventory feature depend on internet access.
- Do not edit or delete posted financial documents; use reversals.
- Do not hard-code shifts, branches, tax rates, categories, or currency.
- Do not lock features behind quotas/paywalls (HCloud's SMS-quota suspension is a known pain point). Messaging uses my own gateway/credentials, queues when offline, and never blocks core operations.
- Do not put real customer/staff data from the screenshots into the repo.
- Do not skip the packaged-installer test, the sync tests, or the audit log "because it's just a small change".
- Do not deviate from the fixed stack without an ADR and my approval.

## 13. Open questions to settle in Phase 0 (ask me)

- Number of branches and terminals per branch; which PC acts as Branch Server; is a spare/failover server needed?
- Cloud provider preference (Supabase / Neon / own VPS) and budget.
- Accounting depth (simple cash/P&L vs full double-entry) for Phase 4.
- Tax/fiscal integration needs (FBR / provincial sales-tax POS integration).
- Hardware: thermal printer models, barcode scanners, cash drawer, biometric attendance device.
- Licensing model (single owner vs reselling Mediescare to other pharmacies later).
- Exact spelling of the product name (currently **Mediescare**) and confirmation that logo files are final.
