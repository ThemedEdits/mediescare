# Open questions (blocking, prioritized)

Answer in any order. Items 1-6 block Phase 1 start or its design. Items 7-12 can be answered during Phase 1, but before the phase named.

## Must answer before Phase 1

1. ~~Product name spelling.~~ **Resolved:** the official name is **Mediescare**, matching the logo wordmark. Logo files are final.
2. **Branches and terminals; server PC; failover.** How many branches now and in 12 months? Terminals per branch? Which PC is the Branch Server, and is a second PC available to be a warm standby ([architecture.md §6](architecture.md))? How long can a branch stop selling if the server PC dies (5 minutes, 1 hour)? Do you want the **emergency provisional-receipt mode** (off by default)?
3. **HO to branch when internet is down.** Transfers are routed through the cloud. If the Head Office and a branch are both online on their own LAN but the internet is down, a branch cannot receive stock until sync returns. Acceptable, or do you need a direct HO-to-branch link ([sync-design.md §2](sync-design.md))?
4. **Accounting depth for Phase 4.** Simple cash/P&L (fast, matches HCloud) or full double-entry (chart of accounts, journals, balance sheet, inter-branch accounting)? This decides tables from Phase 2 (expense and payment posting).
5. **Cloud provider and budget.** Supabase, Neon or your own VPS? Monthly budget? Is a Pakistan-hosted region required?
6. **Hardware.** Thermal printer models (80 mm/58 mm, USB or LAN), barcode scanners (wedge?), cash drawer (printer kick?), customer display, biometric attendance device (ZKTeco model?). This decides the ESC/POS driver and whether Urdu on receipts is bitmap.

## Answer before the phase shown

7. **Tax and fiscal (before Phase 2).** Rates and rules for Sales Tax on sales, and on purchases: are Advance Tax and WHT percentages of the invoice or of the amount after tax? Is FBR or provincial (SRB) POS integration required, and by when? Prices: tax-inclusive or tax-exclusive at the counter?
8. **Discount, refund and override limits (before Phase 2).** Are the proposed limits in [permissions-matrix.md §5](permissions-matrix.md) acceptable (cashier 5 %, Jr. pharmacist 10 %, Sr. pharmacist 15 %, manager 25 %)? Who may approve overrides?
9. **Urdu display (before Phase 1 UI).** Noto Nastaliq in data grids is slow to read. Use Naskh for dense tables, Nastaliq for headings? Should item names have an Urdu name field?
10. **Licensing (before Phase 6).** Only for your own pharmacies, or will you resell Mediescare? Reselling means multi-tenant licensing, activation server, and support tooling. Not needed if it stays yours.
11. **Data migration (before Phase 2).** Do you want to import the current HCloud items (about 53,000), suppliers, customers, opening stock and opening balances? Can HCloud export Excel of items, customers and stock? (Screenshots show Excel export buttons.) Customer data import needs consent and PII handling rules.
12. **Business rules to confirm (before Phase 2):**
    - Dead stock definition (proposal: no sale in 90 days).
    - Expiry alert windows (proposal: 30/60/90/180 days).
    - Negative stock: never, or allowed for selected items or branches?
    - Rounding of bill total (to nearest PKR 1? 0.50?).
    - Are opened/loose sales from a strip always allowed, and how is a broken pack's cost split?
    - What does "B2B category" and "Item Type: Default" in HCloud mean for you? Keep or drop?
    - Who owns price policy: HO only, or can a branch manager change local prices?
    - Return policy defaults (window in days, items not returnable such as loose or fridge items).
    - How often may a branch be offline before you want a warning (proposal: 24 h warn, 72 h alert)?

## Also needed from you (not questions)

- A **fake-data policy confirmation:** the screenshots contain real staff and customer details. Phase 1 seeds use generated names only, and the PDF stays out of any commit or shared bundle.
- Whether `docs/hcloud_screenshots.pdf` should be excluded from git (recommended: add to `.gitignore`, since it contains real names, phone numbers and a practice id).
- The screens marked **U1 to U20** in [feature-matrix.md](feature-matrix.md) that were not in the PDF (Create menu, Tax, Racks, Tags, PO, Stock Return, Adjustment, Consume, Store Closing, Practice tabs). If you can share more screenshots, send them before Phase 2. Otherwise I will design them from the master prompt and you review.
