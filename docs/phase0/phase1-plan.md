# Phase 1 plan: Foundation

Status: **Draft. Do not start until Phase 0 is approved and questions 1-6 in [open-questions.md](open-questions.md) are answered.**

**Goal:** a runnable, installable skeleton that proves the risky parts: Next.js inside Electron, SQLite with encryption, LAN terminal to server, login and RBAC, audit log, outbox, backup and restore, and a **packaged Windows installer** that runs on a clean machine.

**Not in Phase 1:** items, batches, POS, purchasing, transfers, reports (Phase 2 and later). The sync engine is a skeleton (outbox writes and a push loop against a mock cloud).

## Demo script (what "done" looks like)

1. Install `Mediescare-Setup.exe` on a clean Windows 10/11 VM. Wizard: choose **Branch Server**, create Super Admin, set branch `KHI01`.
2. Login screen shows the logo, English/Urdu toggle switches to RTL.
3. Create a Cashier and a Branch Manager, assign roles. Cashier cannot open Users. Manager can.
4. Install on a second PC as **Terminal**, discover the server, pair with the code, log in as the cashier with a PIN.
5. Change a setting on the terminal, see it on the server. Audit log shows the change with old and new values. Verify-chain reports OK.
6. Unplug the internet: nothing changes. Outbox count rises. "Sync now" against the mock cloud drains it.
7. Take a backup, wipe the DB, restore, and the audit chain still verifies.
8. Kill the server PC: the terminal shows "Branch server offline" and recovers by itself when the server returns.

## Task list and estimates

Estimates are **working days for one experienced full-stack developer with Claude Code assistance**, including tests. They assume Phase 0 answers arrive. Total is the sum, with contingency shown separately.

### A. Repository and tooling (3.5 d)

| # | Task | Days |
|---|---|---|
| A1 | pnpm workspace + Turborepo, `apps/web`, `apps/desktop`, `packages/{core,db,sync,config}`, TS strict, path aliases | 0.5 |
| A2 | ESLint, Prettier, Husky + lint-staged, Conventional Commits check, `.env.example`, `.gitignore` (excludes PDF, DB files) | 0.5 |
| A3 | Vitest setup across packages, Playwright setup, CI script (`pnpm lint && typecheck && test`), GitHub Actions on Windows | 1.0 |
| A4 | Verify current Next.js, Electron, better-sqlite3, Drizzle versions from official docs, write ADR-0007 (packaging) | 0.5 |
| A5 | Commands from CLAUDE.md §10 all wired (`dev`, `dev:desktop`, `build`, `package`, `db:*`, `test`, `test:e2e`) | 1.0 |

### B. Branding and design system (3.0 d)

| # | Task | Days |
|---|---|---|
| B1 | Tokens from [style-guide.md](style-guide.md) into `packages/config` Tailwind preset + CSS variables, raw-hex lint rule | 0.5 |
| B2 | Generate `.ico/.icns/.png` sets, mono and white logo variants from the SVGs | 0.5 |
| B3 | shadcn/ui setup with our tokens, base components (Button, Input, Select, Modal, Toast, Tabs, Badge, DataGrid shell) | 1.0 |
| B4 | App shell: top bar, Priority Modules nav, branch switcher, sync chip, footer, empty/loading/error patterns | 1.0 |

### C. i18n and RTL (2.0 d)

| # | Task | Days |
|---|---|---|
| C1 | next-intl with `en.json`/`ur.json`, per-user language, RTL via logical properties, Inter + Noto Nastaliq bundled locally | 1.0 |
| C2 | Urdu rendering checks in grids and forms, lint rule for missing keys, screenshots test in both directions | 1.0 |

### D. Database layer (5.0 d)

| # | Task | Days |
|---|---|---|
| D1 | Decide and implement SQLite encryption (ADR-0001), spike SQLCipher build for Electron on Windows | 1.5 |
| D2 | Drizzle schemas for Phase 1 tables (tenants, branches, stores, devices, users, roles, permissions, role_permissions, user_roles, user_branches, sessions, override_events, settings, feature_flags, audit_log, sync_outbox, sync_cursors, sync_inbox_seen, doc_counters, backups) for **SQLite and Postgres** | 1.5 |
| D3 | Migrations (forward only), `db:generate`, `db:migrate`, runner on app start with a backup taken first | 0.5 |
| D4 | **Schema parity test** (fails if a table/column differs) and immutability triggers | 0.5 |
| D5 | UUIDv7 generator, HLC implementation + unit tests (skew, ordering, counter overflow) in `packages/sync` | 1.0 |

### E. Core domain package (3.0 d)

| # | Task | Days |
|---|---|---|
| E1 | `money`: integer paisa, unit-rate scale, rounding, formatting, parsing (ADR-0002), heavy unit tests | 1.0 |
| E2 | `permissions`: catalogue, role defaults from [permissions-matrix.md](permissions-matrix.md), check function, branch scope, field rules, matrix test | 1.0 |
| E3 | `numbering`: branch-prefixed document numbers, counters, block reservation, tests | 0.5 |
| E4 | `audit`: canonical serialisation and hash chain, verify function, tests | 0.5 |

### F. Auth and RBAC (5.0 d)

| # | Task | Days |
|---|---|---|
| F1 | argon2id hashing (native module rebuilt for Electron, Windows prebuild check), password policy, breached list offline | 1.0 |
| F2 | Sessions: signed cookies (jose), server-side revocation, idle timeout, lock screen | 1.0 |
| F3 | PIN login for POS, lockout, device binding | 0.5 |
| F4 | TOTP 2FA (enrol, verify, recovery codes) | 0.5 |
| F5 | Server guard: `withAuth({permission, branchScope})` wrapper for route handlers and server actions, lint rule that every handler declares a permission | 1.0 |
| F6 | Manager PIN override service (single-use, expiring, limits), tests | 1.0 |

