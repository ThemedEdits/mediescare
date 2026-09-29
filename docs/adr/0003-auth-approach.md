# ADR-0003: Offline-capable authentication

Status: **Proposed** (needs approval). Date: 2026-09-30.

## Context

Login must work with no internet, on a LAN of terminals talking to a branch server, with PIN login for the POS and optional 2FA. CLAUDE.md fixes: custom auth, argon2, signed session cookies with jose, PIN login, optional TOTP, and no provider that needs the internet. This ADR fills in the details.

## Decision (proposed)

1. **Passwords:** argon2id, parameters tuned so a login takes roughly 150-300 ms on the 4 GB reference PC (starting point: 19 MiB memory, 2 iterations, 1 lane). Verified in the server process only. Minimum 10 characters, offline breached-password list, forced change on first login and after reset. The native module (`argon2` or `@node-rs/argon2`) must have Windows/Electron prebuilds. That is **not yet verified** and is part of the Phase 1 spike. Fallback: a WebAssembly implementation.
2. **Sessions:** server-side session row (revocable, so "force logout" works) plus a **signed, HttpOnly, SameSite=Lax cookie** using jose with a per-install secret. Idle timeout configurable (default 30 min). Lock screen is separate from logout.
3. **Terminals use two credentials.** The **device token** (issued at pairing, stored in the OS credential store via Electron `safeStorage`) proves the machine. The **user session** proves the person. Revoking a device stops it at once.
4. **PIN login (POS):** 4-6 digits, stored as a separate argon2id hash, usable only from a paired terminal at that user's branch, only for POS and lock-screen unlock. Five wrong attempts lock the PIN for 15 minutes. Admin screens require the password. The **approver PIN** for manager override is a separate credential ([permissions-matrix.md §6](../phase0/permissions-matrix.md)).
5. **TOTP 2FA (optional):** RFC 6238, secret encrypted at rest, ten one-time recovery codes. **Required** for Super Admin and HO Admin (proposal). Not required for cashier PIN login.
6. **CSRF:** SameSite cookies, origin check, and a per-session token on state-changing requests.
7. **Rate limiting** per device and per username, in memory on the branch server, lockouts written to the audit chain.
8. **Cloud mode:** device tokens and user sessions verified the same way. Branch operations never need the cloud. Password and role changes made at HO reach branches through sync (users, roles and credentials are HO authoritative, [sync-design.md §6](../phase0/sync-design.md)).
9. **Audit:** every login, failure, lockout, PIN or password change, 2FA change and override goes to the hash-chained audit log.
10. **No external identity provider.** Optional later: SSO for cloud mode only, never required by branches.

## Consequences

- A user created at HO can log in at a branch only after the next sync. Super Admin can also create users directly at the branch server.
- The per-install secret is generated at first run and wrapped like the DB key ([ADR-0001](0001-sqlite-encryption.md)).
- Password hashes sync to the cloud so users can log in at any branch. They are argon2id hashes, never plaintext, and the channel is TLS.
