# Feature matrix: HCloud to Mediescare

Status: **Draft for approval.**

Sources: MASTER_PROMPT §5A and §6, plus all 39 pages (about 64 screenshots) of `docs/hcloud_screenshots.pdf`, each viewed. No real names, phones or emails from the screenshots are recorded here.

Legend for **Phase**: P1 foundation, P2 pharmacy core + POS, P3 multi-branch + sync + cloud, P4 users/HR/finance, P5 hospital, P6 hardening. **Src** shows where it was confirmed: `S` = seen in a screenshot, `M` = only in MASTER_PROMPT text (no screenshot), `S+M` = both.

## 0. What could not be read or was not in the screenshots

Be aware that §5A of the master prompt describes some screens that **are not in the PDF**. Those rows below are marked `M`, and their exact fields must be confirmed with the owner or HCloud before build.

| # | Item | Status |
|---|---|---|
| U1 | **Create menu** contents (quick-create dropdown) | Not visible in any screenshot. Only the button. A patient form appears opened from it (p37_4). Rest unknown. |
| U2 | **Tax** master (Preferences > Tax) | Menu entry only. Fields unknown. |
| U3 | **Message Templates** and **Message Settings** | Menu entries only. |
| U4 | **Racks, Tags** masters | Menu entries only. Columns unknown. |
| U5 | **Purchase Order**, **Stock Return**, **Stock Adjustment**, **Consume Stocks**, **Store Closing**, **Stock Suppliers**, **Manage Stock** screens | Menu entries only. Nothing beyond the Low Stock "PO" button. |
| U6 | **POS entry point** in the Pharmacy menu (menu item "POS") vs the Create Invoice page | Create Invoice seen. POS menu target not shown. The Pharmacy menu list has a scrollbar, so more entries may exist below POS. |
| U7 | **Update Practice** tabs: Patient, Print Format, Pharmacy, Shifts, Shares, Accounts | Only the Practice tab is seen. Shifts, print format, share/commission and pharmacy rules are unknown. |
| U8 | **Add New Stock** grid, right side | Cut off. Batch no., expiry, MRP, tax columns are not visible. The master prompt says they are needed. HCloud may not capture them the way we must. |
| U9 | Create Invoice **bottom buttons and payment area** | Partly covered by modals in two screenshots, fully visible in one (p23_2). Doctor, prescription, CNIC and narcotic capture are not on the screen. |
| U10 | **Dashboard**: only one full screenshot (p34_2) and one partial. | KPI cards: Total Sale Today, Net Cost of Sale, Gross Profit, Current Stock Value. Two charts. The prompt's "hourly revenue" and "customers" match. |
| U11 | **Messages** compose/sent/conversations tabs | Only the counters and tab names. |
| U12 | **Reports** submenu under More | Not expanded. |
| U13 | Financial report **Transaction** grid, right columns | Cut off after "Advance". |
| U14 | Icon meanings in the Items list, Patients list, and the three floating buttons | Too small to identify with certainty. |
| U15 | **Stock Statistics** and **Closing Revenue** right-hand columns | Beyond the visible edge. Later columns unknown. |
| U16 | Items list, first columns and three filter labels in one screenshot | Hidden by an open menu (a second screenshot shows the same list fully, so fields are known). |
| U17 | POS **shift open/close, float, blind count** | **Not present in HCloud screenshots at all.** Shifts appear only as reports with fixed time windows. This is new work for us, not a copy. |
| U18 | **Roster, attendance, payroll, leave** | Not in any screenshot (only the locked category "Payrolls"). M only. |
| U19 | **Purchase Order** printed/approval flow | Not shown. |
| U20 | **Deleted Invoices** tab in the Financial Report | Tab name only. Columns not seen. |

**Data-quality observations in the source screenshots** (design for these, do not copy them):

