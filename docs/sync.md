# Sync foundation (Phase 4)

Status: the branch side and the cloud rules are built and tested against an in-memory cloud. **No real cloud (Supabase or any Postgres) exists yet and nothing here was tested against one.** Design background: [phase0/sync-design.md](phase0/sync-design.md), failover: [ADR-0004](adr/0004-branch-server-failover.md), adapter: [ADR-0012](adr/0012-cloud-adapter-supabase.md).

## How it works

```
POS / any write ──(same transaction)──> sync_outbox row ──> SyncRunner (timer, off the request path)
                                                              │ push batch (epoch + idempotency key)
                                                              ▼
                              CloudAdapter ── HttpCloudAdapter ──> cloud-mode app: POST /api/sync/push
                                          └── FakeCloud (tests)     │ device token, Zod, CloudStore
```

- **Outbox** (`packages/db/src/outbox.ts`): `recordChange` writes an outbox row in the same transaction as every write. Unchanged.
- **Worker** (`packages/db/src/syncWorker.ts` `pushOutbox`): selects due rows in `seq` order (200 events or about 1 MB), pushes, and marks a row sent only when the cloud acknowledged that exact event id. Acks for ids it did not send are ignored. A network error or timeout (60 s) keeps every row and schedules a retry with exponential backoff (2 s doubling to a 15 min cap, jitter). An explicit `rejected` parks the row in the error queue with the reason and never blocks later rows. A lost response is safe: the retry comes back `duplicate` per event.
- **Runner** (`packages/db/src/sync/runner.ts` `SyncRunner`): runs `pushOutbox` on a timer (default every 5 s, longer while failing), drains a backlog in several batches per cycle and yields to the event loop between batches. The POS never calls into it and never awaits it. It exposes `status()`, `nudge()` ("sync now"), `stop()`.
- **Cloud rules** (`packages/sync`): `InMemoryCloudStore` implements dedupe by event id, per-event scope checks (an event must carry the caller's tenant, branch and device), schema version window (N and N-1), HLC validation, clock-skew flagging (more than 24 h ahead: accepted with a `clock_skew` flag), epoch fencing, the master-data merge (`conflict.ts`), append-only handling of documents, and per-entity change feeds for pull. The same functions are what a Postgres store must call.
- **Master data merge**: per field. A clean edit on the latest `version` wins. Otherwise last writer wins by HLC and the loser is kept as a conflict note (both values). **Head Office wins price-policy fields** (`retailRateUnitMicro`, `taxBp`, `taxInclusive`, `maxDiscountBp` on items; configurable) regardless of clocks. Conflicts can be reported for a plain reordering of two edits by the same person (benign), never for identical values.
- **Pull** (`pull.ts` `pullChanges`): per-entity cursors in `sync_cursors`, seen ledger in `sync_inbox_seen`. The cursor advances only after the applier succeeded. The applier per entity type is a plug-in and **does not exist yet**, so the runner only pushes today.
- **Repair tools** (functions, no UI): `requeueAcked` (re-push a range, safe because the cloud dedupes), `retryRejected`, `resetCursors` (re-pull from scratch; clears the seen ledger, so appliers must be idempotent).

## Configuration (opt-in)

With `MEDIESCARE_CLOUD_URL` unset the app behaves exactly as before.

| Variable                      | Meaning                                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MEDIESCARE_CLOUD_URL`        | https origin of a cloud-mode instance. Plain http only for loopback, or with `MEDIESCARE_CLOUD_ALLOW_INSECURE=1`                                                                                                         |
| `MEDIESCARE_CLOUD_TOKEN`      | Device token issued by the cloud. The desktop shell reads it from the environment or from a sealed file (`cloud-token.json`, Electron safeStorage, `DeviceTokenStore`) and passes it to the server process. Never logged |
| `MEDIESCARE_SYNC_INTERVAL_MS` | Pause between cycles (default 5000, minimum 500)                                                                                                                                                                         |
| `MEDIESCARE_SYNC_EXPORT_DIR`  | Where a fenced server writes its unsent tail (default `<userData>/sync-exports`)                                                                                                                                         |
| `MEDIESCARE_DISABLE_JOBS=1`   | Also disables the sync worker (used by tests)                                                                                                                                                                            |

Cloud side (`MEDIESCARE_MODE=cloud`): `POST /api/sync/push` and `POST /api/sync/pull` with `Authorization: Bearer <device token>`. Bodies are size-limited (5 MB), validated with Zod, rate limited per device (240 requests/min). `MEDIESCARE_CLOUD_STORE=memory` selects the non-durable in-memory store for local development (devices from `MEDIESCARE_CLOUD_DEV_DEVICES`, a JSON array). Any other value selects the **PostgreSQL store, which is a stub that answers HTTP 501**.

## API for the UI

- `GET /api/sync/status` (`admin.sync.view`): `SyncStatusReport` from `@mediescare/sync`: `enabled`, `state` (`disabled | idle | syncing | offline | fenced | error`), `pending`, `rejected`, `oldestPendingAt`, `oldestPendingAgeSeconds`, `lastSuccessAt`, `lastError`, `consecutiveFailures`, `nextAttemptAt`, `serverEpoch`, `clockSkewSuspected`, `cloudHost`. The original `pending`, `rejected`, `oldestPendingAt` fields are kept.
- `POST /api/sync/retry` (`admin.sync.edit`): clears backoff and wakes the worker, returns 202 at once. 409 `SYNC_NOT_CONFIGURED` when sync is off.

## LAN pairing (branch server and terminals)

- **Announce**: the desktop shell of a `branch-server` listens on UDP 3211 (`DISCOVERY_PORT`), broadcasts once at start and answers every probe. The packet holds only display name, branch code and HTTP port. A terminal sends a probe and collects answers (`discoverServers`). Windows Firewall must allow inbound UDP 3211 (and TCP 3210) on the server PC. Node `dgram` only, no new dependency.
- **Pair**: an admin calls `POST /api/sync/pairing-code` (`admin.device.create`) and reads an 8 digit code on the server. The code lives 10 minutes, works once, exists only in server memory (hashed), a new code replaces the old one, at most 5 codes per 10 minutes, and 5 wrong guesses burn it. The terminal calls `POST /api/sync/pair` (no session; the code is the credential; 10 attempts per minute server-wide) and receives `<deviceId>.<secret>` once. The server stores a `devices` row (`role = terminal`) with the SHA-256 of the secret, audits it, and queues the row for sync **without** the hash. `verifyDeviceToken` and `revokeDevice` exist in `packages/db/src/sync/pairing.ts`.
- **Terminal side**: `pairWithServer`, `DeviceTokenStore` (sealed with the OS credential store), IPC `lan:discover` / `lan:pair` and the preload methods `discoverServers` / `pairWithServer` (only the app's own origin may call them; the token never reaches the page).
- **Not built**: the first-run wizard screens for pairing, and using the terminal device token to authenticate terminal requests (terminals still sign in with user sessions).

## Failover (ADR-0004)

- `sync_epochs` (new table, SQLite 0009 and Postgres 0007) keeps one row per promotion. `getServerEpoch(db)` is the highest epoch for the branch (1 if none). Every push carries it.
- `promote(db, ctx, { reason, deviceId? })` (CLI: `packages/db/src/cli/promote.ts`): in one transaction it inserts the next epoch, moves every document counter past the last number plus the failover gap (`afterFailover` in `packages/core`), optionally swaps server and standby roles, writes an audit entry and an outbox event. Manual only.
- The cloud remembers the highest epoch per branch. A lower epoch gets HTTP 409 `STALE_EPOCH`. A higher one is adopted (the promoted server can announce it with an empty batch, which the runner sends once at start when the epoch is above 1).
- A fenced runner stops pushing, sets state `fenced`, writes its unsent events to `fenced-tail-<time>.json` (0600) in the export folder, parks those rows in the error queue (`fenced: ...`), and audits the export. Nothing is deleted or merged. It stays fenced until the local epoch rises.
- Fencing is only as early as the old primary's next push attempt (after any backoff), and only works if the promoted server has contacted the cloud once. Detecting a newer epoch on the LAN is not built.

## What is tested

| Area                                                                                                                                                                                                                                                                     | Where                                                                              | Result  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | ------- |
| Merge rules: LWW, order independence, per-field, Head Office price, void, replay                                                                                                                                                                                         | `packages/sync/src/conflict.test.ts`                                               | passing |
| Cloud rules: dedupe, scope, schema window, skew flag, epoch fencing, pull cursors and scope                                                                                                                                                                              | `packages/sync/src/cloud-store.test.ts`                                            | passing |
| HTTP adapter (typed errors, https rule) and adapter to endpoint round trip                                                                                                                                                                                               | `packages/sync/src/http-adapter.test.ts`, `apps/web/src/server/sync-cloud.test.ts` | passing |
| Offline for days then catch up (300 events, totals match), lost responses, double delivery, reverse order, drop mid-batch, rejected events, clock skew, two branches editing one item, requeue after cloud restore, pull with failing apply and re-pull, hung cloud call | `packages/db/src/sync/sync-chaos.test.ts`                                          | passing |
| Runner status, backoff, revoked token, backlog drain, POS not blocked, start/stop                                                                                                                                                                                        | `packages/db/src/sync/runner.test.ts`                                              | passing |
| Promotion, durable epoch, counter gap, fencing an old primary and tail export                                                                                                                                                                                            | `packages/db/src/sync/failover.test.ts`                                            | passing |
| Pairing codes and terminal devices                                                                                                                                                                                                                                       | `packages/db/src/sync/pairing.test.ts`                                             | passing |
| UDP discovery on loopback, packet validation, announce retry, pairing client, sealed token store                                                                                                                                                                         | `apps/desktop/src/discovery.test.ts`, `pairing.test.ts`                            | passing |
| Real HTTP smoke (manual, not a repeatable test): `next dev` branch server plus a scratch node cloud using the real `handleCloudPush`; first-run events reached the cloud, status, retry, pairing code, pair, reuse refused                                               | scratch run                                                                        | worked  |

## What is NOT tested or built

- Any real Postgres or Supabase store. The Next.js `push`/`pull` routes were not exercised in cloud mode (only the handler logic and a node http bridge were).
- Initial sync of a fresh branch (snapshot as NDJSON, resume, progress) and per-entity appliers that write pulled master data into the local tables. Pull today only stores cursors and calls a plug-in applier.
- Dependency parking (holding a document event until its master row arrives): the cloud store accepts events in any order and does not check references.
- Standby replication and the "Promote this PC" and "re-join as standby" screens; the wizard UI for pairing; LAN detection of a newer epoch.
- Verify (row counts and rolling hash against the cloud), repair UI, and the conflict review screen (`StoredConflict` rows exist only in the in-memory store; a Postgres `sync_conflicts` table is not created).
- Device registration and token issuing on the cloud, RLS, TLS termination, the offline warning thresholds (24 h and 72 h) in the UI.
- Load or performance measurements of the worker on a 100k-SKU database.

## What remains (in order)

1. Postgres `CloudStore` (transaction per batch, `FOR UPDATE` on the epoch row, event id ledger, `change_seq`), device registration, then an integration run against a real database.
2. Initial sync of a fresh branch and the entity appliers.
3. Terminal pairing wizard, device-token auth for terminals, standby replication and the promotion screen.
4. Settings screen using `SyncStatusReport`, conflict review, repair buttons.
