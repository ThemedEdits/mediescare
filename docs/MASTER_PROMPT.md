# MASTER PROMPT — MEDIESCARE (Hospital + Pharmacy Management System)

> Copy everything below this line and paste it into your AI coding tool (Claude Code / Cursor / etc.).
> Attach: (1) logo + icon ZIP folder, (2) `hcloud_screenshots.pdf` (40+ reference screenshots of HCloud, my current software).
> Section 5A below is a detailed breakdown of those screenshots. Treat it as the minimum baseline, then go beyond it.

---

## 0. ROLE & GOAL

You are a senior full-stack architect and lead engineer with deep experience in healthcare ERP, pharmacy POS, offline-first desktop apps, and multi-branch data synchronization.

Build **Mediescare**, a complete, production-grade **Hospital Management System (HMS) with a full Pharmacy Management + POS module**, delivered as an **installable desktop application** that works **100% offline** with a **local database**, and **syncs to a cloud database** whenever internet is available.

The reference product is **HCloud (https://hcloud.pk/)**, a Pakistani cloud HMS. I currently use it and have attached screenshots of its screens (`hcloud_screenshots.pdf`). Study them and the HCloud module list (Clinic, Hospital, Pharmacy, Laboratory, Radiology, Dental, Aesthetics; Billing, IPD, Emergency, OT, HR & Payroll, Inventory, Patients, EMR, Appointments), then **match and exceed** every feature. My requirement is **A-to-Z coverage of every feature a real hospital/pharmacy uses**, with nothing left as a placeholder.

**Product name:** Mediescare (use this exactly in UI, installer, window title, receipts, reports, and database/app identifiers).

---

## 1. BRANDING (MANDATORY)

- A ZIP folder with the **logo and icon files is attached**. Extract and use them for: app icon (window, taskbar, installer, shortcuts), login screen, sidebar header, printed invoices/receipts/reports, and PDF exports.
- Generate all required icon formats from the supplied files (`.ico` for Windows, `.icns` for macOS, `.png` sizes for Linux).
- **Extract the primary and secondary colors directly from the logo** (sample the actual pixels, do not guess) and define them as design tokens (`--color-primary`, `--color-secondary`, plus tints/shades and hover/active/disabled states).
- **Background is white** (`#FFFFFF`) with a very light neutral for surfaces/cards. Text in dark neutral. Use primary for main actions and active navigation, secondary for accents and highlights.
- Clean, modern, professional healthcare look. Generous spacing, clear hierarchy, fast to scan. Consistent components across all modules.
- Fully **bilingual: English + Urdu**, with RTL support for Urdu and a language switch per user. Urdu-capable font (e.g. Noto Nastaliq Urdu / Jameel Noori compatible) for UI and printouts.

---

## 2. TECH STACK (FIXED: Next.js; see CLAUDE.md for the full stack and rules)

- **Desktop shell:** Electron + electron-builder (Windows installer primary), with auto-updater. Electron starts the Next.js standalone server (branch-server/single mode) or loads it over LAN (terminal mode).
- **App framework / frontend:** **Next.js (App Router) + TypeScript**, Tailwind CSS, shadcn/ui, TanStack Table/Query, React Hook Form + Zod, next-intl (English/Urdu, RTL).
- **Local backend inside the app:** Next.js route handlers/server actions running in the standalone server, with business logic in a shared pure-TypeScript core package.
- **Local database:** SQLite in WAL mode (better-sqlite3) via Drizzle ORM or Prisma, with migrations. (Alternative: embedded PostgreSQL if concurrency demands it; explain the choice.)
- **Cloud database:** PostgreSQL (Supabase, Neon, or self-hosted on a VPS; make the provider swappable behind a sync adapter).
- **Cloud API:** the same Next.js app deployed in `cloud` mode (Postgres), exposing sync endpoints with JWT/session auth, RBAC enforcement, and per-tenant isolation.
- **Printing:** ESC/POS thermal (58mm/80mm), A4/A5 PDF, barcode/label printers. **Barcode scanner** (keyboard-wedge + camera fallback). Cash drawer kick support.
- **Testing:** unit + integration + sync-conflict tests + Playwright E2E for critical flows (sale, return, transfer, GRN, sync).

---

## 3. ARCHITECTURE — OFFLINE-FIRST, MULTI-USER, MULTI-BRANCH (MOST CRITICAL PART)

### 3.1 Requirements
1. **Complete offline operation.** Every feature works with zero internet. Internet is only needed for cloud sync, updates, and optional integrations.
2. **Multiple users at the same time** in the same branch (e.g., 3 POS counters + purchase desk + admin) without data corruption, even offline.
3. **Multiple branches**, each with its own local data, all syncing to one cloud database.
4. Installable desktop application with a **local database**, and **background sync to cloud DB**.

### 3.2 Recommended topology (implement this)
- **Branch Server mode:** at each branch, one PC is installed as the *Branch Server* (hosts the local DB + embedded API + sync worker). Other PCs in that branch install as *Terminal/Client mode* and connect over the **LAN** to the Branch Server (auto-discovery via mDNS/UDP broadcast, or manual IP). This gives real multi-user concurrency while fully offline.
- **Single-PC mode:** one machine can run Server + Client together for small branches.
- **Cloud:** the source of truth for cross-branch reporting, super-admin analytics, and head-office visibility.
- Installer must ask on first run: *Head Office / Branch Server / Branch Terminal / Single PC*, then guide through activation and branch binding.

### 3.3 Sync engine
- **Outbox pattern:** every write is stored locally and appended to a durable `sync_outbox` (entity, operation, payload, hlc timestamp, device id, branch id). A background worker pushes when online with retry + exponential backoff and is **idempotent**.
- **Pull** changes per entity with a per-branch `sync_cursor`. Support **initial full sync**, **delta sync**, and **resync/repair** tools.
- Use **UUIDv7/ULID primary keys** (never auto-increment) and a **hybrid logical clock** for ordering.
- **Conflict rules (document and implement):**
  - Master data (products, prices, suppliers): last-writer-wins with version check + audit trail, head office wins on price policy fields.
  - **Stock is NOT synced as a number.** Stock is derived from an **append-only stock ledger** (movements). Sync the movements, recompute balances. This prevents overselling drift between branches.
  - Financial documents (invoices, payments, vouchers) are **immutable once posted**. Corrections happen through reversal/return/credit-note documents, never edits.
  - Document numbers use **branch-prefixed sequences** (e.g., `KHI-01-INV-000123`) so offline branches never collide.
- **Sync status UI:** online/offline indicator, last sync time, pending item count, error log, manual "Sync now", and conflict review screen.
- Data **encrypted at rest** (SQLCipher or OS-level) and **in transit** (TLS). Encrypted local backups.
- **Automatic local backup** (scheduled, rolling retention) + one-click restore + export to external drive. Also cloud backup.

### 3.4 Head Office → Branch stock flow (REQUIRED)
- **Head Office Main Store** receives all purchases first (PO → GRN → stock in Main Store).
- Branches get stock through **Inter-Branch Transfer / Stock Issue** from Head Office (and optionally branch-to-branch):
  1. Branch raises **Stock Requisition/Indent** (or HO pushes supply proactively).
  2. HO approves and creates **Transfer Note / Delivery Challan** (batch- and expiry-wise picking, FEFO suggestion).
  3. Status flow: `Draft → Approved → Dispatched (In-Transit) → Received (partial/full) → Closed`, with **shortage/damage/rejection** handling at receiving end.
  4. Stock leaves HO on dispatch, sits in an **In-Transit** ledger, and enters branch stock on receipt. Full audit trail and printable challan with barcodes.
  5. Transfer at **cost price** (or configurable transfer price) with inter-branch accounting entries.
- Reorder-level based **auto-suggested requisitions** per branch. Return-to-HO flow for near-expiry/excess stock.

---

## 4. USERS, ROLES & PERMISSIONS (SCALE TO MAXIMUM)

### 4.1 Super Admin
- Can **log in to every branch** (Head Office and all others) and **switch branch context instantly**, and can view a **consolidated "All Branches" mode** as well as any **individual branch**.
- Sees **all analytics and all financial data**: sales, purchases, profit/margin, expenses, receivables/payables, cash/bank, stock valuation, tax, for **all branches combined and per branch**, with comparisons.
- **Manages all users and roles** across all branches: create/edit/disable users, assign roles, branches, shifts, permissions; reset passwords; force logout; view login history and audit logs.

### 4.2 Roles (predefined + fully custom)
Super Admin, Head Office Admin, Branch Manager, Pharmacist (Sr./Jr.), Cashier, Store Keeper, Purchase Officer, Accountant, HR Manager, Doctor, Nurse, Receptionist, Lab Technician, Radiologist, OT Coordinator, Auditor (read-only), Custom roles.

### 4.3 Permission model
- **RBAC with granular permissions** down to `module.resource.action` (view / create / edit / delete / approve / print / export / override-price / give-discount / void / refund / backdate / view-cost / view-profit).
- **Branch-scoped access** (user can access one, some, or all branches), and **field-level** restrictions (e.g., cashier cannot see purchase cost).
- **Discount limits, refund limits, and price-override limits per role** with **manager approval via PIN/override** when exceeded.
- Optional **2FA**, password policy, session timeout, lock screen, quick PIN login for POS counters, and device/branch binding.
- Full **audit log** of who did what, when, where (old/new values) — tamper-evident.

### 4.4 Staff, shifts & expense management (scaled to the max)
- **Employee master** (CNIC, contacts, documents, emergency contact, qualifications, licenses, joining/exit, bank details, branch, department, designation).
- **Shift management:** define shifts (morning/evening/night/split), **weekly/monthly roster & rotation planner** (drag-and-drop), shift swap requests + approval, overtime, holidays, leave calendar, coverage warnings for understaffed shifts.
- **Attendance:** manual, biometric device integration (ZKTeco or similar), late/early/absent rules, integration with payroll.
- **Cashier shift handling:** **open/close shift** with opening float, **blind cash count**, denomination count, X-report/Z-report, shortage/excess tracking per cashier, handover between shifts.
- **Payroll:** salary structures, allowances, deductions, advances/loans, commissions/incentives, overtime, tax, payslips, bank sheet export, payroll journal to accounts.
- **Leaves:** types, balances, requests, approvals.
- **Expense management:** categories/sub-categories (rent, utilities, salaries, transport, maintenance, marketing, misc), **petty cash**, per-branch and head-office expenses, recurring expenses, approval workflow, attachments (photo of receipt), budgets vs actual, expense vouchers, allocation to branches, and reports.

---

## 5. PHARMACY MODULE + POS (COMPLETE A–Z)

### 5.1 Product / Item master
- Generic name, brand name, salt/composition, strength, dosage form, pack size/units (strip, box, bottle, piece — **multi-UOM with conversions**), manufacturer/company, category/sub-category, rack/shelf location, barcode(s), HSN/tax class, DRAP registration no., **controlled/narcotic/psychotropic flag**, prescription-required flag, cold-chain flag, storage conditions, reorder level/min/max, images, active/inactive.
- **Batch & expiry tracking** on every item (batch no., mfg date, expiry date, purchase rate, MRP, trade price, sale price per batch). **FEFO** picking by default.
- **Pricing:** MRP, trade price, retail, wholesale, tiered/customer-group pricing, promotions, bulk import/export (Excel/CSV), price history, mass price update with approval, bar-coded labels printing.
- **Generic substitution:** search by salt and show alternatives/substitutes with stock and price.
- Product interaction/allergy warnings hook (optional drug database integration).

### 5.2 Point of Sale (fast, keyboard-first)
- Sub-second product search (name/generic/salt/barcode/partial), barcode scanning, hold/recall bills, multiple open carts, quick keys, F-key shortcuts.
- Unit/strip/loose-tablet selling, batch auto-select (FEFO) with manual override, expiry warnings, **block sale of expired items**, near-expiry alerts.
- Discounts (item/bill/%/fixed, role-limited), taxes, rounding, **multiple payment methods** (cash, card, JazzCash/Easypaisa/bank transfer/QR, credit/account, split payments), advance/deposit, change calculation.
- Customer & patient linking, doctor/prescription reference, prescription image attach, **controlled-drug sale register** with mandatory patient/doctor/CNIC capture.
- Returns/refunds/exchanges against original bill (reason codes, restock or damage), credit notes, void with approval, reprint, duplicate copy marking.
- Print **80mm/58mm thermal receipt** and A4 invoice, with logo, branch details, tax info, QR code; **WhatsApp/SMS/email receipt** when online.
- **Fiscal/tax integration hook** for Pakistan (FBR/provincial sales-tax POS integration as an optional pluggable module).
- Customer display, cash drawer, day-open/day-close, shift reports.
- Home delivery / online-order intake, credit customers with limits and aging, loyalty points and membership cards, refill reminders.
- **Full offline operation** — POS must never block waiting for network.

### 5.3 Purchasing & procurement
- Supplier master (contacts, terms, credit limit, NTN/STRN, bank), price lists.
- **Purchase Requisition → Purchase Order (approval) → GRN (Goods Receipt) → Purchase Invoice → Payment**, with partial receipts, batch/expiry capture, barcode label printing on receipt, freight/tax/discount allocation, landed cost.
- **Purchase returns** (expired/damaged/wrong item) with supplier credit notes, expiry-return claims tracking.
- Auto-suggest reorders from min/max, sales velocity and seasonality. Supplier comparison/rate history.
- Purchase happens at **Head Office**; distribution to branches via transfers (see 3.4). Branches can optionally purchase locally if permission is granted.

### 5.4 Inventory & stock control
- Real-time stock by **branch → store → rack → batch**. Multiple stores per branch (main, counter, cold room, quarantine, damaged, expired).
- **Append-only stock ledger**, stock adjustment with reasons and approval, stock take/physical count (scan-based, cycle counts, variance report), opening stock import.
- Expiry management dashboards (30/60/90/180 days), dead/slow/fast-moving analysis, ABC/VED analysis, reorder alerts, overstock alerts, stock valuation (FIFO / weighted average), stock aging.
- Inter-branch transfer, requisition, dispatch, receiving (see 3.4). Breakage/wastage/sample/free-issue documents.

### 5.5 Controlled drugs & compliance
- Controlled/narcotic register (auto-maintained), prescription retention, batch recall workflow (find every sale of a batch and notify), drug license and staff pharmacist license expiry alerts, cold-chain temperature log, audit-ready reports, full traceability from supplier → batch → customer.

### 5.6 Customers, suppliers & accounts receivable/payable
- Customer ledger, credit sales, receipts, aging, statements, reminders. Supplier ledger, payables, payment scheduling, cheque management (PDC), statements.

### 5.7 Reports (target 100+, all exportable to PDF/Excel/CSV and printable)
Sales (daily/monthly/item/category/cashier/branch/payment-mode/customer/doctor), sales returns, purchase, purchase returns, stock (current/valuation/movement/ledger/aging/expiry/near-expiry/reorder), profit & margin (item/category/branch/cashier), discount reports, tax reports, cash-flow, day-book, cashier shift reports, controlled-drug register, supplier/customer ledgers & aging, expense reports, payroll reports, transfer reports (in-transit, shortage/damage), audit logs, user activity, and a **custom report builder** with saved filters and scheduled email/WhatsApp delivery.

---

## 5A. REFERENCE SPEC — WHAT MY CURRENT SOFTWARE (HCLOUD) DOES, SCREEN BY SCREEN

This is extracted from my screenshots. Mediescare must replicate **every** item below, then improve on it. (Business context: a Karachi-based retail pharmacy with a Head Office user and a branch, using fixed shifts, cash + mobile-wallet payments, walk-in customers, and 50,000+ SKUs in the item master.)

### 5A.1 Global navigation & shell
- Top nav: Dashboard, Patients (customers), Pharmacy, Preferences, More (Messages, Reports, Users), a green/blue **Create** button (quick-create menu), global search, notifications bell, "What's New" announcements, user menu.
- **Priority Modules:** each user picks 4 modules pinned in the top bar; the rest go under "More". Keep this personalization.
- **User menu:** User Settings, Priority Modules, Contacts, Billing, Support, Audit Log, Admin Settings, What's New, Logout.
- **Pharmacy dropdown:** Items, Manage Stock, Stock Return, Purchase Order, Missed Sales, Racks, Tags, Consume Stocks, Store Closing, Stock Adjustment, Stock Suppliers, POS.
- **Preferences dropdown:** Expense Categories, Message Templates, Message Settings, Tax.
- Floating quick-action buttons (bottom-right) for help/feedback/support. Footer with Privacy, Terms, User Manual link.
- **Pain point to fix:** HCloud shows a red banner and *suspends messaging* when the SMS quota is reached. Mediescare must never lock features behind quotas; messaging should use my own gateway/credentials and degrade gracefully.

### 5A.2 Dashboard
KPI cards: **Total Sale Today, Net Cost of Sale, Gross Profit, Current Stock Value**. Charts: **hourly revenue** (area chart, 00:00–23:00, date-range picker) and **number of customers** per day. Improve with: per-branch selector, comparisons vs yesterday/last week, top items, low-stock and near-expiry widgets, cash/wallet split, cashier leaderboard.

### 5A.3 POS / "Create Invoice" screen (core screen, copy the workflow closely)
- Header actions: **+ Add Stock**, **+ Invoice Return** (opens a modal: "Enter complete invoice #"), **Add Last Order**, **Copy Last Invoice**, **Missed Sale**.
- **Customer/Patient** search by Name, MR#, or Phone, with inline "+" quick-add. Walk-in customer default (MR# 100001 style default walk-in record).
- **Item** search by name. Line grid columns: Item, **Units** (unit/strip/pack selector), **Rack#**, **Select Batch** (batch dropdown showing available qty, e.g. `164988 [55]`), **Disc. Price**, **Cost With Tax**, **Net Per Unit Cost**, **Rate**, **Avg Cost**, **Quantity** (with quick calculator), **Amount**, **Net Amount**, **Discount**, **Tax**, **Missed Sale (MS)** button per line.
- Live summary: **Profit/Loss** (for this bill, visible only to permitted roles), Sub-Total, Discount, Total Tax, **Grand Total**.
- **Total Discount** field with a `value` / `%` switch.
- Payment block: payment date-time, **payment mode** (Cash, Easypaisa/JazzCash, others), **Cash Received**, **+ Add Payment** (split tender), computed **Due**, **Cashback**, **Advance**.
- **Repeat** checkbox (recurring/refill order), **Invoice Note** (default text is configurable; mine says: return/exchange within 3 days, loose items/fridge items/opened products not eligible, invoice required, delivery charges for orders below a threshold).
- Buttons: **Hold Invoice**, **Hold & Print Invoice**, **Save**, **Save & Print Invoice** (dropdown for print formats), checkbox **Send Payment Notification** (SMS/WhatsApp).
- **Missed Sale modal:** records demanded-but-unavailable items (item, unit, quantity, customer phone, preferred supplier) so purchasing can act on them. Mediescare must include a **Missed Sales report** feeding purchase suggestions.
- Every invoice records **source** (e.g., POS), created-by user, and timestamps.

### 5A.4 Pharmacy Items (item master)
- Buttons: **Add Multiple Items**, **Add New Item**, **Add Item List** (bulk import), **Add Stock**.
- Filters: date, name search, supplier, manufacturer, category, unit, default/practice item, stock/all item, stock level, active/inactive, rack. Export Excel, Print.
- Columns: Status (active toggle), **Dead Item** flag, Name, **Generic Name**, **Barcode**, Category, Manufacturer, Supplier(s), **Stocking Unit**, **Conversion Unit** (e.g., 1 pack = 30 tablets), **Unit Cost**, **Retail Price**, **Reordering Level**, **Available Qty**, **Expired Qty**, **Narcotic** (true/false), **Rack#**, actions (edit / view / print label).
- Categories seen: Medications, Featured Medicines, Over The Counter Medicines, Medicine, Wellness and Beauty, plus non-drug retail (baby milk, tissue, batteries, razors, oils, cosmetics). So the item master must support **pharma + general retail**.
- Also required: Racks master, Tags master, Manufacturer master, item-type field (Default etc.), "B2B category".

### 5A.5 Purchasing / "Add New Stock" (GRN)
- Header: auto **Document Number**, Date, **Supplier** (search + quick-add), **Supplier Invoice #**, **Supplier Invoice Date**, **Attachments**, item search.
- Line grid: SR#, Items, Manufacturer, B2B category, Rack, Conversion Unit, **Shelf/Re-ordering level (in pack)**, Unit, Available Qty, **Quantity**, **Loose Unit Qty**, **Bonus Qty**, Avg Cost, Unit Cost, etc. (plus batch no. and expiry, which I need on every line).
- Footer: **Discount, Sales Tax, Advance Tax, WHT (Withholding Income Tax)** (each value or %), Total Cost, Total Rate, Total Qty, **Total Bonus Qty**, Stock Note, computed Discount / Total Tax / Advance Tax / Withholding / Grand Total.
- Related screens: **Purchase Order** (created from Low Stock via a per-item "PO" button and "Collect all / Add Order"), **Stock Return** (return to supplier), **Stock Suppliers**, **Manage Stock**, **Stock Adjustment**, **Consume Stocks** (internal use/wastage), **Store Closing** (period/day-end stock closing).
- Pakistani tax fields (Sales Tax, Advance Tax, WHT) are mandatory in purchases and reports.

### 5A.6 Pharmacy Reports hub (21 tabs; all must exist, all with date range, filters, Excel export and Print)
1. **Transaction** — filters: invoice#/patient name, item name, source, order#, payment mode. KPI: Total Revenue. Columns: Invoice#, MR#, Patient, Total, Paid, Payment Mode, Payment Date, Source, Created At, Created By, Actions (print / edit / refund). "Customize" columns.
2. **Narcotic** — Invoice#, Patient, Doctor, Narcotic Drug(s), Quantity, Value, Payment Date, Created At, Created By.
3. **Income Statement** — Total Stock Payments, Total Revenue, Net Income.
4. **Doctorwise Sales** — by doctor: Doctor's Name, Total Revenue (supports doctor referral/commission tracking).
5. **Itemwise Revenue** — filters: item, category, supplier, unit. KPIs: Total Revenue, Total Quantity. Bar chart of top items. Columns: Item, Category, Manufacturer, Suppliers, Available Qty, Sold Qty, Revenue.
6. **Low Stocks** — supplier filter, select-all, Add Order (bulk PO), per-item PO button. Columns: Item, Reordering Level, Units Left, Last Stock Added.
7. **Purchase Reports** — filters: supplier, document number, payment mode, invoice number, date. KPIs: Purchase Paid Amount, Total Dues, Total Advance Tax, Total WHT. Columns: Document No., Supplier, Stock Date, Supplier Invoice#, Supplier Invoice Date, Total, Paid, Amount Due, WHT, Advance Tax, Payment Date.
8. **Open Sale Returns** — KPIs Total Revenue, Total Refund. Columns: Return#, MR#, Patient, Item, Invoice#, Return Qty, Total Refund Amount, Created At/By.
9. **Discounts** — KPI Total Discount; filter "Sales with 100% discount". Columns: Invoice#, MR#, Patient, Description, Total, Paid, Discount, Added By, Invoice Date.
10. **Profit/Loss Statement** — Total Revenue, Net Cost of Sale, Profit/Loss by date.
11. **Dead Stock** — KPI Cost of Available (dead) Stock. Columns: Item ID, Name, Category, Manufacturer, Suppliers, Available Qty, Unit Cost, Total Cost, **Last Sales At**. (Dead = not sold for a configurable period.)
12. **Expiry** — Item, Batch, Quantity, Expiry Date, Stock Addition Date, Total Cost, Total Retail Value.
13. **Stock Statistics** — KPIs: Cost of Available Stock, Net Cost of Available Stock, Retail Value of Available Stock, **Avg Margin %**, In-Stock SKUs, Out-of-Stock SKUs, Consumed Out-of-Stock SKUs. Columns: Item, Item Type, Generic Name, B2B Category, Manufacturer, Total Stock, Total Adjustment, Total Expired, Total Consumed, Avail. Qty, Unit Cost, Unit Cost with Sales Tax, Discounted Price, Net Unit Cost, Retail Value. Buttons: **Audit Excel (without dead items)** and Excel.
14. **Pending Payments** — customer dues: MR#, Patient, Invoice, Total, Paid, Due, Creditor, Created At.
15. **Manufacturerwise Sales** — KPIs Total Quantity, Total Amount. Columns: Item, Manufacturer, Purchase Qty, Sold Qty, Revenue.
16. **Stock Expiry Report** — tabs: **Expired / 1 Month / 3 Month / 6 Month**; KPIs Total Quantity, Total Cost Value; batch data popover.
17. **Closing Revenue** (day-close) — filters: invoice/order#, "invoices with profit/loss", user, payment mode. KPIs: Total Revenue, **Footfall**, **Avg Ticket Size**, Total Cost, Total Discounted Cost, Gross Profit, **Profit Margin**, Total Refund, Total Tax, Total Dues, Total Advance, Total Discount. Per-invoice table: Date, Invoice#, Invoice Type (Walk-in), Payment Mode, MR#, Items, Total Revenue (A), Total Cost, Total Discounted Cost (B), Total Retail Price, Profit/Loss (A−(B+C)), Profit as %.
18. **Hold Invoices** — Invoice#, Created By, Created At, actions (resume/delete).
19. **Shift** — per shift: user name(s), **Total Inflow**, **Total Outflow** split into Stock Expenses and Other Expenses. (Mine uses two fixed shifts: Morning 12:01am–3:59pm, Evening 4:00pm–11:59pm; Mediescare must make shifts fully configurable.)
20. **Itemwise Purchase Margin Report** — filters item, category, date. KPIs Purchase Value, Net Retail Value, chart. Columns: Item, Category, Quantity, Purchase Price, Sale Price, **Latest/Average Purchase Margin %**, Amount.
21. **Itemwise Sales Margin Report** — filters item, supplier, unit. KPI Total Sales; bar chart; columns: Item, Category, Manufacturer, Suppliers, Available Qty, Total Sales.

### 5A.7 Financial Report hub (9 tabs)
Transaction (KPIs: Total Revenue, Total Cash, Total Advance, Total Refund, Total Tax + hourly line chart; columns include Referred By, Description, Total, Paid, Discount, Dues, Deductions/Tax deductions against insurance claims, Insurance Claims, Advance; filters by payment mode, doctor, tags, referrer), **Shift** (total collection per shift), **Staff** (total collection per staff, filter by shift/department), **Payment Mode** (pie chart + table, e.g., Cash vs Easypaisa/JazzCash), **Pending Payments** (by department/creditor type), **Advance Payments**, **Deleted Invoices** (must keep a full trail of deleted/voided bills), **Refund Report** (with **reason for refund** and refunded-by), **Cost Per Patient** (paid, expenses, dues, advance, profit/loss per customer).

### 5A.8 Accounts / Expenses
- Tabs: **Expenses**, **Expenses Summary**, **Bill Payments**.
- Expenses list: Voucher#, Employee, Description, Date, Category, Amount, Payment Mode, Created At/By, actions (edit/print/view/delete). Filters: voucher no., category, date, payment mode, doctor, supplier invoice#. Pie chart by category. Export/Print/Customize columns.
- **Add Expense** form: Description, Invoice no., Date-time, Category, Payment mode, Amount, **Asset/attachment upload**.
- **Expense Categories** (preferences): editable custom categories plus **locked system categories** that other modules post to. Mine currently has: Pharmacy Delivery Charges, Office Supplies, Staff Advance & Salaries, Utilities, Bills, Office Tea & Food, Fuel Charges, Water, Maintenance Charges, Office Cleanliness Tools (custom); and system ones: Doctor's Share, Procedure Expenses, Stock Bill Payment, Payrolls, Income Tax, Supplier Opening Balance, Laboratory Outsourced Tests Payment, Referral Payment.
- **Bill Payments:** outstanding supplier bills (Document No., Supplier, Stock Date, Supplier Invoice, Supplier Invoice Date, Grand Total, Amount Due, Total Paid) and separate **Opening Balance Payments** (supplier opening dues).
- Expense summary by category with totals; expenses feed shift outflow and P&L.

### 5A.9 Customers / Patients
- List: MR#, Name, Gender, Phone, Registration Date; filters by doctor and patient status; **Add Patient**, **Add Patient List** (bulk), **Advanced Search**, customizable columns; row actions (view, edit, invoices, delete, message).
- Quick-add modal: MR# (auto-generated), Name, Country code + phone, Additional Information.
- Profile: photo, name, gender, MR#, external health ID, phone; Edit Profile, **Add Invoice**, **Tags**, **Relationships** (family links), Old Relationships, **Download Patient** data, **Family History**, **Last Invoice** summary (items, total billed, amount paid, dues, advance).
- Walk-in default customers must be supported without forcing registration.

### 5A.10 Users & settings
- **Users** grouped by role tabs: Accountant, Admin, Pharmacist, Quality Control Manager (and more, custom). Columns: Active toggle, Name, Email, Phone, **Last Signed In On**, Edit. Search by name/email/phone. Add User.
- **User Settings:** practice/branch selector, change email, change password, **Enable Two-Factor Authentication**.
- **Update Practice** (business profile) tabs: **Practice** (name, phones, address, area, **License No.**, **NTN No.**), **Patient**, **Print Format**, **Pharmacy**, **Shifts**, **Shares**, **Accounts**. Mediescare needs the same settings groups per branch (print formats/templates, pharmacy rules, shift definitions, profit shares/commissions, accounting defaults).
- **Audit Log:** filter by date range, user, action; columns Date, User, Action.
- **Tax** master under Preferences.

### 5A.11 Messaging, notifications, support, billing
- **Messages:** available/free/paid message counters, buy SMS package, Compose (bulk to customers), Sent history, **SMS/WhatsApp conversations**; **Message Templates**, **Message Settings**; payment notification per invoice. Mediescare: templates + own gateway (SMS/WhatsApp Business API), queued when offline and sent when online, no artificial quota lock.
- **Notifications** center; **Features & Updates** (release notes).
- **Support tickets:** practice ID, contact number, module with the issue, file attachment, message. Provide an in-app "Report a problem" that attaches logs/screenshots.
- **Billing/Subscription** page (I will use it for license/subscription status of Mediescare licensing if I resell it later; keep optional).

### 5A.12 What to improve over HCloud (must-do)
1. **Works fully offline** (HCloud is cloud-only and stops when internet or quota fails).
2. **Multi-branch stock distribution** from a Head Office main store, with in-transit tracking (see 3.4). HCloud has no clean flow for this.
3. **Configurable shifts** (not just two fixed), roster/rotation, cashier float and blind cash count.
4. **Stronger permissions**: hide cost/profit from cashiers, discount and refund limits with manager PIN.
5. **Batch/expiry enforced at POS** and per-batch cost so profit is accurate; recall-by-batch.
6. **Faster reporting** with a report builder, saved filters, scheduled exports, drill-down.
7. **Bilingual UI** (English/Urdu) and thermal-printer-first receipts.
8. **Tamper-evident audit trail** including deleted/voided invoices with reasons.
9. **No feature paywalls or quota suspension.**

---

## 6. HOSPITAL MODULES (full HMS — build after the Pharmacy/POS core is stable, sharing the same platform)

Deliver each of these as complete modules, not stubs:

1. **Patient Management / Registration** — MRN generation, demographics, CNIC, photo, family linking, panel/insurance/corporate, barcode/QR wristband and card, duplicate detection, merge.
2. **Appointments & Scheduling** — doctor schedules, slots, walk-in queue/token system with display screen, reschedule/cancel, reminders (SMS/WhatsApp when online), tele-consult flag.
3. **OPD** — consultation, vitals, triage, e-prescription (drug/dose/duration templates, allergy alerts), investigations orders, follow-ups, referral, medical certificates, printable prescription with letterhead.
4. **EHR / EMR** — chief complaints, history, examination, diagnosis (ICD-10), care plans, clinical notes, templates by specialty, document/image attachments, full timeline, consent forms, problem list, immunizations.
5. **IPD / Indoor** — admission, bed/ward/room management with live bed map, transfers, nursing station, doctor rounds, medication administration record (MAR), diet, intake/output, care charts, discharge summary, discharge billing, gate pass.
6. **Emergency** — triage, fast registration, emergency billing, MLC cases, ambulance management.
7. **Operation Theatre (OT)** — scheduling, surgeon/anesthetist/team, pre-op checklist, consumables and implants, OT notes, surgery packages, post-op.
8. **Laboratory (LIS)** — test catalog and panels, sample collection & barcoding, worklists, result entry with reference ranges/critical flags, analyzer interface hooks (HL7/ASTM), verification/approval, printable reports with logo, outsourced lab tracking, reagent inventory.
9. **Radiology (RIS/PACS-ready)** — modality worklist, reporting templates, DICOM viewer integration hook, report printing.
10. **Billing & Revenue Cycle** — OPD/IPD/ER/lab/radiology/pharmacy billing, packages, deposits/advances, running IPD bill, discounts with approval, doctor share/consultant revenue sharing, panel/insurance claims, corporate billing, refunds, receivables, revenue cycle dashboards.
11. **In-Hospital Pharmacy integration** — prescription/IPD indent → dispensing from the pharmacy module, ward stock, returns, patient-wise medication billing.
12. **Inventory / Store / Assets** — medical/surgical/general consumables, requisitions, issuance to departments, asset register, maintenance schedules, biomedical equipment calibration.
13. **HR & Payroll** — (extends section 4.4) recruitment, credentials, doctor privileges, CME tracking, training.
14. **Accounts / Finance** — full double-entry: chart of accounts, journal/payment/receipt vouchers, bank & cash books, bank reconciliation, trial balance, P&L, balance sheet, cost centers per branch/department, tax ledgers, fiscal year closing, inter-branch accounting.
15. **Other services** — dental, aesthetics/cosmetology, physiotherapy, dialysis, blood bank, mortuary, canteen/housekeeping/laundry as optional toggleable modules.
16. **Patient/Doctor communication** — SMS/WhatsApp/email templates, Doctor's mobile/web companion (future-ready APIs), patient portal (future-ready).
17. **Interoperability** — HL7/FHIR-ready APIs, import/export, webhooks.

Modules must be **toggleable per branch/tenant** via feature flags so a pharmacy-only branch doesn't see hospital menus.

---

## 7. DASHBOARDS & ANALYTICS

- **Super Admin dashboard:** all-branches KPIs (today/MTD/YTD): sales, purchases, gross & net profit, expenses, cash & bank position, receivables/payables, stock value, near-expiry value, top/bottom products, branch-wise leaderboard, sales trend charts, forecasting/demand prediction, alerts. Drill down from company → branch → cashier → invoice.
- **Branch dashboard** and **cashier dashboard** with role-appropriate KPIs.
- Real-time (or near real-time) via sync, with clear "data as of" timestamps for offline branches.
- Exception/anomaly alerts: excessive discounts, frequent voids/returns, negative-margin sales, cash shortages, stock variances.

---

## 8. NON-FUNCTIONAL REQUIREMENTS

- **Performance:** POS search < 100 ms on 100k+ SKUs, invoice save < 300 ms, works smoothly on modest hardware (4 GB RAM Windows 10/11).
- **Reliability:** crash-safe writes, WAL, transactional stock/finance posting, automatic recovery, no data loss on power cut.
- **Security:** encrypted DB and backups, hashed passwords (Argon2), RBAC on server side too (never trust client), rate limiting, audit trail, secure updater, license/activation per installation.
- **Multi-tenancy:** cloud supports multiple organizations with strict data isolation.
- **Accessibility & UX:** keyboard-first workflows, large touch-friendly targets for touchscreen POS, dark mode optional (white is default), responsive layouts, consistent empty/loading/error states, undo where safe.
- **Localization:** English/Urdu, PKR default currency, configurable date format, tax rules configurable.
- **Observability:** local error logs, sync diagnostics, optional remote crash reporting.
- **Documentation:** README, architecture doc, DB schema diagram, API docs, sync-protocol doc, user manual per role, deployment/installer guide, backup/restore guide.

---

## 9. DELIVERY PLAN (how I want you to work)

Do **not** try to output everything in one go. Work in phases, and at the end of each phase give me a runnable build and a short demo script.

1. **Phase 0 — Discovery & design:** read the screenshots + HCloud site, produce a feature matrix (HCloud feature → Mediescare equivalent → improvement), ER diagram, module map, permission matrix, sync design doc, UI style guide from the logo colors. **Ask me any blocking questions before Phase 1.**
2. **Phase 1 — Foundation:** monorepo, Electron shell, installer, branding, auth, RBAC, branch model, local DB + migrations, sync engine skeleton with outbox, settings, audit log, backup/restore.
3. **Phase 2 — Pharmacy core:** item master, batches, purchasing (PO/GRN), inventory ledger, POS, returns, printing, cashier shifts.
4. **Phase 3 — Multi-branch:** head-office main store, requisition/transfer/receive flow, cloud sync end-to-end, super-admin consolidated analytics, LAN multi-terminal mode.
5. **Phase 4 — Users, HR & finance:** shifts/rosters, attendance, payroll, expenses, accounting.
6. **Phase 5 — Hospital modules:** patients → OPD/EMR → billing → IPD → lab → radiology → OT → emergency → the rest.
7. **Phase 6 — Hardening:** performance tests, sync chaos tests (offline for days, duplicate pushes, clock skew), security review, installers, auto-update, docs.

For every phase: write code, tests, migrations, seed/demo data, and update the docs. Keep the code modular, typed, and consistent. Prefer explicit, boring, reliable solutions over clever ones.

---

## 10. FIRST RESPONSE — WHAT I EXPECT NOW

Before writing any code, reply with:
1. A short confirmation of your understanding of this brief.
2. A **feature matrix** built from the screenshots and Section 5A (HCloud feature → Mediescare equivalent → improvement). Call out any screen or field you could not read or that you think is missing.
3. Your final **tech stack and architecture diagram** (especially the Branch Server LAN model and sync design).
4. Your **list of open questions** (keep it short and prioritized), e.g. accounting depth, tax/FBR integration needs, hardware (printers/scanners/biometric), number of branches and terminals, preferred cloud provider.
5. The **Phase 1 plan** with estimated deliverables.

Then wait for my go-ahead.
