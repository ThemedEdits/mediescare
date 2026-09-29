# Permissions matrix

Status: **Draft for approval.** Defaults only. Every cell can be changed per tenant, and custom roles are supported. Enforcement is **server-side on every route handler and server action**. Hiding a button in the UI is cosmetic.

## 1. Model

- Permission key: `module.resource.action`, for example `pharmacy.sale.void`.
- Actions: `view, create, edit, delete, approve, print, export, override_price, discount, void, refund, backdate, view_cost, view_profit`. Only actions that make sense exist for a resource (the catalogue is seeded from code, see `packages/core/permissions`).
- Effective permission = union of the user's roles, **intersected with branch scope**. A user has `user_branches` rows or `all_branches`.
- **Field-level rules** hide fields even when the resource is viewable: `cost`, `profit`, `margin`, `supplier_price`, `avg_cost`. The API removes them from responses. They are not just hidden in the UI.
- **Deny is not modelled** (grants only) to keep reasoning simple. Instead, sensitive rights are separate permissions (`view_cost`, `view_profit`, `backdate`).
- Super Admin has all permissions in all branches and can switch to **All Branches** (consolidated read-only views) or any single branch. Writes in All Branches mode are refused: pick a branch first.

## 2. Modules and resources (catalogue)

| Module | Resources |
|---|---|
| `admin` | user, role, branch, device, settings, feature_flag, audit_log, backup, sync, licence |
| `pharmacy` | item, category, manufacturer, rack, tag, price, sale, sale_return, hold_invoice, customer, doctor, missed_sale, narcotic_register |
| `inventory` | stock, batch, adjustment, consume, count, expiry, transfer, requisition, in_transit |
| `purchasing` | supplier, purchase_order, grn, purchase_return, supplier_payment |
| `shifts` | shift, cash_count, x_report, z_report, float |
| `finance` | expense, expense_category, petty_cash, ledger, tax (accounts later) |
| `reports` | each report id (sales, purchases, stock, profit, narcotic, expiry, ...), builder |
| `hr` | employee, attendance, roster, payroll, leave (Phase 4) |
| `messaging` | template, message, gateway (Phase 4) |
| `hospital` | added in Phase 5 |

## 3. Default role grants (Phase 1-3 scope)

Legend: `V` view, `C` create, `E` edit, `D` delete (soft), `A` approve, `P` print, `X` export, `-` none. Special rights are listed below the table.

| Resource | Super Admin | HO Admin | Branch Mgr | Sr. Pharmacist | Jr. Pharmacist | Cashier | Store Keeper | Purchase Officer | Accountant | HR Manager | Auditor | QC Manager |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| admin.user | VCEDA | VCEDA | VCE (own branch) | - | - | - | - | - | V | VC (staff only) | V | - |
| admin.role | VCEDA | VCE | - | - | - | - | - | - | - | - | V | - |
| admin.branch / device / settings | VCEDA | VCEDA | V, E (own settings) | - | - | - | - | - | V | - | V | - |
| admin.audit_log | V X | V X | V (own branch) | - | - | - | - | - | V | - | V X | V |
| admin.backup / sync | VCEDA | VCE | VCE (own) | - | - | - | - | - | - | - | V | - |
| pharmacy.item | VCEDA | VCEDA | VCE | VCE | V | V | V | VCE | V | - | V | V |
| pharmacy.price | VCEDA (approve) | VCEDA | E (branch-allowed fields only) | - | - | V | - | E (propose) | V | - | V | - |
| pharmacy.sale | V P X | V P X | VCP | VCP | VCP | VCP | - | - | V X | - | V X | V |
| pharmacy.sale_return | V | V | VCA | VCA | VC (within limit) | VC (within limit, then override) | - | - | V | - | V | V |
| pharmacy.hold_invoice | V | V | VCED | VCED | VCED | VCED | - | - | - | - | - | - |
| pharmacy.customer | VCEDA | VCEDA | VCE | VCE | VCE | VC | - | - | V | - | V | - |
| pharmacy.narcotic_register | V X | V X | V P X | V C P X | V C P | C (capture only) | - | - | V | - | V X | V X |
| pharmacy.missed_sale | V | V | VC | VC | VC | VC | V | V | - | - | V | - |
| inventory.stock / batch | V | V | V | V | V | V (qty only, no cost) | VCE | V | V | - | V | V |
| inventory.adjustment | VCA | VCA | VCA | VC | - | - | VC | - | V | - | V | VCA (expiry write-off, quarantine) |
| inventory.count | V C A | V C A | VCA | VC | VC | - | VC | - | V | - | V | V |
| inventory.transfer / requisition | VCEA | VCEA | VC (raise + receive) | V | V | - | VC (dispatch/receive) | V | V | - | V | - |
| purchasing.supplier | VCEDA | VCEDA | V | V | - | - | V | VCE | V | - | V | - |
| purchasing.purchase_order | VCEA | VCEA | VC (if allowed) | - | - | - | - | VCE (A up to limit) | V | - | V | - |
| purchasing.grn | VCEA | VCEA | VC (if allowed) | - | - | - | VC | VC | V | - | V | - |
| purchasing.supplier_payment | VCA | VCA | - | - | - | - | - | - | VCA | - | V | - |
| shifts.shift / cash_count | V | V | VA | V | V | Own shift C | - | - | V | - | V | - |
| finance.expense | VCEDA | VCEDA | VC (limit) | - | - | VC (petty cash, limit) | - | - | VCEA | - | V | - |
| reports.* | All | All | Branch | Sales, stock, expiry | Sales (own) | Own shift X report only | Stock reports | Purchase, low stock | Financial | HR | All (read-only) | Expiry, recall, narcotic, quality |

