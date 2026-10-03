# Sync foundation (Phase 4)

Status: the branch side, the cloud rules, a PostgreSQL cloud store, device authentication and the cloud-mode app are built and tested against the in-memory cloud and against **PGlite** (PostgreSQL in WebAssembly, also through the real `postgres` driver over a socket). **Nothing has run against a real Supabase database or on Vercel yet**: the Supabase direct host in `.env` is IPv6-only and unreachable from the development PC, and deploying needs the owner's Vercel login. Owner steps: [cloud-deploy.md](cloud-deploy.md). Design background: [phase0/sync-design.md](phase0/sync-design.md), failover: [ADR-0004](adr/0004-branch-server-failover.md), adapter: [ADR-0012](adr/0012-cloud-adapter-supabase.md).

## How it works

```
POS / any write ──(same transaction)──> sync_outbox row ──> SyncRunner (timer, off the request path)
                                                              │ push batch (epoch + idempotency key)
                                                              ▼
                              CloudAdapter ── HttpCloudAdapter ──> cloud-mode app: POST /api/sync/push
                                          └── FakeCloud (tests)     │ access token, Zod, CloudStore
```

- **Outbox** (`packages/db/src/outbox.ts`): `recordChange` writes an outbox row in the same transaction as every write. Unchanged.
- **Worker** (`packages/db/src/syncWorker.ts` `pushOutbox`): selects due rows in `seq` order (200 events or about 1 MB; 500 events while the first upload of an existing database runs), pushes, and marks a row sent only when the cloud acknowledged that exact event id. Acks for ids it did not send are ignored. A network error or timeout (60 s) keeps every row and schedules a retry with exponential backoff (2 s doubling to a 15 min cap, jitter). An explicit `rejected` parks the row in the error queue with the reason and never blocks later rows. A lost response is safe: the retry comes back `duplicate` per event.
- **Runner** (`packages/db/src/sync/runner.ts` `SyncRunner`): runs `pushOutbox` on a timer (default every 5 s, longer while failing), drains a backlog in several batches per cycle and yields to the event loop between batches. The POS never calls into it and never awaits it. It exposes `status()`, `nudge()` ("sync now"), `stop()`.
- **Cloud rules** (`packages/sync`): `InMemoryCloudStore` implements dedupe by event id, per-event scope checks (an event must carry the caller's tenant, branch and device), schema version window (N and N-1), HLC validation, clock-skew flagging (more than 24 h ahead: accepted with a `clock_skew` flag), epoch fencing, the master-data merge (`conflict.ts`), append-only handling of documents, and per-entity change feeds for pull. `PostgresCloudStore` (`packages/db/src/sync/cloud`) calls the same functions and passes the same contract suite.
- **Master data merge**: per field. A clean edit on the latest `version` wins. Otherwise last writer wins by HLC and the loser is kept as a conflict note (both values). **Head Office wins price-policy fields** (`retailRateUnitMicro`, `taxBp`, `taxInclusive`, `maxDiscountBp` on items; configurable) regardless of clocks. Conflicts can be reported for a plain reordering of two edits by the same person (benign), never for identical values.
- **Pull** (`pull.ts` `pullChanges`): per-entity cursors in `sync_cursors`, seen ledger in `sync_inbox_seen`. The cursor advances only after the applier succeeded. The appliers per entity type are plug-ins (registry in `packages/db/src/sync/appliers/`): see [Multi-branch master data](#multi-branch-master-data).
- **Repair tools** (functions, no UI): `requeueAcked` (re-push a range, safe because the cloud dedupes), `retryRejected`, `resetCursors` (re-pull from scratch; clears the seen ledger, so appliers must be idempotent).

## Configuration (opt-in)

Nothing syncs until this PC is connected to a cloud; until then the app behaves exactly as before.

**Branch side.** Normally you set nothing in the environment. Head Office uses Settings > Cloud sync > **Connect to cloud**; a new branch joins on its setup screen with an enrollment code. Either way the server saves the cloud address and a rotating refresh token in `cloud-auth.json` in the data folder (AES-256-GCM, key derived from `MEDIESCARE_DB_KEY`, which the desktop shell keeps sealed with the OS credential store; without a key, development only, the file is plain JSON with mode 0600). The server process rotates and saves the token itself. Legacy fixed-token setup (development): `MEDIESCARE_CLOUD_URL` + `MEDIESCARE_CLOUD_TOKEN`.

| Variable                          | Meaning                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `MEDIESCARE_CLOUD_ALLOW_INSECURE` | `1` allows plain http to a non-loopback host (tests, private networks). Otherwise https only |
| `MEDIESCARE_SYNC_INTERVAL_MS`     | Pause between cycles (default 5000, minimum 500)                                             |
| `MEDIESCARE_SYNC_EXPORT_DIR`      | Where a fenced server writes its unsent tail (default `<userData>/sync-exports`)             |
| `MEDIESCARE_DISABLE_JOBS=1`       | Also disables the sync worker (used by tests)                                                |

**Cloud side** (`MEDIESCARE_MODE=cloud`, see [cloud-deploy.md](cloud-deploy.md) and [.env.example](../.env.example)): `MEDIESCARE_CLOUD_DATABASE_URL` (Supabase **Session pooler** string), `MEDIESCARE_CLOUD_JWT_SECRET`, `MEDIESCARE_CLOUD_BOOTSTRAP_CODE`; `MEDIESCARE_CLOUD_STORE` = `postgres` (default), `pglite` (local development, `pnpm cloud:dev`) or `memory` (tests). `pnpm cloud:migrate` creates the cloud-only tables from `packages/db/cloud/*.sql`. Cloud mode never opens SQLite: it serves `/`, `/api/health` and `/api/sync/*` only, everything else answers 404 (rewrites in `next.config.ts`, evaluated at build time, so `MEDIESCARE_MODE=cloud` must be set for `next build`).

### Cloud endpoints (cloud mode only)

| Endpoint                          | Credential                                      | Purpose                                                                                                                                                                                                                             |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/sync/bootstrap`        | bootstrap code (env), 5 tries / 10 min / client | First Head Office PC creates the organisation, its Head Office branch and device. Once per organisation name; the same PC may re-attach with its own ids                                                                            |
| `POST /api/sync/enrollment-codes` | Head Office access token                        | One-time code (24 h) for a new branch `{ branchCode, branchName, branchId? }`. With `branchId` (the id Head Office gave the branch row locally) `enroll` returns exactly that id as `branch.id`; without it the cloud generates one |
| `POST /api/sync/enroll`           | enrollment code, 10 tries / min / client        | New branch gets its device, tenant and branch info and tokens. Wrong, expired and used codes answer alike                                                                                                                           |
| `POST /api/sync/token`            | refresh token                                   | New access token (15 min JWT) and a NEW refresh token. Reuse of an old refresh token revokes the device, except inside a 15-second grace window (see below)                                                                         |
| `POST /api/sync/push`, `/pull`    | access token, 600 requests / min / device       | Bodies up to 5 MB, Zod validated; events up to 512,000 characters of JSON each; 500 events per batch                                                                                                                                |

Client functions (`@mediescare/sync`): `bootstrapHeadOffice`, `enroll`, `createEnrollmentCode(provider, ...)`, `refreshTokens`, `RefreshingTokenProvider` (refreshes on first use, about a minute before expiry and once after a 401; a revoked device is remembered and the runner stops in state `revoked`), `TokenStore` (`FileTokenStore`, `MemoryTokenStore`), `HttpCloudAdapter` (takes a token provider). Server side in `apps/web/src/server/sync-runtime.ts`: `connectToCloud`, `disconnectFromCloud`, `cloudAuthStore`.

### Initial upload of an existing database

The outbox keeps every write since the database was created, so the first connection uploads the whole history in `seq` order, batches of at most 500 events and about 1 MB, without pausing between cycles, resumable after a crash or network loss (acknowledged rows are never re-sent). `SyncStatusReport.initialUpload = { active, sent, total }` is derived from the outbox itself, so it survives restarts; a marker row in `sync_cursors` (`_initial_upload`) records that the first upload finished, after which the field is `null`. Measured: 50,010 events into the PostgreSQL store on PGlite in about 8 s (in process; add about one second per batch of network and database round trips for a real cloud).

### Data ownership note

A database that already exists sends its own tenant, branch and device ids when it connects and the cloud adopts them (events in its outbox carry them and the cloud checks them on every event). A database that belongs to a different organisation cannot join another organisation's cloud tenant; a new branch takes the ids the cloud issues (branch join screen).

## API for the UI

- `GET /api/sync/status` (`admin.sync.view`): `SyncStatusReport` from `@mediescare/sync`: `enabled`, `state` (`disabled | idle | syncing | offline | fenced | error | revoked`), `pending`, `rejected`, `oldestPendingAt`, `oldestPendingAgeSeconds`, `lastSuccessAt`, `lastError`, `consecutiveFailures`, `nextAttemptAt`, `serverEpoch`, `clockSkewSuspected`, `cloudHost`, `initialUpload`. The original `pending`, `rejected`, `oldestPendingAt` fields are kept.
- `POST /api/sync/retry` (`admin.sync.edit`): clears backoff and wakes the worker, returns 202 at once. 409 `SYNC_NOT_CONFIGURED` when sync is off.
- `POST /api/sync/connect` (`admin.sync.edit`): Head Office PC only. Body `{ cloudUrl, bootstrapCode, organisationName }`; branch code, name and ids come from this database. Saves the credentials and starts syncing at once (no restart). 409 `NOT_HEAD_OFFICE`, `ALREADY_CONNECTED`, `ORGANISATION_EXISTS`, 403 `BOOTSTRAP_CODE_WRONG`, 502 when the cloud cannot be reached. Audited (host only, never a token).
- `POST /api/sync/disconnect` (`admin.sync.edit`): stops the runner and deletes the saved credentials. Every local record and every queued event stays. Audited.

## LAN pairing (branch server and terminals)

- **Announce**: the desktop shell of a `branch-server` listens on UDP 3211 (`DISCOVERY_PORT`), broadcasts once at start and answers every probe. The packet holds only display name, branch code and HTTP port. A terminal sends a probe and collects answers (`discoverServers`). Windows Firewall must allow inbound UDP 3211 (and TCP 3210) on the server PC. Node `dgram` only, no new dependency.
- **Pair**: an admin calls `POST /api/sync/pairing-code` (`admin.device.create`) and reads an 8 digit code on the server. The code lives 10 minutes, works once, exists only in server memory (hashed), a new code replaces the old one, at most 5 codes per 10 minutes, and 5 wrong guesses burn it. The terminal calls `POST /api/sync/pair` (no session; the code is the credential; 10 attempts per minute server-wide) and receives `<deviceId>.<secret>` once. The server stores a `devices` row (`role = terminal`) with the SHA-256 of the secret, audits it, and queues the row for sync **without** the hash. `verifyDeviceToken` and `revokeDevice` exist in `packages/db/src/sync/pairing.ts`.
- **Terminal side**: `pairWithServer`, `DeviceTokenStore` (sealed with the OS credential store), IPC `lan:discover` / `lan:pair` and the preload methods `discoverServers` / `pairWithServer` (only the app's own origin may call them; the token never reaches the page).
- The first-run wizard for terminals (discovery, pairing code) is built, see [lan-terminals.md](lan-terminals.md). **Not built**: using the terminal device token to authenticate terminal requests (terminals still sign in with user sessions).

## Failover (ADR-0004)

- `sync_epochs` (new table, SQLite 0009 and Postgres 0007) keeps one row per promotion. `getServerEpoch(db)` is the highest epoch for the branch (1 if none). Every push carries it.
- `promote(db, ctx, { reason, deviceId? })` (CLI: `packages/db/src/cli/promote.ts`): in one transaction it inserts the next epoch, moves every document counter past the last number plus the failover gap (`afterFailover` in `packages/core`), optionally swaps server and standby roles, writes an audit entry and an outbox event. Manual only.
- The cloud remembers the highest epoch per branch. A lower epoch gets HTTP 409 `STALE_EPOCH`. A higher one is adopted (the promoted server can announce it with an empty batch, which the runner sends once at start when the epoch is above 1).
- A fenced runner stops pushing, sets state `fenced`, writes its unsent events to `fenced-tail-<time>.json` (0600) in the export folder, parks those rows in the error queue (`fenced: ...`), and audits the export. Nothing is deleted or merged. It stays fenced until the local epoch rises.
- Fencing is only as early as the old primary's next push attempt (after any backoff), and only works if the promoted server has contacted the cloud once. Detecting a newer epoch on the LAN is not built.

## Multi-branch master data

Status: built and tested with two real databases (Head Office and a branch) joined by the in-memory cloud. **No real cloud was used.** Owner steps: [multi-branch.md](multi-branch.md).

### What flows where

| Direction                                     | What                                                                                                                                                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Head Office down to every branch              | branches (the registry), units, categories, manufacturers, payment modes, suppliers, items (with pack units, barcodes and the search index)              |
| Branch up to the cloud, not applied on others | sales, returns, stock movements, bills, batches, shifts, audit. Transfers and requisitions are addressed to the two branches involved (see transfers.md) |
| Stays local on each branch                    | racks (and an item's rack), batches and stock, sales, settings, sessions, users and roles (**not synced yet**), the walk-in customer                     |

Why local: stock and money are each branch's own books (a ledger that only its own PC writes); racks are physical shelves; settings such as printer names differ per PC. Users and roles need a design of their own (password hashes must never travel in plain sync events), so a branch creates its own users for now.

### Applying pulled changes

- **`createChangeApplier(db, { clock })`** (`packages/db/src/sync/appliers/change-applier.ts`) is what the runner's `pull` option uses (`apps/web/src/server/pull-option.ts`). One pulled page is applied in ONE transaction with the registered per-entity appliers.
- **Order**: every applier is registered with a priority (`registerApplier(type, fn, { order })`, scale in `APPLY_ORDER`): branches 10; units, categories, manufacturers, payment modes 20; suppliers 30; items 40; transfers and requisitions 90. Parents are applied first inside a page, and events of one type in HLC order (a batch the network delivered reversed is put right again).
- **Missing parent**: an applier throws `DependencyMissing`. That entity type stops at that event for this page, its **cursor does not pass it**, the other types carry on, and the runner retries on its next cycle. The pull loop continues while other types still move (the parent may be among them) and stops as soon as a page makes no progress (`PullSummary.blocked` names the wait). Appliers check parents before writing; they are idempotent anyway.
- **Never double-applied**: an event id is applied once per page, the seen ledger skips ids delivered again, and every applier is idempotent (a page delivered again after a crash between apply and cursor save changes nothing and audits nothing).
- **Never pushed back**: appliers never write `sync_outbox`.
- **Audit**: action `sync.apply`. New rows are summarised per entity type and page. A change to an existing row (old and new values) and every conflict is audited on its own. The audit chain stays valid.
- **Malformed events** (wrong type, missing required field) are skipped and never stall the feed.

### Conflict rules at the branch

The branch keeps one HLC per row, so the per-field rules of `packages/sync/src/conflict.ts` are applied against it:

- **Price policy (Head Office wins)**: `retailRateUnitMicro`, `taxBp`, `taxInclusive` are applied from an event written by Head Office whatever the clocks say, so a Head Office price beats an earlier or later local edit. Head Office never goes back to an older price of its own (an older event from the same writer is dropped). A price field sent by a branch is ignored by everyone and kept as a conflict note. `maxDiscountBp` is in the cloud's list but items have no such column yet.
- **Branch-local fields**: `reorderLevelBase` and `allowNegativeStock` are copied when an item first arrives and are **never overwritten** afterwards. `rackId` is never taken (the item starts without a rack on the branch). `sku` and the base unit are fixed at creation. A supplier's opening balance never travels (always 0 on a pulled supplier) and its credit limit is copied only when it is created.
- **Everything else** (name, generic name, category, barcodes, flags): last writer wins by HLC. The losing value is kept in the audit entry as a conflict note.
- **Unique keys** (item code, unit code, payment mode code, branch code, a barcode held by another item): the local row keeps its key, the pulled one is reported as a conflict (`unique_key_taken`), nothing crashes.
- `branches.is_head_office` is set when a branch row is created and never changed by a pull; a row claiming to be a second Head Office is stored as a normal branch.

### Head Office pricing on a branch

On a branch whose organisation has a separate Head Office branch, `createItem` and `updateItem` (`packages/db/src/pharmacy/catalog.ts`) refuse to create items or change price, tax rate or tax-inclusive ("Prices and tax rates are set by Head Office"). The items screen shows those fields read-only with a note, and hides "Add item" and the Excel import there. Head Office itself, and a single-PC organisation with no other Head Office branch, are not restricted. The first branch created in first-run setup is always Head Office.

### Branch join (new PC, for example KHI02 joining HO01)

1. Head Office (Branches screen, admin password session) adds the branch: a normal `branches` change is queued, and the cloud issues a one-time enrollment code (valid 24 hours).
2. On the new PC, first-run screen, **Join an existing organisation**: cloud address, code, owner name, username, password.
3. The PC enrolls (`enroll`), then builds the database in a **staging file**: same organisation id as Head Office, the branch and device ids the cloud issued (the cloud only accepts events from the device it enrolled), a local owner and roles, no seeded units or categories.
4. **Initial sync**: every master record is pulled from cursor 0 in pages of 500 with progress, parents first. The result is checked (own branch present, Head Office present, no branch conflict).
5. Only then is the staging content copied into the live database in one transaction, the credentials are kept (encrypted with the database key, `cloud-auth.json`), the recovery key is shown once, and the sync worker starts without a restart.
6. Any failure before step 5 deletes the staging file and the stored credentials and leaves the live database untouched, so the owner can retry. A used enrollment code is spent: Head Office creates a new one.

### Measured

Initial sync of 53,000 items (2 pack units and 1 barcode each, plus the search index) against the in-memory cloud: about **59 to 69 s** on the shared development PC (106 pages of 500 events, about 1 ms per item), and search works right after. This measures the branch side only: a real network and a Postgres cloud add their own time per page. Test: `packages/db/src/sync/appliers/initial-sync.scale.test.ts` (skip with `SKIP_SCALE=1`).

### Limits

- **The cloud must treat `branches` as a master entity** (it is not in `DEFAULT_MASTER_ENTITIES` at the time of writing). Otherwise Head Office's branch list only reaches its own branch, a joining branch cannot learn who Head Office is, and the join stops with a clear message. The tests configure it.
- **The branch id must be the same at Head Office and in the cloud.** Head Office creates the branch row with its own id, and the cloud issues an id at enrollment. They must be equal; if they differ the join refuses ("Head Office and the cloud disagree about this branch") instead of half-working.
- Users and roles are not synced; racks are local; customers are not synced yet.
- An item update that reaches a branch before the item's insert (only possible after a reversed delivery across a page boundary) is reported as a conflict and not applied.
- Price ordering between two Head Office events uses the row's HLC (there is no per-field clock on the branch). A reversed pair is corrected; the one case that is not is a branch-local edit landing between two reversed Head Office price events.
- The runner retries a blocked type every cycle but does not show the wait in the status screen yet.

## What is tested

| Area                                                                                                                                                                                                                                                                                                                       | Where                                                                                                                                                             | Result                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Merge rules: LWW, order independence, per-field, Head Office price, void, replay                                                                                                                                                                                                                                           | `packages/sync/src/conflict.test.ts`                                                                                                                              | passing                                                                                           |
| Cloud rules: dedupe, scope, schema window, skew flag, epoch fencing, pull cursors and scope                                                                                                                                                                                                                                | `packages/sync/src/cloud-store.test.ts`                                                                                                                           | passing                                                                                           |
| HTTP adapter (typed errors, https rule) and adapter to endpoint round trip                                                                                                                                                                                                                                                 | `packages/sync/src/http-adapter.test.ts`, `apps/web/src/server/sync-cloud.test.ts`                                                                                | passing                                                                                           |
| Offline for days then catch up (300 events, totals match), lost responses, double delivery, reverse order, drop mid-batch, rejected events, clock skew, two branches editing one item, requeue after cloud restore, pull with failing apply and re-pull, hung cloud call                                                   | `packages/db/src/sync/sync-chaos.test.ts`                                                                                                                         | passing                                                                                           |
| Runner status, backoff, revoked token, backlog drain, POS not blocked, start/stop                                                                                                                                                                                                                                          | `packages/db/src/sync/runner.test.ts`                                                                                                                             | passing                                                                                           |
| Promotion, durable epoch, counter gap, fencing an old primary and tail export                                                                                                                                                                                                                                              | `packages/db/src/sync/failover.test.ts`                                                                                                                           | passing                                                                                           |
| Pairing codes and terminal devices                                                                                                                                                                                                                                                                                         | `packages/db/src/sync/pairing.test.ts`                                                                                                                            | passing                                                                                           |
| UDP discovery on loopback, packet validation, announce retry, pairing client, sealed token store                                                                                                                                                                                                                           | `apps/desktop/src/discovery.test.ts`, `pairing.test.ts`                                                                                                           | passing                                                                                           |
| Real HTTP smoke (manual, not a repeatable test): `next dev` branch server plus a scratch node cloud using the real `handleCloudPush`; first-run events reached the cloud, status, retry, pairing code, pair, reuse refused                                                                                                 | scratch run                                                                                                                                                       | worked                                                                                            |
| Same contract suite (26 cases, `branches` is master data: push, idempotency, scope, payload limits, skew, epochs, pull cursors, entity filter, tenant isolation, merge, Head Office price fields, void) on the in-memory store, on the PostgreSQL store over PGlite, and on the real `postgres` driver over a local socket | `packages/sync/src/cloud-store-contract.ts` run by `cloud-store-contract.test.ts`, `packages/db/src/sync/cloud/postgres-store.test.ts`, `postgres-driver.test.ts` | passing                                                                                           |
| The same suite against real Supabase, in a throwaway schema                                                                                                                                                                                                                                                                | `packages/db/src/sync/cloud/supabase.integration.test.ts`                                                                                                         | **skipped here** (host unreachable); runs when `MEDIESCARE_CLOUD_DATABASE_URL` answers within 5 s |
| Device auth: bootstrap once per name and re-attach, JWT expiry/tamper/foreign secret/revocation, refresh rotation, reuse revokes (also several rotations old), hashes only, enrollment codes (Head Office only, single use, simultaneous use, 24 h expiry, hashed, rollback on conflict)                                   | `packages/db/src/sync/cloud/device-auth.test.ts`                                                                                                                  | passing                                                                                           |
| Client: enroll, bootstrap, create code, refresh, rotating provider (first use, margin, sharing, revoked), 401 refresh-and-retry-once, encrypted token file                                                                                                                                                                 | `packages/sync/src/cloud-client.test.ts`                                                                                                                          | passing                                                                                           |
| Runner with tokens: revoked stops with no retry loop, network error is offline; initial upload (limits, order, progress, resume after crash and network loss) and 50,000 events into PGlite                                                                                                                                | `packages/db/src/sync/runner-cloud.test.ts`                                                                                                                       | passing                                                                                           |
| Two real branch databases through the real cloud HTTP handlers over HTTP into the PGlite store: bootstrap, code, enrol, push, pull (own events not echoed, no sales leaked), token rotation with 2 s tokens, offline then catch-up (120 events), revocation, re-attach, rate limit                                         | `packages/db/src/sync/cloud/e2e-http.test.ts`                                                                                                                     | passing                                                                                           |
| `next build` with `MEDIESCARE_MODE=cloud`, then `next start` on plain Node 22 (no Electron, so no SQLite could load): health, landing, 404 for every other route, bootstrap, enrollment code, enroll, push, duplicate, pull, refresh, reuse revokes                                                                        | manual run (scratch script, not a repeatable test)                                                                                                                | worked                                                                                            |

## What is NOT tested or built

- Real Supabase and Vercel: nothing ran there. Unknown until then: the exact TLS/pooler behaviour of the `postgres` driver against Supavisor (the search_path start-up parameter used by the integration test may need the Session pooler), Vercel cold-start and install time, `pnpm install --ignore-scripts` on Vercel.
- Initial sync of a fresh branch (snapshot as NDJSON, resume, progress) and per-entity appliers that write pulled master data into the local tables. Pull today only stores cursors and calls a plug-in applier.
- Dependency parking (holding a document event until its master row arrives): the cloud store accepts events in any order and does not check references.
- Standby replication and the "Promote this PC" and "re-join as standby" screens; the wizard UI for pairing; LAN detection of a newer epoch.
- Verify (row counts and rolling hash against the cloud), repair UI, and the conflict review screen (conflicts are written to the cloud `sync_conflicts` table, but nothing reads them yet).
- Row Level Security on the cloud tables (the cloud app connects with one role and checks tenant and branch in code), a screen to list and revoke devices (revoke with SQL today), the offline warning thresholds (24 h and 72 h) in the UI, automated retention (plan in [cloud-deploy.md](cloud-deploy.md)), (the grace window for a lost refresh response is built: 15 s).
- Load or performance measurements of the worker on a 100k-SKU database.

## What remains (in order)

1. Run it for real: Session pooler string, `pnpm cloud:migrate`, deploy, connect Head Office ([cloud-deploy.md](cloud-deploy.md)); fix whatever real Supabase and Vercel show.
2. Terminal pairing wizard, device-token auth for terminals, standby replication and the promotion screen.
3. Conflict review screen, repair buttons, devices screen (list and revoke), retention job.