1. The same day shows **different "revenue" on different reports**: 3,884.36 (Transaction, Itemwise Revenue, Shift), 4,663.08 (Closing Revenue, Profit/Loss, Open Sale Returns), 4,663.07 (Manufacturerwise), and 0.0 (Income Statement). The gap equals one invoice. Mediescare must have **one definition of revenue** shared by every report, with a test that reconciles all reports for a given day.
2. Dashboard shows negative gross profit (cost of sale higher than sale) on a day that looks normal. Cost of sale must come from batch cost at time of sale.
3. Dead Stock list contains items sold within the last days. The rule must be explicit (no sale in N days, N configurable, default 90).
4. Low Stock list includes items whose units left are above the reorder level. The comparison unit (pack versus loose) is unclear. We compare in the smallest unit against a reorder level defined with its unit.
5. Invoice, voucher and document numbers are plain integers (109898 etc.) and MR numbers are sequential integers. Ours are branch-prefixed.
6. Item master: 53,820 rows, many with zero cost, blank category, and free-text barcodes. Import must validate, and flag rather than silently accept bad rows.
7. Per-line profit and average cost are visible on the POS invoice for whoever is logged in. We hide them by permission.
8. Expiry buckets are fixed 1, 3, 6 months. Ours are configurable (default 30/60/90/180 days).
9. Audit Log has only Date, User, Action. Ours has old/new values, device, branch, hash chain.
10. "Advance" shows `-0.0`. Money is integers, so negative zero cannot happen.
11. Typos in HCloud UI ("Attachement", "Costumer", "Maintainence"). Not copied.

## 1. Global shell and navigation

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| Top nav: Dashboard, Patients, Pharmacy, Preferences, More | S | Same structure (Customers instead of Patients until hospital). Modules toggled by feature flags | Branch switcher, offline/sync chip, Ctrl+K search | P1 |
| **Priority Modules** (4 pinned, rest in More, per user) | S | Same, stored per user | Also drag to reorder, default per role | P1 |
| User menu: User Settings, Priority Modules, Contacts, Billing, Support, Audit Log, Admin Settings, What's New, Logout | S | Same. Billing becomes optional Licence page | Add Lock screen | P1 |
| Create quick-create button | S (button), U1 | Create menu: Invoice, Stock/GRN, Customer, Expense, Missed Sale, Transfer request | Permission-aware entries | P1-P2 |
| Global search icon | S | Ctrl+K search across items, customers, invoices, documents | Instant local FTS | P2 |
| Notification bell + Notifications page | S | Notification centre (low stock, near expiry, sync errors, overrides, backups) | Local, no internet needed | P1 |
| What's New / Features and Updates | S | Release notes in-app (from updater) | Works offline (bundled) | P1 |
| Floating help/feedback/support buttons | S | Help drawer (user manual, shortcuts) | No overlay on data | P1 |
| Footer: Privacy, Terms, User Manual | S | Footer with version, branch, connection | | P1 |
| Red **SMS quota banner**, messaging suspended | S | Never. Messaging uses owner's gateway, queued offline | No quota lock (CLAUDE.md §12) | P4 |
| Language: English only | S | English + Urdu, RTL, per-user switch | Urdu fonts screen and print | P1 |
| Support tickets (practice id, contact, module, attachment, message) | S | "Report a problem": attaches logs and screenshot, exports a bundle | Works offline, sends when online | P4 |
| Billing details (period, amount, status, invoice due date, payment date, download) | S | Optional licence/subscription page (only if reselling, Q10) | Offline-verifiable licence | P1 stub, P6 |
| Contacts modal (account managers) | S | Contacts/About page | | P1 |

## 2. Dashboard

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| KPI: Total Sale Today, Net Cost of Sale, Gross Profit, Current Stock Value | S | Same four cards, sourced from ledger | Compare vs yesterday/last week, per branch, hide profit/cost by permission | P2 |
| Hourly revenue area chart with date picker | S | Same | Branch overlay, drill to invoices | P2 |
| Number of customers per day chart | S | Same (footfall) | Avg ticket size | P2 |
| (not in HCloud) | | Top items, low stock, near expiry widgets, cash/wallet split, cashier leaderboard | Extra | P2-P3 |
| (not in HCloud) | | Super Admin all-branches dashboard, branch leaderboard, drill company > branch > cashier > invoice | Extra | P3 |