## 4. Special (sensitive) rights, granted explicitly

| Right | Super Admin | HO Admin | Branch Mgr | Sr. Pharmacist | Jr. Pharmacist | Cashier | Store Keeper | Purchase Officer | Accountant | Auditor |
|---|---|---|---|---|---|---|---|---|---|---|
| `view_cost` (purchase cost, avg cost) | Y | Y | Y | Y | N | **N** | Y | Y | Y | Y |
| `view_profit` (bill and report profit) | Y | Y | Y | N | N | **N** | N | N | Y | Y |
| `override_price` | Y | Y | Y (within limit) | Y (within limit) | N | N | N | N | N | N |
| `discount` | Y | Y | Y | Y | Y | Y | N | N | N | N |
| `void` (sale) | Y | Y | Y | with approval | N | N | N | N | N | N |
| `refund` | Y | Y | Y | Y | Y (limit) | Y (limit) | N | N | N | N |
| `backdate` | Y | Y | N | N | N | N | N | N | Y (period open only) | N |
| `approve` transfers / POs | Y | Y | branch scope | N | N | N | N | limit | N | N |
| `export` (Excel/PDF of data) | Y | Y | Y | limited reports | N | N | stock only | purchase only | Y | Y |

Cashier and Jr. Pharmacist UI: cost, avg cost, net unit cost, profit/loss and margin are **removed from the invoice grid response**. HCloud shows Profit/Loss and Avg Cost to whoever is on the POS. Mediescare must not (per CLAUDE.md §5).

## 5. Discount, refund and price-override limits

Limits live on the **role** (`roles.discount_limit_bp`, `refund_limit_minor`, `price_override_limit_bp`) with an optional **per-user override** and optional per-branch tightening. Defaults below are **proposals to confirm** (Q8).

| Role | Max discount per bill | Max discount per line | Max refund per return | Daily refund total | Price override |
|---|---|---|---|---|---|
| Cashier | 5 % | 5 % | PKR 2,000 | PKR 10,000 | none |
| Jr. Pharmacist | 10 % | 10 % | PKR 5,000 | PKR 25,000 | none |
| Sr. Pharmacist | 15 % | 15 % | PKR 20,000 | PKR 100,000 | up to 5 % below rate |
| Branch Manager | 25 % | 25 % | PKR 100,000 | no cap (reported) | up to 10 % |
| HO Admin / Super Admin | 100 % | 100 % | no cap (logged) | no cap | any |

Additional hard rules regardless of limits:
- Never below batch cost unless the user has `view_cost` and a manager override (prevents silent loss sales).
- 100 % discount bills always require manager override and a reason. They appear in the Discounts report.
- Discount on a controlled/narcotic line is not allowed unless the role has `pharmacy.narcotic_register.discount` (default: nobody).

## 6. Manager PIN override

When an action exceeds the acting user's limit, or needs a right the user lacks, the POS shows the **override dialog**. It is the only way to exceed limits.

1. Cashier attempts the action. The server returns `403 OVERRIDE_REQUIRED` with the reason and the required right.
2. A manager types their **PIN** (not a shared PIN: each approver has their own).
3. The server checks: approver is active, in scope for this branch, has the right (`discount`, `refund`, `override_price`, `void`, `backdate`) and the **amount is within the approver's own limit**. If not, escalate to a higher role.
4. The override is bound to **one action**: `(action, document/line reference, amount, terminal, expires in 2 minutes)`. It cannot be reused.
5. An `override_events` row and an `audit_log` row are written (requester, approver, action, amount, reason text, terminal, time). Reason is mandatory for refunds, voids and 100 % discounts.
6. Rate limit: 5 wrong PINs locks that PIN for 15 minutes and alerts the Branch Manager. A user cannot approve their own request.
7. Overrides appear in a **daily override report** and in the anomaly alerts (excessive overrides per approver or cashier).
8. Offline: the override works fully offline against the branch server. Terminals never cache PINs.

## 7. Authentication-related permissions and rules

- PIN login for POS counters: 4-6 digits, per user, bound to a device and branch. Locks after 5 failures. PIN cannot be used for admin screens or for approving overrides beyond POS scope unless the user is a manager (approver PIN is a separate PIN field).
- Password policy: minimum 10 characters, breached-password check is offline (bundled list), force change on first login and after reset, argon2id.
- Session timeout: configurable, default 30 min idle for admin screens, POS lock screen after 5 min (PIN to unlock, not logout).
- Optional TOTP 2FA, mandatory for Super Admin and HO Admin (proposal).
- Device binding: a user can be restricted to specific terminals.
- Force logout and password reset by Super Admin/HO Admin.

## 8. Branch-scope rules

- Every query on a branch-owned table is filtered by the caller's allowed branch ids in the repository layer (not in the route), and tested.
- Cross-branch actions (transfers, HO price changes) check both branches' scope.
- Master data is tenant-wide and readable by any authenticated user with the resource `view` right, except cost fields.

## 9. Audit requirements

Log: login, failed login, logout, password/PIN change, permission or role change, every create/update/delete/void/refund, override, price change, export, backup and restore, sync repair actions. Each row holds old and new values, user, device, branch, time and a hash chain. Exports and report views of narcotic and audit data are themselves logged.

## 10. Tests

- Table-driven test: for each role and permission in this file, the effective grant matches this matrix.
- Route-level test: every route handler declares its required permission, and a lint check fails if one does not.
- Field-level test: cashier response for a sale, item and batch contains no cost, avg cost or profit keys.
- Override test: limits, expiry, single use, wrong PIN lock, self-approval refusal.
