# Architecture decision records

Status values: **Proposed** (needs your approval), **Accepted**, **Superseded**. The four marked ★ were requested in Phase 0 and are drafted in full. ADR-0007 and ADR-0012 record the Phase 1 spike results and the Supabase decision. The rest are one-line proposals that will be written as they become relevant.

| ADR | Title | Status | Needed by |
|---|---|---|---|
| [0001](0001-sqlite-encryption.md) ★ | SQLite encryption at rest | Accepted for Phase 1 (spike passed, see 0007) | Done |
| [0002](0002-money-scale.md) ★ | Money representation and rounding | Proposed | Phase 1 (core package) |
| [0003](0003-auth-approach.md) ★ | Offline-capable authentication | Proposed | Phase 1 |
| [0004](0004-branch-server-failover.md) ★ | Branch-server failover | Proposed | Tier 0 in Phase 1-2, Tier 1 in Phase 3 |
| 0005 | Item search: SQLite FTS5 with prefix index and Urdu/Latin tokenisation | Proposed | Phase 2 |
| 0006 | IDs (UUIDv7) and hybrid logical clock format | Proposed | Phase 1 |
| [0007](0007-packaging-and-runtime.md) | Packaging, native modules and the runtime that runs them (spike results) | Accepted for Phase 1 | Done (week 1 spike) |
| 0008 | Tamper-evident audit log (SHA-256 hash chain per branch, cloud anchoring) | Proposed | Phase 1 |
| 0009 | Document numbering (branch prefix, per-type sequence, block reservation, epoch after failover) | Proposed | Phase 1 |
| 0010 | Stock ledger and derived balances (movement kinds, in-transit store, rebuild) | Proposed | Phase 2 |
| 0011 | Transport security on the LAN (self-signed cert with pinning versus plain HTTP) | Proposed | Phase 1 |
| [0012](0012-cloud-adapter-supabase.md) | Cloud database: Supabase as plain PostgreSQL behind a swappable adapter (no Supabase Auth) | Accepted for design, built in Phase 3 | Phase 3 |
| 0013 | Thermal printing and Urdu receipts (bitmap rendering) | Proposed | Phase 2, needs printer models |
| 0014 | Accounting depth (simple versus double-entry) | Proposed | Phase 4, needs owner answer |