## 3. POS: Create Invoice

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| Patient search by Name, MR#, Phone with "+" quick add | S | Customer search (name, MR#, phone) + quick add | Walk-in default without registration | P2 |
| Walk-in default customer (MR# 100001-style) | S | `is_walkin` default record per branch | | P2 |
| Item search by name | S | FTS5 search by name, generic, salt, barcode | Under 100 ms on 100k SKUs, barcode wedge | P2 |
| Line grid: Item, Units, Rack#, Select Batch, Disc. Price, Cost With Tax, Net Per Unit Cost, Rate, Avg Cost, Quantity (calculator), Amount, Net Amount, Discount, Tax, MS | S | Same grid. Cost columns behind `view_cost` | FEFO auto batch, expired batches blocked, unit-conversion entry | P2 |
| Batch dropdown `batch [qty]` | S | Batch picker with qty, expiry, days left badge | Expired greyed and unselectable | P2 |
| Live Profit/Loss, Sub-Total, Discount, Total Tax, Grand Total | S | Same. Profit only with `view_profit` | | P2 |
| Total Discount with value / % switch | S | Same, role limits and PIN override | | P2 |
| Payment: date-time, mode, Cash Received, + Add Payment (split), Due, Cashback, Advance | S | Same. Modes configurable (cash, card, wallet, bank, QR, credit) | Split tender, change display, advance use | P2 |
| Repeat checkbox | S | Repeat/refill flag creating a reminder | Refill reminders | P2 |
| Invoice Note (configurable default text) | S | Per-branch default note, printed | | P2 |
| Hold Invoice / Hold & Print | S | Server-side holds visible from all terminals | Shared across counters | P2 |
| Save / Save & Print (format dropdown) | S | Same, formats: 80 mm, 58 mm, A4, A5 | Thermal first, Urdu bitmap | P2 |
| Send Payment Notification checkbox | S | Queued SMS/WhatsApp via own gateway | Never blocks the sale | P4 |
| + Add Stock shortcut on POS | S | Shortcut to GRN (permission based) | | P2 |
| + Invoice Return (enter complete invoice #) | S | Return against original invoice, line/batch level, reason code | Restock or damage, credit note | P2 |
| + Add Last Order, + Copy Last Invoice | S | Same | Per-customer last order | P2 |
| **Missed Sale** modal (SR, Item, Unit, Qty, Phone, Supplier) and per-line MS button | S | Same. Feeds Low Stock and PO suggestions | Missed Sales report, demand ranking | P2 |
| Source recorded (POS), created-by, timestamps | S | Same plus terminal id, shift id | | P2 |
| No doctor/prescription/narcotic capture visible on screen | S (absent), U9 | Doctor, patient, CNIC, prescription image capture, narcotic register | Compliance hard-stop for controlled items | P2 |
| (not in HCloud) | | Manager PIN override, expiry hard-block, negative-stock rule, hold across terminals, customer display, cash drawer kick, day open/close | Extra | P2 |
| (not in HCloud) | | Fiscal (FBR/provincial) hook | Optional module | P6 or later, Q5 |
| (not in HCloud) | | Loyalty, home delivery/order intake, credit customers with limits and aging | Extra | P3-P4 |

## 4. Item master (Pharmacy Items)

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| Buttons: Add Multiple Items, Add New Item, Add Item List (bulk import), Add Stock | S | Add item, Add multiple (grid entry), Import Excel/CSV with validation report, Add Stock | Import dry-run with error report | P2 |
| Filters: date, name, supplier, manufacturer, category, unit, default/practice item, stock/all, stock level, active/inactive, rack | S | Same filters, server-side | Saved filters | P2 |
| Excel, Print | S | Same via exceljs and print pipeline | | P2 |
| Columns: Status toggle, Dead Item, Name, Generic Name, Barcode, Category, Manufacturer, Suppliers, Stocking Unit, Conversion Unit, Unit Cost, Retail Price, Reordering Level, Available Qty, Expired Qty, Narcotic, Rack#, actions (edit, view, print) | S | Same columns, customisable. Cost column behind `view_cost` | Multi-barcode per item, per-unit conversions | P2 |
| Categories incl. Medications, Featured Medicines, OTC, Medicine, Wellness and Beauty + retail | S | Category tree for pharma and general retail | | P2 |
| Multiple suppliers per item | S | `item_suppliers` | Last cost per supplier | P2 |
| Racks, Tags, Manufacturer masters | S (menu), U4 | Same masters | | P2 |
| B2B category, item type "Default" | S | `b2b_category`, `item_type` fields | Confirm meaning with owner | P2 |
| 53,820 items with bad data | S | Import validator, duplicate barcode detection | | P2 |
| (not in HCloud) | | Salt-based substitution search, price history, mass price update with approval, barcode label print, prescription/cold-chain/DRAP fields, images | Extra | P2-P3 |

## 5. Purchasing and stock

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| Add New Stock (GRN): auto document no., date, supplier (+quick add), supplier invoice no./date, attachments, item search | S | GRN with the same header | Branch-prefixed number, offline attachments | P2 |
| Grid: SR#, Items, Manufacturer, B2B category, Rack, Conversion Unit, Shelf/Reorder level (in pack), Unit, Available Qty, Quantity, Loose Unit Qty, Bonus Qty, Avg Cost, Unit Cost, ... | S (partial, U8) | Same, plus **batch no., expiry, MRP, trade price** (mandatory) | Batch/expiry on every line | P2 |
| Footer: Discount, Sales Tax, Advance Tax, WHT (value or %), totals, Stock Note | S | Same. Landed cost allocation of freight/tax | Configurable tax classes | P2 |
| Purchase Order (from Low Stock "PO" per item or "Add Order" bulk) | S (button), U5 | PO create, approve, partial receive | Auto-suggest from min/max, velocity, missed sales | P2 |
| Stock Return (to supplier) | S (menu), U5 | Purchase return with supplier credit note and expiry claims | Claim tracking | P2 |
| Stock Suppliers | S (menu), U5 | Supplier master | NTN/STRN, credit terms | P2 |
| Manage Stock | S (menu), U5 | Stock overview by branch, store, rack, batch | | P2 |
| Stock Adjustment | S (menu), U5 | Adjustment document with reasons and approval | Ledger based | P2 |
| Consume Stocks | S (menu), U5 | Internal consume/wastage document | | P2 |
| Store Closing | S (menu), U5 | Period/day-end stock closing snapshot | Valuation snapshot | P2 |
| Low Stocks report with Collect All / Add Order / PO | S | Low Stock with reorder suggestions, bulk PO | Uses velocity and missed sales | P2 |
| Bill Payments and Opening Balance Payments (supplier dues) | S | Supplier payments, opening balances | Payment scheduling, PDC cheques | P2-P4 |
| (not in HCloud) | | Head Office main store, requisition, transfer note, dispatch, in-transit, receive with shortage/damage, return to HO | Core P3 requirement | P3 |
| (not in HCloud) | | Stock take (scan-based, cycle counts), FEFO, valuation FIFO/weighted average, ABC/VED | Extra | P2-P3 |

## 6. Pharmacy reports hub (21 tabs)

All need: date range, filters, Excel, Print, column customisation, and the shared revenue definition.

| # | HCloud report | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|---|
| 1 | Transaction | S | Transaction report with the same filters (invoice/patient, item, source, order#, payment mode) and KPI | Void/refund status, drill to invoice | P2 |
| 2 | Narcotic | S | Narcotic register report | Add CNIC, batch, prescription ref (HCloud has none) | P2 |
| 3 | Income Statement | S | Income statement (revenue, stock payments, expenses, net) | Fix inconsistency seen in source (shows 0.0) | P2 |
| 4 | Doctorwise Sales | S | Same | Share/commission calculation | P2 |
| 5 | Itemwise Revenue | S | Same with top-10 chart | Margin | P2 |
| 6 | Low Stocks | S | Same | Unit-aware, suggestions | P2 |
| 7 | Purchase Reports (KPIs paid, dues, advance tax, WHT) | S | Same, plus Sales Tax column (HCloud shows none) | | P2 |
| 8 | Open Sale Returns | S | Sale returns report | Reason codes | P2 |
| 9 | Discounts (incl. "Sales with 100% discount") | S | Same | Approver, override link | P2 |
| 10 | Profit/Loss Statement | S | Same | Expenses, tax, branch split | P2 |
| 11 | Dead Stock | S | Same, configurable days | Clear rule | P2 |
| 12 | Expiry | S | Expiry by batch | Write-off action | P2 |
| 13 | Stock Statistics (7 KPIs, wide grid, Audit Excel without dead items) | S | Same | Valuation methods | P2 |
| 14 | Pending Payments | S | Customer dues and aging | Statements, reminders | P2 |
| 15 | Manufacturerwise Sales | S | Same | Purchase qty actually filled (HCloud shows 0.0) | P2 |
| 16 | Stock Expiry Report (Expired, 1, 3, 6 months; batch popover) | S | Expiry buckets configurable (30/60/90/180) | Print button (HCloud lacks) | P2 |
| 17 | Closing Revenue (12 KPIs, per-invoice profit) | S | Day-close report | Ties to shift Z report | P2 |
| 18 | Hold Invoices (resume/delete) | S | Same | Cross-terminal | P2 |
| 19 | Shift (inflow, outflow split stock/other expenses) | S | Shift report, configurable shifts | Float, blind count, variance | P2 |
| 20 | Itemwise Purchase Margin | S | Same | | P2 |
| 21 | Itemwise Sales Margin (HCloud has quantity only, no margin) | S | Real margin columns | Batch cost based | P2 |

## 7. Financial report hub (9 tabs)

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| Transaction (Total Revenue, Cash, Advance, Refund, Tax, hourly chart, Referred By, insurance columns) | S | Same, insurance columns hidden until hospital modules | | P2 (P5 insurance) |
| Shift | S | Shift totals | | P2 |
| Staff | S | Collection per user | | P2 |
| Payment Mode (pie and table) | S | Same | | P2 |
| Pending Payments (department, creditor type) | S | Receivables | | P2 |
| Advance Payments | S | Same | | P2 |
| Deleted Invoices | S (tab), U20 | Voided invoices with reason, user, time | Never physically deleted | P2 |
| Refund Report (reason, refunded by) | S | Same | Override link | P2 |
| Cost Per Patient | S | Cost per customer | | P3 |

## 8. Accounts and expenses

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| Expenses list (Voucher#, Employee, Description, Date, Category, Amount, Payment Mode, Created, actions) with filters and pie chart | S | Same, immutable vouchers, void instead of delete | Approval, attachments, budgets | P2 basic, P4 full |
| Expenses Summary by category | S | Same | | P2 |
| Add Expense (Description, Invoice no, Date, Category, Mode, Amount, Asset upload) | S | Same | Camera capture of receipt | P2 |
| Bill Payments and Opening Balance Payments | S | Supplier payments | | P2 |
| Expense Categories: custom + locked system categories (Doctor's Share, Procedure Expenses, Stock Bill Payment, Payrolls, Income Tax, Supplier Opening Balance, Lab Outsourced Tests, Referral Payment) | S | Same model (`is_system`, locked) | System categories added per module as it ships | P2 |
| Petty cash, recurring expenses, budgets | M | Same | Extra | P4 |
| Full double-entry accounting | M | Chart of accounts, vouchers, journals, trial balance, P&L, balance sheet | Depth to confirm (Q4) | P4 |

## 9. Customers

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| List (MR#, Patient, Gender, Phone, Registered) with filters, Add, bulk add, Advanced Search, Customize | S | Same | Duplicate detection | P2 |
| Add Patient modal (MR# auto, Name, country code + phone, Additional Information) | S | Same | Multiple phone numbers | P2 |
| Profile: photo, gender, MR#, external ID, phone, Edit, Add Invoice, Tags, Relationships (+ old), Download Patient, Family History, Last Invoice | S | Same (family history limited until hospital) | Data export for the customer | P2 (P5 clinical) |
| Row actions: view, invoices, message, delete | S (icons unclear, U14) | Same. Delete is soft. | | P2 |
| Credit customers, limits, aging, loyalty | M | Same | Extra | P3-P4 |

## 10. Users and settings

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| Users grouped by role tabs; Active toggle, Name, Email, Phone, Last Signed In, Edit; search; Add User | S | Same | Branch assignment, device binding, force logout | P1 |
| Roles seen: Accountant, Admin, Pharmacist, Quality Control Manager | S | Full role set plus custom | Granular RBAC | P1 |
| User Settings: practice/branch selector, change email, change password, enable 2FA | S | Same | Optional TOTP, PIN | P1 |
| Update Practice: Practice tab (Name, Phone, Address, Area, License No., NTN No.) | S | Branch profile | | P1 |
| Update Practice: Patient, Print Format, Pharmacy, Shifts, Shares, Accounts tabs | S (names), U7 | Same settings groups per branch | Fields to confirm | P1-P2 |
| Audit Log (date range, user, action; Date, User, Action) | S | Audit log with old/new value, device, branch, hash chain | Verify-chain tool | P1 |
| Tax master (Preferences) | S (menu), U2 | Tax classes (Sales Tax, Advance Tax, WHT) | Effective dates | P1-P2 |
| Two-factor authentication | S | TOTP | | P1 |

## 11. Messaging

| HCloud feature | Src | Mediescare equivalent | Improvement | Phase |
|---|---|---|---|---|
| Messages: available/free/paid counters, Buy SMS package, Compose, Sent, SMS/WhatsApp conversations | S | Message centre using own gateway | No packages, no quota, queue offline | P4 |
| Message Templates, Message Settings | S (menu), U3 | Templates with variables, per-event toggles | English/Urdu templates | P4 |
| Notifications page | S | Notification centre | | P1 |

## 12. Things in the master prompt that HCloud does not show (new work)

These are not "copy" items. They are the reason for the rewrite. All are `M`.

| Feature | Phase |
|---|---|
| Offline operation, local DB, LAN branch server, terminals | P1-P3 |
| Sync engine (outbox, cursors, HLC), cloud Postgres | P1 skeleton, P3 full |
| Multi-branch, HO main store, requisition/transfer/receive with in-transit | P3 |
| Configurable shifts, cashier float, blind count, X/Z reports, roster, attendance, payroll, leave | P2 (shifts), P4 |
| Granular RBAC, field-level rules, discount/refund limits, manager PIN | P1-P2 |
| Batch/expiry enforcement, recall by batch, cold-chain log, licence expiry alerts | P2-P3 |
| Tamper-evident audit, backups (encrypted, scheduled, restore, external drive, cloud) | P1 |
| Report builder, saved filters, scheduled exports | P6 (basic saved filters P2) |
| Bilingual UI, Urdu receipts | P1, P2 |
| Hospital modules (patients, appointments, OPD, EMR, IPD, ER, OT, LIS, RIS, billing, accounts, other services) | P5 |
| Interoperability (HL7/FHIR, webhooks) | P5-P6 |
| Installer, auto-update, activation | P1, P6 |
