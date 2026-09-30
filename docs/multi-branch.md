# Two branches: Head Office HO01 and branch KHI02

How to set up the owner's two sites. Head Office (HO01, Karachi) keeps the catalogue and sets retail prices and tax rates for everyone. Branch KHI02 has its own PC, its own database and its own stock. The two only exchange data through the cloud. Technical background: [sync.md](sync.md#multi-branch-master-data), cloud setup: [cloud-deploy.md](cloud-deploy.md), stock transfers: [transfers.md](transfers.md).

**Status:** built and tested with an in-memory cloud and two real databases. It has not been run against a real cloud or on two real PCs yet. Test it with the real cloud before relying on it.

## What each site does

|                                             | Head Office HO01         | Branch KHI02                                                                             |
| ------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------- |
| Creates items, suppliers, categories, units | Yes                      | No items. It can add suppliers, and they reach Head Office                               |
| Sets price, sales tax, "price includes tax" | Yes                      | No. The fields are read-only ("Prices and tax rates are set by Head Office")             |
| Reorder level, allow negative stock, racks  | Its own                  | Its own (an item arrives with Head Office's reorder level once, then the branch owns it) |
| Sales, stock, bills, shifts                 | Its own books            | Its own books. They go up to the cloud and are never applied on the other site           |
| Users and roles                             | Its own                  | Its own (not shared yet)                                                                 |
| Stock transfers                             | Sends at cost, no margin | Receives at cost                                                                         |

## One-time set up

### 1. Head Office PC (HO01)

1. Install Mediescare. On the first screen choose **Create a new organisation**, branch code `HO01`. The first branch is always Head Office.
2. Write down the recovery key (shown once) and keep it away from the PC.
3. Enter or import the catalogue (Items, Excel import).
4. Connect the PC to the cloud: **Settings > Cloud sync > Connect to cloud** with the cloud address and the bootstrap code from the cloud administrator ([cloud-deploy.md](cloud-deploy.md)). Head Office uploads its whole history in the background; wait until the sync status shows nothing pending before adding the branch.

### 2. Add the branch at Head Office

1. Sign in with a **password** (a quick PIN cannot do this) as a user who may add branches (Super Admin and HO Admin can).
2. Open **Branches** in the menu (shown on the Head Office PC only). Press **Add a branch**, enter code `KHI02` and the branch name, press **Create code**.
3. The one-time code is shown **once**, with its expiry (24 hours) and the steps for the branch PC. Copy it or write it down. If it is lost or expires, press Add a branch again with the same code and name: a new code is issued and the branch is not added twice.
4. This needs the internet. If the cloud cannot be reached the branch is still added here and the screen says so: try again when the internet works.

### 3. Branch PC (KHI02)

1. Install Mediescare and open it. On the first screen choose **Join an existing organisation**.
2. Enter the cloud address, the enrollment code, your name, a username and a password (10+ characters).
3. Press **Join and continue** and **keep the PC online and the window open**. The screen shows how many items have been received. The first copy takes a few minutes for a large catalogue (about 1 minute for 53,000 items in the tests, plus the network time).
4. Write down the recovery key shown at the end, then sign in.
5. Check **Items**: the catalogue is there, prices are read-only, search works. Check **Branches** is not in the menu.

If something fails, the screen says what and nothing is left half-made: fix the cause (internet, wrong code, code expired) and press the button again. A code that the cloud already accepted is used up, so ask Head Office for a new one.

## Day to day

- Head Office changes a price, adds an item or a supplier. Within a few seconds (when both PCs are online) it appears on KHI02. If KHI02 is offline it catches up when it is back online, in any amount of backlog.
- A branch cannot change a price even by editing offline; a price that somehow differs is replaced by Head Office's price at the next sync, and the change is recorded in the audit log (`sync.apply`).
- Everything that is received is recorded in the branch's audit log. The audit hash chain still verifies.
- Nothing pulled from Head Office is ever sent back up.

## Things to know (limits)

- **Users and roles are not shared.** Create the branch users on the branch PC. Sharing them is a later step.
- **Racks are local.** Set racks on each PC.
- The cloud must pass the branch list to all branches and use the same branch record as Head Office. If the join says "Head Office and the cloud disagree about this branch" or "Head Office has not shared its branch list yet", tell the administrator who runs the cloud.
- A branch that already has its own units or items before joining cannot merge with Head Office's data. Join with a fresh installation.
- A joined PC cannot be turned back into a stand-alone PC from the screen.

## For the administrator

- Staging and retry: the join builds `mediescare.join.db` in the data folder and deletes it on success or failure. Deleting it by hand is safe when the app is closed.
- Credentials are in `cloud-auth.json` in the data folder, encrypted with a key derived from the database key. It is removed when a join fails.
- Tests: `packages/db/src/sync/appliers/multi-branch.test.ts` (two databases: flow down, duplicates, reversed delivery, crash between apply and cursor save, parent ordering, price rules, audit), `packages/db/src/sync/join-organisation.test.ts` (join, retry, failures), `packages/db/src/sync/branch-registry.test.ts`, and the 53,000-item timing in `packages/db/src/sync/appliers/initial-sync.scale.test.ts`.
