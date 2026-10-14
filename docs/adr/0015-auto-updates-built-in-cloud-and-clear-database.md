# ADR-0015: Auto-updates from GitHub Releases, built-in cloud address, Super Admin "Clear database"

Status: **Accepted (owner decisions 2026-10-14).** Builds on ADR-0007, ADR-0012 and ADR-0013.

## Context

The owner asked for three things:

1. Installed apps should learn about a new version when code is pushed to `github.com/ThemedEdits/mediescare`, and install it with a restart, with no reinstalling.
2. The Supabase database should be the built-in backend, "hardcoded" into the software.
3. A Super Admin-only button in Settings that clears the whole database, with a double confirmation.

The repository is **public**. Releases are therefore downloadable by anyone, and everything in an installer can be extracted.

## Decisions

### 1. Auto-updates (electron-updater + GitHub Releases)

- `electron-builder.yml` has `publish: github ThemedEdits/mediescare`, `releaseType: release`. The repository is public, so the app reads releases without a token.
- CI (`.github/workflows/ci.yml`, job `release`) runs on every push to `main` after lint, typecheck, tests, packaging and the packaged smoke and E2E tests pass. It sets the version to `major.minor.<run number>` (`scripts/ci-version.mjs`), builds the NSIS installer and publishes a GitHub Release with `latest.yml`. Bump major or minor in `apps/desktop/package.json` by hand.
- The app (`apps/desktop/src/updater.ts`) checks 30 s after start and every 4 hours, and on **Help > Check for updates**. It asks before downloading, shows taskbar progress, then offers **Restart now** (stops the local server, silent install, relaunch) or **Later** (installs when the app closes). No internet means a silent, retried failure: nothing in the app waits for it.
- Database schema changes ship as forward-only migrations; the server already takes a `pre_migration` backup before applying them on start.
- Not code-signed: Windows SmartScreen warns on the first manual install. electron-updater only checks the publisher when one is configured, so updates still apply. Buying a code-signing certificate is an open owner decision.
- `MEDIESCARE_DISABLE_UPDATES=1` switches updates off (smoke test, E2E).

### 2. Built-in cloud: the address, never the database password

- The owner's first request was to put the Supabase connection string (with the `postgres` password) into the app. **Rejected, and the owner agreed:** with a public repository and public releases, anyone could extract it and read, change or delete every branch's data. This is also the rule of ADR-0012 §6.
- Instead, `DEFAULT_CLOUD_URL` in `packages/config/src/index.ts` is the address of the deployed cloud-mode app (docs/cloud-deploy.md). The "Connect to cloud" and "Join an existing organisation" forms are pre-filled with it. The database password stays on the cloud host only; branches keep using revocable device tokens.
- It is empty until the cloud app is deployed. A guessed domain could belong to someone else and would receive bootstrap and enrollment codes.
- The Supabase project used from 2026-10-14 is `wnxhubouuedzwgfptsta` in `ap-south-1` (Mumbai). Its direct host is IPv6-only, so `.env` and the cloud host use the Session pooler (`aws-0-ap-south-1.pooler.supabase.com`, user `postgres.<project-ref>`). A `@` in the password must be written `%40` in the URL.

### 3. Clear database (Super Admin)

- Visible in Settings only to a user holding the **Super Admin role** (not merely every permission) who signed in with a password, not a PIN. The server checks all of this again: `POST /api/settings/clear-database` needs a session, `admin.backup.create`, the Super Admin role, the typed phrase `DELETE ALL DATA` and the user's password.
- Two confirmations: a warning dialog, then the phrase and the password.
- Order: an audit entry `database.clear` → a verified backup of kind `pre_reset` (so the backup records who cleared it) → stop sync and background jobs → close the database → delete `mediescare.db` (+ WAL/SHM) and `cloud-auth.json`. The recovery keyring and the database key are kept, so the backup can be restored from the Mediescare menu with the same recovery key. The next request opens an empty database and the app shows first-run setup, with no restart.
- Scope: **this PC only** (owner choice). Cloud data is not touched. Paired terminals must pair again.

## Consequences

- Every push to `main` that passes CI reaches every installed app. A broken commit that passes the tests also reaches them; keep work on branches and merge when ready.
- Until `DEFAULT_CLOUD_URL` is set and the cloud app is deployed, users still type the address once.
- Clearing is irreversible on this PC except through the backup. A Super Admin password is a single point of protection; keep it strong.
