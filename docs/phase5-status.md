# Status: cloud sync, multi-branch and Urdu screens

Last updated 2026-10-01. Builds on `phase4-status.md`.

## Owner decisions in force

Free of cost only (Supabase free, Vercel free or any free Node host). Head Office HO01 (Karachi) and branch KHI02. Head Office sets retail prices and tax rates. Transfers at cost, no margin. Basic cash-flow/P&L accounting only (not built yet). No FBR integration. 80 mm USB thermal printer, RJ11 drawer, USB keyboard-wedge scanner, English receipts. Hospital modules out of scope. Code signing skipped (the installer is unsigned).

## Checks run

Lint and typecheck clean. Tests: core 97, sync 78, db 397 (28 skipped: real-Supabase and scale tests), web 253, desktop 40. `pnpm verify:packaged`: 177 smoke checks against the real packaged app, including every screen in Urdu over real HTTP. `pnpm test:e2e` passes.

`pnpm bench`: search 7 ms, barcode 1 ms, invoice save 6 ms and stock list 172 ms at normal machine speed. When measured again the whole PC ran about 2x slower (every metric doubled, including ones this work did not touch) and the stock list measured 350 ms against the 300 ms budget. Re-run on a quiet PC to confirm.

## Built

- Cloud sync (see `sync.md`, `cloud-deploy.md`, ADR-0013): Postgres cloud store, device tokens, enrollment codes, cloud mode, first upload.
- Pull side and branch join (see `multi-branch.md`): appliers, Head Office pricing, `/branches`, join screen. First pull of 53,000 items: about 65 s in the test.
- Transfers (see `transfers.md`): requisition, approval, transfer note, dispatch, receive with damage and shortage, positions, reconciliation, ledger check.
- Urdu on all screens (see `i18n.md`). Receipts and printed documents stay English.

## Not yet verified on the real thing

Real Supabase (needs the free Session pooler string: the direct host is IPv6-only and this PC has no IPv6), the Vercel deploy (needs the owner's login; Vercel Hobby is personal and non-commercial, so any free Node host that allows commercial use also works), two real PCs, a real printer and drawer, and the Urdu layout on screen (nobody has looked at it in a browser).

## Decisions still open

1. Damaged goods at transfer receipt are written off immediately instead of sitting in a damaged store.
2. Damage and shortage are a loss at cost, not charged to either branch.
3. Store Keeper can request and receive, but not approve or dispatch.
4. Strict refresh-token reuse detection (an honest device can be revoked if a response is lost; reconnecting fixes it). A short grace window can be added.
5. Cloud retention: the free 500 MB fills in about 2 to 6 months for three branches; cleanup is documented, not automatic. Does the owner want cloud reports or backup only?
6. A supplier's opening balance on a branch starts at 0; its credit limit is copied once.
