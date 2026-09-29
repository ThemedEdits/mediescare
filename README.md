# Mediescare

Offline-first Pharmacy POS and Hospital Management System for Windows. One codebase (TypeScript): Next.js UI and API, Electron desktop shell, encrypted SQLite at each branch, PostgreSQL in the cloud.

Project rules live in [CLAUDE.md](CLAUDE.md). The product brief is [docs/MASTER_PROMPT.md](docs/MASTER_PROMPT.md). Phase 0 design documents are in [docs/phase0/](docs/phase0/) and decisions in [docs/adr/](docs/adr/).

## Status

Phase 1 (foundation) is in progress. What works today:

- Monorepo with `core`, `sync`, `db`, `config` packages, the web app and the desktop shell.
- Encrypted SQLite (SQLCipher, WAL), Drizzle schemas for SQLite and Postgres with a parity test.
- First-run setup, argon2id login with lockout, revocable sessions, RBAC with the default roles, field-level cost/profit hiding.
- Hash-chained audit log (append-only, database triggers), sync outbox and push worker with retry and backoff.
- Electron shell: first-run mode wizard, local server launcher, OS-protected secrets, locked-down window.
- Windows package and a packaged-app smoke test.

Not built yet: items, POS, purchasing (Phase 2), LAN terminals and cloud sync (Phase 3), i18n/Urdu, backup and restore, roles/users screens. See [docs/phase0/phase1-plan.md](docs/phase0/phase1-plan.md).

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
```

Packaged-app smoke test (launches the real app with a throwaway data folder):

```bash
pnpm --filter @mediescare/desktop package:dir
pnpm --filter @mediescare/desktop smoke
```

### Why database tests run on Electron's Node

The database driver is a native module. It works in Electron 44 (Node 24) but crashes on some system Node 22.x builds on Windows (found in the Phase 1 spike, see [ADR-0007](docs/adr/0007-packaging-and-runtime.md)). Tests and CLI tools therefore run through `scripts/electron-node.mjs`, the same runtime the shipped app uses. If your shell exports `ELECTRON_RUN_AS_NODE=1` globally, the launch scripts remove it for GUI runs.

## Layout

```
apps/web       Next.js app: UI, route handlers (thin: validate, authorise, one transaction)
apps/desktop   Electron main and preload, server launcher, packaging, smoke test
packages/core  pure domain logic: money, permissions, document numbers, audit hash chain
packages/db    Drizzle schemas (sqlite + pg), migrations, encrypted client, auth, audit, outbox
packages/sync  HLC, UUIDv7, outbox types, backoff, CloudAdapter interface
packages/config brand constants and design tokens
docs/          brief, Phase 0 design, ADRs, branding
```

## Data and privacy

`docs/hcloud_screenshots.pdf` contains real names and phone numbers and is git-ignored. Seeds, tests and E2E data use invented values only. Never commit `.env`, database files or backups.
