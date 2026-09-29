# ADR-0007: Packaging, native modules and the runtime that runs them

Status: **Accepted for Phase 1** (results of the Week 1 spikes, run on the owner's Windows 10 PC). Date: 2026-09-30.

## Context

Mediescare ships as an Electron app that starts a Next.js standalone server as a child process. The database is a native module, so the runtime it loads into matters. This PC has no C++ compiler and no Python, so anything that needs compiling from source cannot be built here.

## Spike findings (measured, not assumed)

| Question | Result |
|---|---|
| Does an encrypted SQLite build load in Electron? | **Yes.** `better-sqlite3-multiple-ciphers` 13.0.3 with Electron 44.5 (Node 24.21): SQLCipher encryption, WAL, FTS5 prefix search all work. A wrong key is rejected. No plaintext reaches disk. It ships **N-API prebuilds for win32-x64**, so nothing is compiled and no `electron-rebuild` is needed. |
| Does it load under this PC's system Node (22.12)? | **No.** Version 13.0.3 (and stock `better-sqlite3` 13.0.3) crash with an access violation when a database is opened. Versions 11.10.0 and 12.2.0 work under Node 22.12. |
| Does 12.11.1 work in Electron 44? | It hung in the Electron test, so it was not used. |
| Does the packaged-style layout work (pnpm)? | pnpm's symlinked `node_modules` is unreliable for Next standalone tracing and electron-builder on Windows, so the repo uses `node-linker=hoisted` (`.npmrc`). |

## Decision

1. **Database driver:** `better-sqlite3-multiple-ciphers` 13.0.3, installed under the package name `better-sqlite3` through an npm alias in `packages/db`. Drizzle's driver imports `better-sqlite3`, so this gives one native module for everything.
2. **One runtime everywhere:** the branch server, the tests and the CLI tools all run on **Electron's Node** (`ELECTRON_RUN_AS_NODE=1`, helper `scripts/electron-node.mjs`). The shipped app runs the database there anyway, so tests exercise the real thing. Pure packages (`core`, `sync`, `config`) still test under plain Node.
3. **Server process:** the Electron main process spawns `server.js` (Next standalone) with `process.execPath` and `ELECTRON_RUN_AS_NODE=1`. It is a separate process from the window, restarts on crash (up to 5 times, backoff), and is killed on quit.
4. **Packaging:** electron-builder NSIS installer, per-user install by default (no admin rights needed, allow changing the folder). The web server and its `node_modules` ship under `resources/web` (`extraResources`, outside the asar), because native `.node` files and a child-process Node cannot load from inside an archive. `npmRebuild: false`.
5. **Standalone assets:** Next does not copy `.next/static` and `public` into standalone output, so `scripts/prepare-web.mjs` assembles them, plus the Drizzle migration folder (`outputFileTracingIncludes`).
6. **Secrets:** the database key and session secret are created at first run and wrapped with Windows DPAPI (Electron `safeStorage`). If OS encryption is unavailable the app refuses to create a key (fail closed).
7. **Dev shell note:** this VS Code environment sets `ELECTRON_RUN_AS_NODE=1` globally. Scripts that launch the Electron GUI delete it from the child environment.

## Consequences

- Developers and CI must run DB tests through `pnpm test` (which uses Electron's Node), not bare `node`/`vitest`.
- Upgrading Electron or `better-sqlite3-multiple-ciphers` needs the spike checks repeated (`packages/db/src/db.test.ts` covers encryption, WAL and wrong-key rejection).
- The system Node crash is not fully explained (it also affects stock better-sqlite3 13.0.3, so it is not specific to the cipher fork). It may be fixed by a newer Node 22.x. It does not affect the shipped app.
- The Windows installer has not been code-signed. Unsigned installers show a SmartScreen warning. Signing is an owner decision (certificate cost).
