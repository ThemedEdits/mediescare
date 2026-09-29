# Phase 1 status

Measured against [phase0/phase1-plan.md](phase0/phase1-plan.md). Last updated 2026-09-30.

**Verified today:** `pnpm lint`, `pnpm typecheck` and `pnpm test` all pass (125 tests: core 50, sync 12, db 43, web 16, desktop 4). The web app builds to a Next standalone server. The unpacked Windows app and the NSIS installer build (`release/Mediescare-Setup-0.1.0.exe`, 127 MB, unsigned). The packaged-app smoke test passes 16 checks with a 5.0 s cold start.

**Not verified:** the installer itself has not been run on a clean machine or VM. The smoke test runs the unpacked app. Nothing was tested on a 4 GB RAM PC (the 5 s budget was met on this development PC only).

## Week 1 spikes

| Spike | Result |
|---|---|
| SQLCipher + better-sqlite3 on Electron/Windows | **Pass.** `better-sqlite3-multiple-ciphers` 13.0.3 (N-API prebuild) in Electron 44: encryption, WAL, FTS5, wrong-key rejection. Crashes on the system Node 22.12, so tests run on Electron's Node. See [ADR-0007](adr/0007-packaging-and-runtime.md). |
| Next.js standalone run by Electron | **Pass** after two fixes found by the packaged test: electron-builder drops `node_modules` from `extraResources` (fixed with an `afterPack` hook), and a tsconfig `paths` entry made Turbopack resolve the SQLite module to a `.d.ts` (removed). |

## Plan groups

| Group | State |
|---|---|
| A Tooling | Done except Husky commit-msg (Conventional Commits check) and running CI. Workflow file written, never executed (no git repo yet). |
| B Branding and design system | Tokens, icons (.ico/.png from the SVG), login/setup/dashboard pages done. shadcn/ui components, Priority Modules nav, branch switcher and sync chip **not done**. |
| C i18n and RTL | **Not done.** Only `dir`/font hooks in CSS. No next-intl, no Urdu strings, no bundled fonts. |
| D Database layer | SQLite schema, migrations, parity test, audit-log triggers done. Postgres schema and migrations generated but **never applied to a real Postgres**. Backup before migrate not done. |
| E Core package | Money, permissions, numbering, audit hash chain done and tested. |
| F Auth and RBAC | Password login, lockout, sessions, route guard, RBAC, field hiding done. **Not done:** PIN login, TOTP 2FA, manager-PIN override service, breached-password list (only a short list), idle lock screen, device tokens. |
| G Admin screens | First-run setup, login, dashboard only. **Not done:** users, roles, branches/devices, settings, audit-log screens, change password. |
| H Electron and modes | Wizard, server launcher, OS-protected secrets, locked-down window, `--quit`, single-instance done. **Not done:** LAN discovery (mDNS/UDP), pairing, certificate pinning, SSE, firewall helper, terminal mode is only "open this address", no standby/promotion. |
| I Sync skeleton | Outbox, push worker with backoff and idempotency, status numbers done. **Not done:** mock cloud endpoint, sync status UI (only a count on the dashboard), pull/cursors. |
| J Backup and restore | **Not done.** |
| K Packaging and gate | Installer, smoke test done. **Not done:** clean-VM install test, 4 GB cold-start measurement, updater skeleton, code signing. |
| L Documentation | ADR-0007 and ADR-0012 written, README updated. Installer/backup guide, schema diagram, sync protocol doc not written. |

## Known gaps to decide or fix next

1. **Recovery key (ADR-0001):** the design says show a recovery key at setup. The app currently protects the DB key with Windows DPAPI only. If the Windows profile is lost, an old database cannot be opened. Needs the backup/restore work first.
2. **Failover:** only Tier 0 pieces exist (nothing automatic yet). Warm standby is Phase 3 as planned.
3. **Supabase Auth was not used** on purpose, see [ADR-0012](adr/0012-cloud-adapter-supabase.md).
4. **Unsigned installer:** Windows SmartScreen will warn until a code-signing certificate is bought.
5. Setup endpoint is open until the first admin exists (by design, refuses afterwards). On a branch server bound to the LAN, first-run setup should be limited to the local machine. Not yet enforced.
6. Rate limiting is per account lockout only. No per-IP limiter yet.
