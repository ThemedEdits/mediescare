# Style guide

Status: **Draft for approval.** Colours below are measured from the supplied logo files, not guessed.

## 1. Logo and colour measurement

Source files: `docs/branding/mediescare-logo.svg` (517 x 551) and `docs/branding/mediescare-icon.svg` (380 x 386). Both are vector.

**Method.**
1. Read the fills in the SVG source. There are exactly two flat fills: `.b` and `.c`.
2. Rasterised both files (no anti-aliasing tricks, opaque pixels only) and counted the pixel values that actually appear, to confirm the source matches what is drawn.

| Role | Measured hex | RGB | Share of opaque pixels (logo) | Where in logo |
|---|---|---|---|---|
| **Primary (blue)** | **`#3DA6DD`** | 61, 166, 221 | 58 % | head figure, right heart arc, "care" in the wordmark |
| **Secondary (green)** | **`#8FC33E`** | 143, 195, 62 | 42 % | left heart arc, "medies" in the wordmark |

Raster check result: the logo produced `#3da6dd` x 35,795 px and `#8fc33e` x 26,121 px (plus a few dozen anti-alias edge pixels). The icon produced `#3da6dd` x 27,474 px and `#8fc33e` x 10,723 px. So there are no other brand colours.

Wordmark spelling in the file reads **"mediescare"**. The owner confirmed the official name is **Mediescare** and the logo files are final (Phase 0 answers).

## 2. Accessibility finding (important)

Both brand colours are too light for text or for white text on top of them:

| Pair | Contrast | WCAG AA (4.5 : 1 text, 3 : 1 large/UI) |
|---|---|---|
| `#3DA6DD` on white | 2.73 : 1 | Fails for text, fails for UI borders |
| `#8FC33E` on white | 2.09 : 1 | Fails |
| White on `#3DA6DD` | 2.73 : 1 | **Fails.** Do not put white button labels on the raw brand blue |
| Dark text `#0F172A` on `#3DA6DD` | 6.54 : 1 | Passes |
| Dark text `#0F172A` on `#8FC33E` | 8.54 : 1 | Passes |

**Decision proposed:** the brand hexes stay exact for identity (logo, active-nav indicator, chart series, badges, focus rings on large areas). For **filled buttons and text links**, use the darker shade of the same hue (`primary-600` below, 5.46 : 1 with white text). This keeps the look on-brand and keeps a busy pharmacist's screen readable.

## 3. Colour tokens

Derived by holding hue and saturation and changing lightness (computed, contrast measured against `#FFFFFF`).

### Primary (blue, hue 201)

| Token | Hex | Use | Contrast vs white |
|---|---|---|---|
| `--color-primary-50` | `#ECF6FC` | tinted backgrounds, selected row | - |
| `--color-primary-100` | `#D8EDF8` | hover on tinted | - |
| `--color-primary-200` | `#B1DBF1` | borders on tinted | - |
| `--color-primary-300` | `#8BCAEB` | | - |
| `--color-primary-400` | `#64B8E4` | | 2.2 |
| **`--color-primary-500`** | **`#3DA6DD`** | **brand blue: logo, accents, chart series 1, active nav underline** | **2.73** |
| `--color-primary-600` | `#1B709C` | **button fill, links, active nav text** | 5.46 |
| `--color-primary-700` | `#18638B` | button hover | 6.57 |
| `--color-primary-800` | `#15577A` | button active/pressed | 7.85 |
| `--color-primary-900` | `#124B68` | headings on tint | 9.41 |

### Secondary (green, hue 83)

| Token | Hex | Use | Contrast vs white |
|---|---|---|---|
| `--color-secondary-50` | `#F4F9EC` | tinted backgrounds | - |
| `--color-secondary-100` | `#E9F3D8` | | - |
| `--color-secondary-200` | `#D2E7B2` | | - |
| `--color-secondary-300` | `#BCDB8B` | | - |
| `--color-secondary-400` | `#A5CF65` | | - |
| **`--color-secondary-500`** | **`#8FC33E`** | **brand green: accents, positive badges (with dark text), chart series 2** | **2.09** |
| `--color-secondary-600` | `#5B7C27` | text on white, secondary button fill | 4.82 |
| `--color-secondary-700` | `#506D22` | hover | 5.91 |
| `--color-secondary-800` | `#445D1D` | pressed | 7.42 |
| `--color-secondary-900` | `#394E18` | | 9.22 |

### Neutrals (not from the logo, chosen for clarity on white)

| Token | Hex | Use |
|---|---|---|
| `--color-bg` | `#FFFFFF` | page background (required: white) |
| `--color-surface` | `#F8FAFC` | cards, table stripes, sidebar |
| `--color-surface-2` | `#F1F5F9` | table header, inputs disabled |
| `--color-border` | `#E2E8F0` | dividers |
| `--color-border-strong` | `#94A3B8` | input borders (3 : 1 on white) |
| `--color-text` | `#0F172A` | body text (17.8 : 1) |
| `--color-text-muted` | `#475569` | secondary text (7.6 : 1) |
| `--color-text-disabled` | `#94A3B8` | disabled |