### G. Admin screens (5.0 d)

| # | Task | Days |
|---|---|---|
| G1 | Login, first-run Super Admin creation, change password, User Settings | 0.5 |
| G2 | Users: list by role tabs, search, add/edit, active toggle, last sign-in, force logout, reset password | 1.5 |
| G3 | Roles: catalogue, edit permissions, discount/refund/override limits, custom roles | 1.0 |
| G4 | Branches and stores, devices list (revoke), branch profile (name, licence, NTN, address) | 1.0 |
| G5 | Settings framework (tenant/branch scope), tax classes stub, feature flags per branch | 0.5 |
| G6 | Audit log screen (filters, old/new diff, verify-chain button, export) | 0.5 |

### H. Electron shell and runtime modes (6.0 d)

| # | Task | Days |
|---|---|---|
| H1 | Electron main/preload, secure defaults (contextIsolation, no nodeIntegration, CSP), window state, single-instance lock | 1.0 |
| H2 | Launch Next.js standalone as a child process, health-check, port selection, clean shutdown, crash restart, logs | 1.5 |
| H3 | Runtime modes `single`, `branch-server`, `terminal`, wizard, `MEDIESCARE_MODE` handling, config storage | 1.5 |
| H4 | LAN: mDNS + UDP discovery, manual IP, pairing code, cert generation and pinning, device token, SSE channel | 1.5 |
| H5 | Windows firewall rule helper (elevation, manual fallback text) | 0.5 |

### I. Sync skeleton (3.0 d)

| # | Task | Days |
|---|---|---|
| I1 | `recordChange()` in the repository layer, outbox writes in the same transaction, test that a synced write without an outbox row fails | 1.0 |
| I2 | Push worker with batching, backoff, idempotency key, status states | 1.0 |
| I3 | Mock cloud endpoint (`cloud` mode stub on Postgres or in-memory) with dedupe by event id, sync status UI (online, last sync, pending, errors, Sync now) | 1.0 |

### J. Backup and restore (2.5 d)

| # | Task | Days |
|---|---|---|
| J1 | Scheduled encrypted backups, rolling retention, integrity check | 1.0 |
| J2 | One-click restore (with pre-restore safety copy), external-drive export, restore test in CI | 1.0 |
| J3 | Backup status page and alerts | 0.5 |

### K. Packaging and quality gate (4.0 d)

| # | Task | Days |
|---|---|---|
| K1 | electron-builder NSIS installer, native modules rebuilt, icon, per-user vs per-machine install decision, code signing plan | 2.0 |
| K2 | **Packaged-app smoke test** on a clean Windows VM (install, first run, terminal pairing, uninstall) scripted with Playwright + Electron | 1.0 |
| K3 | Cold-start measurement on a 4 GB Windows machine, baseline recorded in `docs/` | 0.5 |
| K4 | Auto-updater skeleton (feed URL config, signed update check, disabled until a feed exists) | 0.5 |

### L. Documentation (1.5 d)

| # | Task | Days |
|---|---|---|
| L1 | Approved ADRs written from the proposals, schema diagram, sync protocol doc v0 | 0.5 |
| L2 | Installer/backup guide, Super Admin quick guide, developer README | 0.5 |
| L3 | Phase 1 demo script + release notes | 0.5 |

## Totals

| Group | Days |
|---|---|
| A Tooling | 3.5 |
| B Branding and design system | 3.0 |
| C i18n and RTL | 2.0 |
| D Database layer | 5.0 |
| E Core package | 3.0 |
| F Auth and RBAC | 5.0 |
| G Admin screens | 5.0 |
| H Electron and modes | 6.0 |
| I Sync skeleton | 3.0 |
| J Backup and restore | 2.5 |
| K Packaging and gate | 4.0 |
| L Documentation | 1.5 |
| **Subtotal** | **43.5 developer-days** |
| Contingency (native modules, SQLCipher, Windows quirks), 20 % | 8.7 |
| **Phase 1 total** | **about 52 days, roughly 10 working weeks for one developer** |

The two things most likely to blow the estimate are **SQLCipher on better-sqlite3 for Electron/Windows (D1)** and **Next.js standalone inside the packaged app (H2, K1)**. Both are spiked first, in week 1, before anything else is built on them. If either spike fails, an ADR and a decision with you happen before further work.

## Order of work (vertical slices)

1. **Week 1: risk spikes.** A4, D1, H2, K1 in minimal form. Deliverable: a signed-off "hello" installer that runs Next.js, opens an encrypted SQLite file, reads one row, on a clean VM.
2. **Weeks 2-3:** repository/tooling (A), core (E), DB schemas and migrations (D), tokens and shell (B).
3. **Weeks 4-5:** auth, RBAC, admin screens (F, G), i18n (C).
4. **Weeks 6-7:** runtime modes, LAN pairing, SSE (H), sync skeleton (I).
5. **Weeks 8-9:** backup/restore (J), packaging gate (K), documentation (L).
6. **Week 10:** hardening, demo rehearsal, fixes. Then stop for approval before Phase 2.

## Acceptance checklist (definition of done)

- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass.
- [ ] Schema parity test passes. Immutability triggers tested.
- [ ] Permission matrix test passes. Every route declares a permission (lint).
- [ ] Audit chain verifies after backup and restore.
- [ ] Outbox row exists for every synced write (test).
- [ ] Packaged installer smoke test passes on a clean Windows VM, including terminal pairing.
- [ ] Cold start under 5 s on the reference machine (measured, recorded).
- [ ] Demo script above runs end to end.
- [ ] No real customer/staff data anywhere in the repo. Seeds use fake data.
- [ ] ADRs for encryption, money scale, auth, failover written and approved.
