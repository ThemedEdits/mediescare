# ADR-0016: User accounts and roles sync from Head Office to every branch

Status: **Accepted (owner request 2026-10-14).** Builds on ADR-0003 (offline auth), ADR-0012/0013 (cloud sync).

## Context

A user created at Head Office could not sign in at a branch PC. Accounts, roles and their links were already uploaded to the cloud (as backup), but the cloud did not forward them and branches had no code to apply them. Each branch only knew its own accounts.

## Decision

1. **Head Office owns accounts.** `roles`, `users`, `user_roles` and `user_branches` are master entities in the cloud (`DEFAULT_MASTER_ENTITIES`), so every branch receives them. A branch applies them **only when they come from the Head Office branch** (`fromHeadOffice`). Accounts and role edits made at a branch stay on that branch: one stolen or compromised branch PC cannot create a Super Admin for the whole organisation.
2. **Head Office wins every account field**, whatever the device clocks say (logins update the local row's clock). Only an older copy of an event the same Head Office device already applied is dropped.
3. **Per-PC fields stay local:** failed-login counter, lock-out, last login time and the personal menu (`priorityModules`).
4. **Roles are matched by code.** Every PC creates the standard roles at first run with its own ids. The first Head Office event for a role re-keys the local role of the same code to Head Office's id (role, its permissions and the users holding it move together). The Super Admin role's permissions are never rewritten by a pull.
5. **A Head Office account wins its username.** A different local account with the same username (typically the owner typed while joining a branch) is renamed `<name>-local` and keeps its password and roles. The rename is recorded as a sync conflict in the audit log.
6. Password hashes (argon2) travel inside the organisation: cloud (already the case) and every branch database (encrypted at rest, ADR-0001). PINs too.
7. Signing in at a branch also needs branch access: give the user that branch (or "All branches") on the Users screen at Head Office.

## Consequences

- Change passwords, roles and account status at Head Office; it reaches every branch on the next sync. A password changed at a branch PC applies only on that PC (a later Head Office password reset overrides it).
- A branch PC must have synced at least once after the account was created (internet needed once); after that, sign-in works offline.
- Found while building this: `fromHeadOffice` remembered "not Head Office" for a branch it had not received yet within the same pull batch, so the first Head Office events of a new branch (including price changes) could be treated as branch events. Fixed: only answers for known branches are memoised.
- Verified: `accounts-sync.test.ts` (two real databases through the sync path) and `pnpm cloud:check` step "a user account made at Head Office reaches the branch" against the real Supabase.