### Status colours (independent of brand, for meaning)

| Token | Hex | Meaning |
|---|---|---|
| `--color-success` | `#2F7D32` | paid, in stock (text on `#E8F5E9`) |
| `--color-warning` | `#B45309` | near expiry, low stock (text on `#FEF3C7`) |
| `--color-danger` | `#B91C1C` | expired, loss, error, void (text on `#FEE2E2`) |
| `--color-info` | `#1B709C` | same as primary-600 |

Rule: **expiry and stock states are never colour-only.** Every status has a text label or icon (colour-blind users, and thermal/greyscale printouts).

### Button and state matrix

| Element | Default | Hover | Active | Disabled | Focus |
|---|---|---|---|---|---|
| Primary button | bg `primary-600`, text white | `primary-700` | `primary-800` | bg `#CBD5E1`, text `#64748B` | 2 px ring `primary-500` + 2 px white offset |
| Secondary button | bg `secondary-600`, text white | `secondary-700` | `secondary-800` | as above | ring `secondary-500` |
| Outline button | border `primary-600`, text `primary-600` | bg `primary-50` | bg `primary-100` | | |
| Destructive | bg `danger`, text white | darker 8 % | darker 14 % | | |
| Nav item | text `text-muted` | bg `primary-50` | | | |
| Active nav | text `primary-600`, 3 px `primary-500` underline/indicator | | | | |

Charts: series colours in order `primary-500`, `secondary-500`, `#F59E0B`, `#8B5CF6`, `#64748B`. Text on chart labels always uses `--color-text`.

## 4. Tailwind / CSS variable delivery

`packages/config/tailwind` exports these as CSS variables in `:root` and maps them into the Tailwind theme (`colors.primary.500`, ...). shadcn/ui tokens map like this: `--primary` = `primary-600`, `--primary-foreground` = white, `--accent` = `secondary-50`, `--ring` = `primary-500`, `--background` = white, `--border` = `border`. No hard-coded hex in components. A lint rule blocks raw hex outside the token file.

## 5. Typography

| Use | Font | Notes |
|---|---|---|
| Latin UI and numbers | **Inter** (variable), fallback `Segoe UI`, system-ui | Bundled locally (no CDN: must work offline). Tabular figures for all money columns (`font-variant-numeric: tabular-nums`). |
| Urdu UI | **Noto Nastaliq Urdu** | Bundled locally. Nastaliq needs extra line height, so Urdu uses `line-height: 2` for body text and `1.6` in dense tables. |
| Urdu fallback for dense data | **Noto Naskh Arabic** (option, per-user "compact Urdu") | Nastaliq in data grids is hard to scan. Offer Naskh as a switch. Decision needed (Q9). |
| Monospace (batch, barcode, doc no.) | **JetBrains Mono** or `ui-monospace` | |
| Receipts (thermal) | Printer font for Latin, **bitmap-rendered** Urdu | Most ESC/POS printers cannot print Urdu, so receipts render as raster images. Needs printer models (Q6). |

Scale (px, base 16): 12 (caption) / 14 (table, default desktop) / 16 (form) / 18 / 20 (section) / 24 (page title) / 32 (KPI numbers). POS uses larger minimum touch targets, see below. Weights 400 / 500 / 600.

**RTL:** the layout uses logical CSS properties (`margin-inline-start`, `ps-*`, `text-start`) everywhere, never `left/right`. Icons that imply direction (back, next, progress) mirror in RTL, numeric columns and barcodes do not. Digits: Western digits (0-9) by default in both languages (Pakistani business convention, matches receipts). Optional Urdu-Indic digits setting is not planned. Mixed Urdu/English item names use `dir="auto"` on cells.

## 6. Spacing, radius, elevation

- 4 px base grid. Spacing scale 4, 8, 12, 16, 24, 32, 48.
- Radius: 6 px inputs and buttons, 10 px cards, 999 px badges.
- Elevation: 1 px border first, shadow only for menus and modals. Flat, clean look on white.
- Density: **Comfortable** (default, 40 px rows) and **Compact** (32 px rows, back-office grids). POS lines use 48 px rows.
- Minimum touch target 44 x 44 px (POS 48 x 48).

## 7. Components (shadcn/ui wrappers, built once)

Button, Input, Select/Combobox (searchable), Date-range picker (presets, 12/24 h), DataGrid (TanStack Table: server-side page/sort/filter, sticky header, column customiser, Excel and Print buttons, KPI strip, empty/loading/error), Modal/Drawer, Toast, Badge, Tabs, KPI card, Chart card (Recharts), Barcode/QR, ConfirmWithReason, ManagerOverrideDialog, SyncStatusChip, BranchSwitcher, LanguageSwitch.

