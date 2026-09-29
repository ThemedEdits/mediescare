# ADR-0004: Branch-server failover

Status: **Proposed** (needs approval, and owner input on Q2). Date: 2026-09-30.

## Context

In `branch-server` mode all terminals depend on one PC that owns the branch SQLite DB. If that PC dies, the branch stops selling. CLAUDE.md asks whether a spare or failover server is needed (§13). Two servers accepting sales at once (split brain) would corrupt numbering and stock, so it must be impossible by design. The mechanism is described in [architecture.md §6](../phase0/architecture.md).

## Options

| Option | Recovery time | Data loss window | Cost and complexity | Main risk |
|---|---|---|---|---|
| 0. **Backup restore on another PC**, with an automatic backup copy pushed to a standby terminal every 15 min, cloud backup, and a terminal receipt journal for reconciliation | 15-60 min | up to the backup interval, recoverable from journals and cloud events | Low | Human error during restore |
| 1. **Warm standby** terminal with near-real-time change-log replication, **manual one-click promotion**, epoch fencing | 2-5 min | seconds (replication lag) | Medium | Operator promotes while the primary is alive, mitigated by epoch fencing and a reachability check |
| 2. **Automatic failover** with a witness and leases | under 1 min | seconds | High | Split-brain bugs, hard to test |
| 3. **Provisional receipts** on terminals (emergency mode) | immediate | none for committed data, but provisional documents need reconciliation | Medium | Compliance (controlled drugs) and stock double-use, so limited to cash sales |

## Proposed decision

- **Phase 1-2: Option 0.** Cheap, and needed anyway for restore.
- **Phase 3: Option 1**, offered per branch where a second PC exists. Promotion is manual. An epoch number carried on every write and sync push fences a returning old primary. Unreplicated tail transactions are exported for manager review, never dropped or silently merged.
- **Option 3** only if the owner asks for it (off by default).
- **Option 2** is not planned before Phase 6.
- Document numbers stay unique across failover because counters are reserved in blocks and the promoted server starts after the last replicated number plus a gap (ADR-0009, to be written).

## Consequences

- Extra fields: `server_epoch`, and block bounds on `doc_counters`. Small, and needed for sync anyway.
- The installer wizard gains a "Standby" role for a terminal and a "Promote to server" screen, both with clear warnings.
- Test plan: a failover chaos test (kill the primary during a sale, promote, old primary returns, check duplicate numbers and stock).
- If a few hours of downtime is acceptable to the owner (Q2), Option 0 alone may be enough for Phase 3.
