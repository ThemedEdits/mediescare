# ADR-0012: Cloud database (Supabase as plain PostgreSQL) behind a swappable adapter

Status: **Accepted for Phase 1 design, implemented in Phase 3.** Date: 2026-09-30.

## Context

The owner chose **Supabase** as the cloud provider and asked for it "with built-in Auth, Realtime and multi-tenant support", wrapped behind a swappable adapter. CLAUDE.md §3 forbids Supabase Auth (and any service that breaks offline mode) without an ADR and approval, and ADR-0003 designs offline-capable custom auth.

## Decision

1. **Use Supabase as managed PostgreSQL only.** Drizzle connects to Postgres directly. Application code never imports a Supabase SDK, so the provider stays swappable (Neon, a VPS, or plain Postgres need only a new connection string).
2. **Do not use Supabase Auth.** Branch logins must work with no internet, so users, roles and password hashes are ours (ADR-0003) and reach the cloud through sync. Using Supabase Auth for branches would break the offline requirement. This deviates from the owner's wording ("built-in Auth") on purpose. Supabase Auth could still serve a future **cloud-only** web dashboard, but that needs a separate decision.
3. **Realtime:** branches use SSE/WebSocket on the LAN (architecture.md §4). Supabase Realtime is optional later for cloud dashboards. Nothing in a branch depends on it.
4. **Multi-tenancy:** every synced table already carries `tenant_id` (data-model.md §1). The cloud endpoint checks tenant and branch scope on every event. Postgres Row Level Security is added as a second layer in Phase 3 (needs the connection to run as a restricted role, not the service role).
5. **Adapter:** `CloudAdapter` (`packages/sync/src/outbox.ts`) is the only interface the sync worker knows. The Supabase/Postgres implementation is a Phase 3 deliverable. Phase 1 ships the interface, the worker, and a test double.
6. **Secrets:** the cloud connection string lives in `MEDIESCARE_CLOUD_DATABASE_URL` (server only). Never in the desktop app for terminals.

## Consequences

- The Postgres schema in `packages/db/src/schema/pg.ts` is what Supabase will host. A parity test keeps it aligned with SQLite.
- Region and monthly cost still need the owner's input (open question 5 was answered with the provider, not a budget or region).
- If the owner insists on Supabase Auth for branches, offline login would need a cached-credential design, which weakens CLAUDE.md's requirement. Not recommended.
