# ADR-0013: Cloud sync store on PostgreSQL, device authentication, free-tier hosting

Status: **Accepted (built, tested on PGlite; not yet run on real Supabase or Vercel).** Date: 2026-10-01. Builds on ADR-0012 and ADR-0004.

## Context

The owner requires the whole system to cost nothing: Supabase free (PostgreSQL) and Vercel Hobby (the cloud-mode Next.js app). The branch side and the cloud rules existed against an in-memory store. Missing: a durable store, device credentials (owner decision 4: short-lived JWTs rotated with a refresh token), the first upload of an existing database, and a cloud-mode runtime. The Supabase direct host is IPv6-only on the free plan, so the real database cannot be reached from the development PC.

## Decisions

1. **One contract, several stores.** `CloudStore` has three implementations that pass the same suite (`runCloudStoreContract`): `InMemoryCloudStore`, `PostgresCloudStore` on PGlite, and `PostgresCloudStore` on a real database (runs only when reachable, in a throwaway schema). PGlite (free WebAssembly PostgreSQL) is the development and test database; it is loaded lazily and never by the desktop app.
2. **`SqlClient` interface** (query, exec, transaction) with two drivers: PGlite and `postgres` (porsager, `prepare: false`, TLS on for non-local hosts). JSON parameters are sent as text and cast (`$n::text::jsonb`) because postgres.js would otherwise encode a string twice for a jsonb parameter (found by running the suite through the real driver).
3. **Cloud tables are plain SQL** (`packages/db/cloud/NNN_*.sql`, `pnpm cloud:migrate`), not Drizzle tables, so they stay out of the SQLite/PostgreSQL parity test. Forward-only.
4. **Concurrency and cost.** One transaction per push batch: a per-tenant advisory lock makes `seq` (the pull cursor) commit in order, so a puller never skips a row; the branch `epochs` row is locked `FOR UPDATE` (failover fencing). Bulk statements (`jsonb_to_recordset`) keep a 500-event batch at about eight round trips, inside Vercel's 10 s limit.
5. **Device auth.** Access token: JWT HS256, 15 minutes, claims device, tenant, branch, checked against `devices` on every request (instant revocation). Refresh token: random, only its hash is stored, rotates on every use; reuse of an already used token revokes the device, except within a 15-second grace window after the rotation (only the newest three retired tokens qualify; the token is rotated again), so a lost response does not revoke an honest device. Enrollment codes: 80 random bits, hashed, 24 h, single use. First Head Office PC: bootstrap code from an environment variable, once per organisation name. A database that already exists sends its own tenant, branch and device ids, which the cloud adopts, because the events in its outbox carry them and the cloud checks them on every event. A new branch takes the ids the cloud issues.
6. **Credentials on the branch server** are kept in `cloud-auth.json` in the data folder, AES-256-GCM encrypted with a key derived from the database key. The shell keeps that key sealed with the OS credential store (DPAPI), and the server process (Electron's Node runtime, where `safeStorage` does not exist) is the one that rotates and saves the refresh token.
7. **Cloud mode** serves only `/`, `/api/health` and `/api/sync/*` from modules that never import the SQLite runtime; all else is rewritten to 404 by `next.config.ts` (needs `MEDIESCARE_MODE=cloud` at build time).
8. **Retention** of the 500 MB free database is a documented manual plan (docs/cloud-deploy.md), not automated.

## Consequences

- Strict replay detection can revoke an honest device if a refresh response is lost at the wrong moment; recovery is reconnecting (local data untouched). A grace window is a possible later change.
- Rate limits are in memory per serverless instance.
- Vercel Hobby's non-commercial clause is an open owner decision (docs/cloud-deploy.md).
- The Session pooler string must be supplied by the owner before anything can be verified on real Supabase.
