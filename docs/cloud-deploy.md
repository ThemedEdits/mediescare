# Cloud deployment (free tier): Supabase + Vercel

The whole cloud side must cost nothing: **Supabase free** for PostgreSQL, **Vercel Hobby** for the cloud-mode Next.js app. Branch PCs keep working with no internet; the cloud only receives their changes and hands out Head Office master data. Design: [sync.md](sync.md), [ADR-0012](adr/0012-cloud-adapter-supabase.md), [ADR-0013](adr/0013-cloud-sync-store-and-device-auth.md).

**Status, honestly:** everything below was built and tested against PGlite (PostgreSQL in WebAssembly) and against the real `postgres` driver over a local socket. It has **not** been run against a real Supabase database or deployed to Vercel: the connection string in the repository `.env` is the Supabase _direct_ host, which is IPv6-only on the free plan and unreachable from the development PC, and deploying needs the owner's Vercel login. The steps below are what the owner has to do; the first real run may still show small differences.

## 1. Get the Session pooler connection string (required, this is what is missing today)

The free plan's "Direct connection" (`db.<project-ref>.supabase.co`) only has an IPv6 address. Many PCs, and Vercel, cannot reach it. Use the IPv4 pooler instead:

1. Open the Supabase dashboard, your project, click **Connect** (top bar).
2. Choose **Session pooler** (not "Direct connection", not "Transaction pooler").
3. Copy the string. Its shape is `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. Replace `[YOUR-PASSWORD]` with the database password (Project Settings > Database > reset password if you forgot it).
4. Put it in the repository `.env` as `MEDIESCARE_CLOUD_DATABASE_URL=...` (the file is git-ignored; never paste it in chat, tickets or commits).

The Transaction pooler (port 6543) also works with this code (prepared statements are off), and is the better choice on Vercel if you ever hit "too many connections" on the Session pooler (free plan: about 15 session connections shared by everything; each cloud instance keeps at most 3). Start with the Session pooler.

If the host is unreachable, the app and `pnpm cloud:migrate` say so in plain words and point here; the message never contains the password.

## 2. Create the cloud tables

```
# .env needs MEDIESCARE_CLOUD_DATABASE_URL (step 1)
pnpm cloud:migrate
```

It applies `packages/db/cloud/*.sql` (tenants, branches, devices, enrollment_codes, sync_events, entity_heads, push_batches, epochs, sync_conflicts). Safe to run again; applied files are skipped. These tables are plain SQL, not Drizzle tables, and are not part of the SQLite/PostgreSQL parity test.

## 3. Secrets to choose

| Variable                          | What to put                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MEDIESCARE_CLOUD_JWT_SECRET`     | 32+ random characters. Signs the 15-minute device access tokens. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`                                                                                                                              |
| `MEDIESCARE_CLOUD_BOOTSTRAP_CODE` | Any long random text. Typed once on the first Head Office PC. Anyone who knows it and the cloud address can create an organisation, so keep it private; remove it from Vercel after setup to switch bootstrap off (re-attaching the same Head Office PC later needs it again). |

## 4. Deploy to Vercel (owner steps; I could not do this, it needs your login)

1. Push the repository to GitHub (private).
2. vercel.com > **Add New > Project** > import the repository.
3. **Root Directory:** `apps/web`. Keep "Include source files outside of the Root Directory" **on** (the app needs `packages/*`). Framework: Next.js (detected). `apps/web/vercel.json` already sets the install command (`cd ../.. && pnpm install --frozen-lockfile --ignore-scripts`), build command, and a 10 s function limit for the sync routes. `--ignore-scripts` skips the Electron download and native builds that the cloud does not need; if the build complains about a missing native binary, remove that flag.
4. **Environment variables** (Production, and they must also be available at build time, which is Vercel's default):

   | Name                              | Value                                 |
   | --------------------------------- | ------------------------------------- |
   | `MEDIESCARE_MODE`                 | `cloud`                               |
   | `MEDIESCARE_CLOUD_DATABASE_URL`   | the Session pooler string from step 1 |
   | `MEDIESCARE_CLOUD_JWT_SECRET`     | from step 3                           |
   | `MEDIESCARE_CLOUD_BOOTSTRAP_CODE` | from step 3                           |

   `MEDIESCARE_MODE=cloud` is read when `next build` runs: it switches on the rewrites that answer 404 for everything except `/`, `/api/health` and `/api/sync/*`. Forgetting it at build time deploys the whole branch UI, which then fails with 500 because there is no SQLite in the cloud. Redeploy after changing it.

5. Project Settings > Functions > **Function Region:** pick the region closest to your Supabase project (for example both in Frankfurt) to keep each database round trip short.
6. Deploy, then open `https://<your-project>.vercel.app/api/health`. Expected: `{"status":"ok","app":"Mediescare","mode":"cloud",...}`. The address `/` shows a one-line landing page; every other path answers 404.

## 5. Connect the Head Office PC

On the Head Office PC: **Settings > Cloud sync > Connect to cloud.** Enter the cloud address (`https://<your-project>.vercel.app`), the bootstrap code and the organisation name, then Connect. The PC keeps its own branch, device and organisation ids (the cloud adopts them so the history already in its outbox is accepted), then uploads **everything written since the database was created** in batches of at most 500 events / 1 MB, with a progress bar. It can be interrupted (power cut, internet loss) at any time and continues where it stopped. Measured in-process against PGlite: 50,010 events in about 8 s; over the real internet each batch costs about eight database round trips plus one HTTP call, so budget roughly 1 s per 500 events (about 100 s for 50,000) on a healthy connection.

A new branch: Head Office creates an **enrollment code** (valid 24 h, works once) for it; the new PC enters the cloud address and the code on its setup screen. Branches never know the bootstrap code.

Disconnect (same screen) stops syncing and forgets the cloud login on that PC. Nothing local is deleted. Reconnect the Head Office PC with the same form (the cloud recognises its ids and issues fresh credentials).

## 6. Free-tier limits and what to do about them

| Limit (verify on the provider pages, they change)                      | Effect                                                                                                                                                                                 | What to do                                                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Vercel Hobby **is for personal, non-commercial use** in Vercel's terms | A pharmacy chain using Hobby for business may breach the terms and the account can be suspended                                                                                        | Owner decision, see below                                                                                                        |
| Vercel function time (designed for 10 s; `maxDuration` is set to 10)   | A push batch must finish in 10 s: batches are capped at 500 events / 1 MB, about 8 round trips                                                                                         | Keep the function region next to Supabase                                                                                        |
| Vercel request body limit 4.5 MB                                       | Batches are capped at about 1 MB; one event may be at most 512,000 characters of JSON                                                                                                  | Nothing                                                                                                                          |
| Supabase free database **500 MB**                                      | About 620 bytes per tiny event measured (30.9 MB for 50,039 events including indexes); real sales with lines are larger, plan 1.5 to 3 KB. 500 MB is roughly 160,000 to 800,000 events | Retention plan below                                                                                                             |
| Supabase free project **pauses after 7 days of inactivity**            | Sync stops (branches queue everything safely); the dashboard offers "Restore"                                                                                                          | Branches sync every 5 s while open so it stays awake; before a long closure open the dashboard or send a request once a few days |
| Session pooler: limited concurrent connections on free                 | Each cloud instance uses at most 3                                                                                                                                                     | Switch to the Transaction pooler string if "too many connections" appears                                                        |
| In-memory rate limits                                                  | Per warm serverless instance, not global: a brake, not a quota                                                                                                                         | Nothing                                                                                                                          |

**Decision for the owner:** Vercel Hobby's non-commercial clause. Options that keep the cost at zero: run the cloud-mode app on another free host that allows commercial use (for example a free-tier container or VM service), or accept the Hobby terms risk, or pay for Vercel Pro later. The app is host-neutral: `MEDIESCARE_MODE=cloud` with the four variables runs anywhere Node runs (`pnpm cloud:dev` locally).

### Retention and compaction plan (500 MB)

Branches keep their own full history; the cloud copy exists for backup, consolidated reports and onboarding new branches. The plan, not automated yet (nothing runs it for you):

1. **Never delete master-data events** (`items`, `suppliers`, `customers`, `categories`, `manufacturers`, `racks`, `units`, `payment_modes`, `branches`). A new branch builds itself by replaying them; `entity_heads` only holds the merge state. They grow with edits, not sales, so they stay small.
2. **Documents** (sales, returns, purchases, ledger rows...): keep 90 days in `sync_events`. A branch offline longer than that can still upload (its events are accepted whenever they arrive), and its own database is the master copy. Older document events can be deleted once consolidated reports exist (Phase 5) or exported:
   ```sql
   DELETE FROM sync_events
   WHERE received_at < now() - interval '90 days'
     AND entity_type NOT IN ('branches','items','suppliers','customers','categories','manufacturers','racks','units','payment_modes');
   ```
   Run in batches (add `AND seq IN (SELECT seq FROM sync_events WHERE ... LIMIT 20000)`) and then `VACUUM (ANALYZE) sync_events;` (plain `VACUUM` in the Supabase SQL editor). Pull cursors are `seq` numbers, so deleting old rows never breaks a device's cursor.
3. `push_batches` older than 30 days, used or expired `enrollment_codes` older than 30 days, `sync_conflicts` older than 180 days: delete freely.
4. Check the size monthly: `SELECT pg_size_pretty(pg_database_size(current_database()));` and `SELECT relname, pg_size_pretty(pg_total_relation_size(oid)) FROM pg_class WHERE relname IN ('sync_events','entity_heads','sync_conflicts') ;`
5. If 500 MB is still not enough (3 branches at 3,000 events a day reach it in about 2 to 6 months without step 2), the next step is a summary table (daily totals per branch) replacing old document events: owner decision, together with what reports the cloud must answer.

## 7. Local development of the cloud side (no Supabase needed)

```
pnpm cloud:dev        # cloud mode on http://localhost:3220 with PGlite in data/cloud-pglite
```

Development values: bootstrap code `dev-bootstrap-code` and a fixed development JWT secret (they replace anything in `.env` on purpose). Point a dev branch server at `http://localhost:3220` from Settings > Cloud sync. `MEDIESCARE_CLOUD_STORE=postgres pnpm cloud:dev` uses the real database from `.env` instead.

## 8. Security notes

- Device access tokens live 15 minutes (JWT HS256) and are checked against the `devices` table on every request, so revoking a device (set `devices.revoked_at`) takes effect at once.
- Refresh tokens are random, stored only as SHA-256 hashes, and rotate on every refresh. Presenting a token that was already used revokes the device: a copied token cannot be used quietly. **Risk to know:** if a refresh response is lost on the way (power cut at exactly that moment), the device holds a dead token and the next refresh looks like a replay; the device is revoked and must be reconnected (Settings shows "Disconnected by cloud"; the local data and queued events are untouched). This is the price of strict replay detection; a grace window could be added if it happens in practice.
- Enrollment codes: 80 random bits, stored as hashes, 24 h, single use, at most 20 unused codes per organisation.
- The bootstrap code, enrollment codes and refresh tokens are rate limited, compared in constant time or hashed, and never logged.
- Revoke a stolen device: `UPDATE devices SET revoked_at = now() WHERE id = '<device id>';` in the Supabase SQL editor.
