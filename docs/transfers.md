# Head Office to branch stock transfers

Status: built and tested with two databases (Head Office and a branch) exchanging events through the **in-memory fake cloud**. No real cloud was involved. The screens compile and pass typecheck and lint but were **not clicked through in a browser or the packaged app** by the author.

Owner decisions this follows: Head Office HO01 is the main store that buys from suppliers, branch KHI02 (and later others) gets stock from it. Transfers are **at cost** (the source batch's cost, no inter-branch margin). Accounting is basic cash-flow level: the transfer documents carry the values, there are no double-entry postings.

## Workflow

```
Branch                     Head Office
requisition  ────────────▶ approve (may lower quantities)
(submitted)                   │
                              ▼
                          transfer note (draft): batches picked first-expiry-first, editable
                              │
                              ▼  dispatch
                          transfer_out rows leave the HO ledger
                          goods are IN TRANSIT: on the document, in nobody's stock
receive ◀─────────────────────┘
(received / damaged / short)
   │ transfer_in into the branch ledger (same batch no., expiry, cost)
   └──────────────────────▶ Head Office sees the receipt after sync
```

## Documents and states

| Document              | States                                                            | Moves forward by                                                           |
| --------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Requisition (`REQ`)   | `submitted` → `approved` → `fulfilled`; `submitted` → `cancelled` | approve, dispatch of a note written from it, cancel (before approval only) |
| Transfer note (`TRF`) | `draft` → `dispatched` → `received`; `draft` → `cancelled`        | dispatch, receive, cancel (before dispatch only)                           |

- **A status never moves back.** The database enforces it with triggers (migration `0010`): posted documents cannot be edited or deleted, line quantities and batches are frozen, requisition lines can only be approved while the requisition is still `submitted`, and a receipt must add up (received + damaged + short = dispatched).
- Nothing is corrected by editing. A cancelled requisition (before approval) or note (before dispatch) is replaced by a new document. **After dispatch there is no cancel**: what arrived is counted at receipt, the rest is damage or shortage.
- Document numbers come from the branch counter: the requisition is `KHI02-REQ-000001` (written at the branch), the note is `HO01-TRF-000001` (written at Head Office).

## Who can do what

| Action                               | Branch that may do it            | Permission                      |
| ------------------------------------ | -------------------------------- | ------------------------------- |
| Create requisition                   | a branch that is not Head Office | `inventory.requisition.create`  |
| Approve requisition                  | Head Office                      | `inventory.requisition.approve` |
| Cancel requisition (before approval) | the asking branch or Head Office | `inventory.requisition.create`  |
| Write a transfer note                | Head Office                      | `inventory.transfer.create`     |
| Cancel a note (before dispatch)      | Head Office                      | `inventory.transfer.edit`       |
| Dispatch                             | Head Office                      | `inventory.transfer.approve`    |
| Receive                              | the receiving branch             | `inventory.transfer.create`     |
| View, reports                        | either side                      | `inventory.transfer.view`       |
| Print the A4 note                    | either side                      | `inventory.transfer.print`      |
| Stock ledger check                   | this branch                      | `inventory.stock.view`          |

The branch side is decided by the database the server runs on, not by the client: a branch server can only approve, dispatch or cancel documents whose shipping side is itself, and only receive transfers addressed to it. The permission keys are the existing ones; default role grants are unchanged (Store Keeper has view, create and print, so a Store Keeper can write requisitions and receive; approving and dispatching need a role that holds `approve`, for example the Branch Manager or Super Admin, or a custom role).

## Picking batches

- `suggestTransferBatches` picks first-expiry-first from the batches with stock. **Expired and blocked batches are never offered and never accepted**, and a line can never be larger than the batch's stock. The same checks run again at dispatch, so a batch that expired or was used up between writing and dispatching is refused and nothing is posted.
- The picker shows every batch with why a batch cannot be chosen (expired, blocked, empty). The quantity can be split over several batches (one line per batch).
- From an approved requisition, the approved quantities are picked automatically. An item that is not fully in stock is included with what exists and the screen says what is missing. The note can never carry more than was approved.
- Two drafts can be written on the same stock; the second dispatch is refused when the stock is gone.

## Accounting at cost

- Every line carries the source batch's `cost_unit_micro`. The line value is `qty x cost`, rounded once to paisa. The dispatched value is stored on the note when it is written and cannot change.
- At receipt the line value is split into received, damaged and short value with the largest-remainder method, so **received + damaged + short always equals the dispatched value to the paisa**.
- The branch batch is created (or reused when the same batch number, expiry and cost exist) with the **transfer cost**. Profit on later sales is therefore computed from that cost.

## Receiving: received, damaged, short

Per line the branch enters how many arrived good and how many arrived damaged. **Short is the rest** (nothing arrived). Defaults: everything received.

| Part     | Stock effect at the branch                                                                                                                   | Money                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Received | `transfer_in` on the branch batch                                                                                                            | goes to the branch's stock value               |
| Damaged  | `transfer_in` for the units that physically arrived, then an `adjustment` of the same size written off at once, so they never count as stock | recorded as a **loss at cost** on the document |
| Short    | none                                                                                                                                         | recorded as a **loss at cost** on the document |

- There is no separate "damaged store" in the stock figures (stock is the sum of movements per batch across stores), so damaged units are written off rather than parked. The note text and the audit entry say why.
- A transfer can be received **once**. A second attempt is refused, and Head Office cannot receive its own shipment.
- Damage and shortage are **not** charged back to anyone automatically. Both branches show them as a loss in the position report. Deciding whether the carrier or Head Office carries it is a manual step today.

## Inter-branch position

`GET /api/transfers/reports/position` (and the cards on the Reconciliation tab), per other branch and as totals, at cost: value **dispatched**, **received**, **in transit**, **damaged**, **short**, and the **difference** (dispatched minus everything accounted for, zero when the books agree). It is computed from the transfer documents on the local database. Head Office learns of a receipt only after the branch has synced, so until then Head Office shows the goods as in transit while the branch already shows them received. After sync both sides agree.

## Reconciliation and ledger check

- `GET /api/transfers/reports/reconciliation` (filters: branch, item, status, dates): per transfer and per item, dispatched against received, damaged, short and in transit, with value at cost, and a flag when a transfer does not balance. It lists at most the newest 2000 transfers.
- `verifyStockLedger` (`GET /api/stock/ledger-check`, `inventory.stock.view`): recomputes every batch balance from `stock_movements` and flags batches below zero, movements pointing to a missing batch, movements on another branch's or item's batch, and movements whose sign contradicts their kind. Read only: stock is never a stored number, so a finding is corrected with an adjustment, a return or a recount, never by editing history.
- Cost fields in every response are named `cost`, `costUnitMicro`, `costValueMinor`, so the existing field-level stripping removes them for roles without the cost right. Quantities stay visible.

## Sync behaviour

- Entity types `stock_requisitions` and `stock_transfers`. Every change writes an outbox row in the same transaction. The payload is the **whole document** (header, lines, and for information the ledger rows it posted), so each event stands alone and delivery order does not matter.
- Appliers (`packages/db/src/sync/appliers/transfers.ts`, order `APPLY_ORDER.documents`):
  - A requisition created at a branch is applied at Head Office. Its approval, cancellation or "fulfilled" comes back to the branch. States only move forward; an older or equal state is skipped.
  - A **dispatched** transfer is applied at the receiving branch as a document to receive (every line needed to count the goods), with **no stock movement**. Drafts and cancelled notes stay private at Head Office and the branch ignores them.
  - A **receipt** posted at the branch is applied at Head Office (updates received, damaged and short per line and the values). Head Office never posts a stock movement for it: its `transfer_out` was posted when it dispatched.
  - Pulled changes never write the outbox and never post a stock movement. Each branch posts its own ledger rows.
  - Events for other branches or other organisations, and events that cannot be read, are skipped. An event that needs an item or branch that has not arrived yet throws `DependencyMissing`, so the pull waits at that event and retries on the next cycle (tested).
- Tested: double delivery, reversed delivery (cancel before create, dispatch before draft), full re-pull (`resetCursors`), an older state arriving late, a branch that receives while offline and Head Office catching up three days later.

## Limits and things to know

- Receiving needs the dispatch to have reached the branch through the cloud. With no internet between Head Office and the branch nothing can be received (dispatch at Head Office still works). There is no LAN shortcut.
- A requisition cancelled by the branch at the same moment Head Office approves it ends with each side keeping the state it reached first. The transfer that follows still works on its own. This is rare and is not merged automatically.
- One transfer note per requisition (partial shipments are written as a note for what is in stock; the rest needs a new requisition). Approved quantities cannot be raised above the request.
- A transfer of stock that expires in transit is still received (it physically arrived). Mark it as damaged at receipt if it cannot be sold.
- A branch whose database is rebuilt from the cloud gets dispatched transfers back, but its own earlier receipts are not re-applied to its ledger (initial sync of a fresh branch is not built, see `sync.md`).
- Return transfers (branch sends goods back to Head Office), transfer prices other than cost, and the claim against the carrier are not built.
- Messages and screens are English only for now.
- Not tested against a real Postgres or cloud.
