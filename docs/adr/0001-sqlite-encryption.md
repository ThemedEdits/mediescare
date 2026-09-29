# ADR-0001: SQLite encryption at rest

Status: **Accepted for Phase 1.** Spike passed on 2026-09-30 (see [ADR-0007](0007-packaging-and-runtime.md)). Date: 2026-09-30.

## Context

CLAUDE.md requires the local database to be encrypted at rest and leaves the method to this ADR: a SQLCipher build or OS-level encryption. The DB holds sales, customers (phone, CNIC in the narcotic register), staff and financial data on shop PCs that may be shared, stolen or repaired by third parties. The stack is fixed to better-sqlite3 with Drizzle. Backups must be encrypted too.

## Options

| Option | For | Against |
|---|---|---|
| A. **SQLCipher-compatible build** for better-sqlite3 (for example the `better-sqlite3-multiple-ciphers` fork, or a custom build) | Protects the file wherever it is copied (backups, USB, stolen disk). Independent of Windows edition. Standard cipher (AES-256) | Not the stock better-sqlite3 binary. Needs a Windows prebuild for the Electron ABI, or a build toolchain in CI. Slightly slower. Key management is our job |
| B. **OS-level only** (BitLocker/EFS) | Zero code. Stock better-sqlite3 | Not available on Windows Home. Protects nothing once the file is copied or backed up. Cannot be verified from inside the app. Owner must configure it |
| C. Application-level column encryption | Stock SQLite | Breaks FTS5 search and indexes on encrypted columns. High complexity. Leaves metadata exposed |

## Proposed decision

**Option A**, with the key protected by the OS:

1. Generate a random 256-bit database key at first run.
2. Wrap it with the Windows credential store (Electron `safeStorage`, which uses DPAPI) and store the wrapped key next to the DB. The app unwraps it at start. No password prompt at startup, because a pharmacy PC must boot into a working POS unattended.
3. Show the owner a **recovery key** once at setup (printed or exported). Backups are encrypted with a key derived from the recovery key, so **restore works on a different PC**. Without it, a copied backup cannot be opened on a new PC.
4. Terminals hold no DB. The branch server DB is encrypted. Cloud Postgres relies on provider encryption plus column encryption for CNIC and phone.
5. Recommend BitLocker in the installer guide as a second layer. It is not relied on.

## Consequences

- **Verified in the spike:** `better-sqlite3-multiple-ciphers` 13.0.3 has win32-x64 N-API prebuilds, loads in Electron 44, supports FTS5 and WAL, rejects a wrong key and leaves no plaintext on disk (covered by `packages/db/src/db.test.ts`). It crashes on this PC's system Node 22.12, so tests and tools run on Electron's Node.
- Cold start and query time are measured against the budgets (search under 100 ms).
- Key loss is unrecoverable without the recovery key. The wizard says so.

## To confirm with you

Is an unattended start (no password at boot) acceptable? A stolen PC that is powered off is protected. A stolen PC that is logged into Windows is not.