State patterns: every list has **loading skeleton, empty ("no records", with a suggested action), error with retry**, and never a blank area. The confusing HCloud states (greyed Excel/Print buttons with no explanation) get a tooltip.

## 8. Shell layout

- Top bar (height 56): logo (icon variant in compact mode), **branch switcher** (users with several branches, Super Admin has "All Branches"), global search (Ctrl+K), sync chip (online/offline, pending count), notifications, language toggle EN | اردو, user menu (User Settings, Priority Modules, Contacts, Support, Audit Log, Admin Settings, What's New, Lock, Logout).
- Navigation: keeps HCloud's **Priority Modules** idea. Four pinned items in the top bar, the rest under **More**. Left sidebar is an option (per-user) for wide screens.
- **Create** button: quick-create menu (Invoice, Stock/GRN, Customer, Expense, Missed Sale, Transfer request).
- Footer: version, licence, branch, server address and connection state (terminals). No floating buttons covering content (HCloud's covers pagination text).

## 9. POS screen layout

Follows CLAUDE.md §5A.3. Full-screen, keyboard-first, no page scroll at 1366 x 768 (the smallest supported screen).

```
+---------------------------------------------------------------------------------------------+
| logo | Branch KHI01 | Shift: Morning (open) | Counter 2 | user | sync chip | EN|اردو | lock   |
+---------------------------------------------------------------------------------------------+
| [F2 Customer: Walk-in v (+)]  [F3 Item search  ........................... (barcode ready)]  |
| Actions: F4 Hold  F5 Recall  F6 Invoice Return  F7 Copy Last  F8 Missed Sale  F9 Add Stock   |
+-------------------------------------------------------------------+-------------------------+
| # | Item / generic | Unit v | Rack | Batch [qty] v | Rate | Qty | Disc | Tax | Net   | Panel   |
| 1 | Item name      | strip  | A3   | B123 [55] exp | 40.7 |  5  |  0   |  0  | 203.5 |         |
| 2 | ...            |        |      |               |      |     |      |     |       | Sub-total       |
|   |                |        |      |               |      |     |      |     |       | Discount [%|Rs] |
| (line grid, 48 px rows, expiry badge per batch, MS button per row) | Tax            |
|                                                                   | GRAND TOTAL big  |
|                                                                   | Profit (only if  |
|                                                                   |  view_profit)    |
+-------------------------------------------------------------------+-------------------------+
| Payment: [Cash v] Received [____]  [+ Add payment]   Due / Change / Advance                  |
| Note (default text, editable)   [ ] Send payment notification  [ ] Repeat                     |
| [F10 Hold & Print]  [F11 Save]  [F12 Save & Print v]                     Esc = clear/cancel |
+---------------------------------------------------------------------------------------------+
```

Behaviours:
- Focus starts in the item search. Barcode-wedge scan adds the item and returns focus. Enter adds the top result. Arrow keys move through results. Search target under 100 ms.
- Batch is auto-selected (FEFO). Changing it is allowed. **Expired batches are shown greyed and cannot be selected.** Near-expiry batches show an amber badge with days left.
- Qty field opens a small calculator (as in HCloud) and supports unit switch with live conversion (`2 strips + 3 tablets`).
- Totals are large (32 px, tabular). Cashier and Jr. Pharmacist see **no profit and no cost columns** (per permissions).
- Split tender: multiple payment rows, remaining due always visible. Change/cashback shown big.
- Save is disabled while the request is in flight and shows a clear "saved" or "not saved" state. A LAN drop shows "Not saved, retrying" and never a false success.
- Hold and recall lists show hold invoices from all terminals of the branch (server-side).
- F-keys are configurable per branch. A help overlay (`?`) lists them.
- Language: line items show English name and, if entered, an Urdu name.

## 10. Branding usage

- Logo (`mediescare-logo.svg`): login screen, installer, invoices/reports (A4), receipts (mono bitmap version for thermal).
- Icon (`mediescare-icon.svg`): window/taskbar, sidebar header (compact), favicon, installer.
- Generate `.ico` (16/24/32/48/64/128/256), `.icns`, and PNG sets in Phase 1 from the SVGs. Provide a one-colour (black) logo for thermal printing and a white-on-primary variant. Both are derived from the same paths.
- Minimum clear space around logo = height of the head circle. Never recolour the two brand colours.

## 11. Print styles

- A4/A5: white, logo top-left, branch details, tax numbers (NTN, STRN), QR. Tabular figures. Urdu text is embedded as a font in the PDF.
- Thermal 80 mm (about 48 chars) and 58 mm (about 32 chars): mono logo bitmap, item lines, totals, QR, footer note. Urdu note lines rasterised.
- The default invoice note is configurable per branch (HCloud's is a return-policy text).
