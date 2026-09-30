# Mediescare

Offline-first Pharmacy POS and Hospital Management System for Windows. One codebase (TypeScript): Next.js UI and API, Electron desktop shell, encrypted SQLite at each branch, PostgreSQL in the cloud.

Project rules live in [CLAUDE.md](CLAUDE.md). The product brief is [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md). Design documents are in [docs/phase0/](docs/phase0/), decisions in [docs/adr/](docs/adr/), and progress in [docs/phase1-status.md](docs/phase1-status.md) and [docs/phase2-status.md](docs/phase2-status.md).

## What works today

- **Foundation:** encrypted SQLite (SQLCipher, WAL), hash-chained audit log, sync outbox with retry, Drizzle schemas for SQLite and Postgres kept in parity.
- **Safety:** verified encrypted backups (daily, retention, before upgrades, export to a drive), recovery key, restore on a new PC with only the recovery key.
- **People:** users, roles and permissions screens, temporary passwords, quick-PIN counter login, single-use manager PIN approvals, per-role discount, refund and price limits.
- **Pharmacy (Phase 2 slice):** item master with units and barcodes, batches and expiry, append-only stock ledger, goods receipt, stock adjustments, keyboard-first POS (barcode scan, first-expiry-first batches, expired stock blocked, split payments, hold and recall, missed sales, controlled-drug register), shifts with blind cash count, sales list, void and returns, dashboard.
- **Packaging:** Windows installer, a packaged-app smoke test (87 checks), a real-window UI test, and a 100,000-item performance benchmark.

Not built yet: purchase orders and returns, supplier payments and ledgers, reports hub, thermal (ESC/POS) printing, Urdu and i18n, multi-branch transfers, LAN terminals and cloud sync, HR and finance, hospital modules. See the status documents.

## Requirements

- Windows 10/11 (development is on Windows), Node.js 22.12 or newer, pnpm 10 (`corepack enable`).
- No C++ compiler needed: native modules ship prebuilt binaries.

## Commands

```bash
pnpm install
pnpm lint && pnpm typecheck
pnpm test                 # core, sync, db (runs on Electron's Node), web, desktop
pnpm build                # web (Next standalone) + desktop bundle
pnpm dev                  # web dev server on Electron's Node, http://localhost:3210
pnpm dev:desktop          # desktop shell against the built web app
pnpm package              # Windows installer (NSIS) into ./release
pnpm db:generate          # drizzle-kit: SQLite and Postgres migrations
pnpm db:migrate | db:seed # local database (needs MEDIESCARE_DB_KEY, see .env.example)
pnpm bench                # 100,000-item performance benchmark (search, stock list, invoice save)
pnpm verify:packaged      # build, package and run the 87-check packaged-app smoke test
pnpm test:e2e             # real-window UI test against the packaged app (run verify:packaged first)
```

### Why database tests run on Electron's Node

The database driver is a native module. It works in Electron 44 (Node 24) but crashes on some system Node 22.x builds on Windows (found in the Phase 1 spike, see [ADR-0007](docs/adr/0007-packaging-and-runtime.md)). Tests and CLI tools therefore run through `scripts/electron-node.mjs`, the same runtime the shipped app uses. If your shell exports `ELECTRON_RUN_AS_NODE=1` globally, the launch scripts remove it for GUI runs.

## Layout

```
apps/web       Next.js app: UI, route handlers (thin: validate, authorise, one transaction)
apps/desktop   Electron main and preload, server launcher, restore tool, packaging, smoke and UI tests
packages/core  pure domain logic: money, permissions, stock (FEFO, expiry), sales totals, numbering, audit chain
packages/db    Drizzle schemas (sqlite + pg), migrations, encrypted client, auth, backup, catalogue, stock, POS
packages/sync  HLC, UUIDv7, outbox types, backoff, CloudAdapter interface
packages/config brand constants and design tokens
docs/          brief, Phase 0 design, ADRs, status, branding
```

## Data and privacy

`docs/hcloud_screenshots.pdf` contains real names and phone numbers and is git-ignored. Seeds, tests and E2E data use invented values only. Never commit `.env`, database files or backups.
