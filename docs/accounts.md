# Basic accounts: expenses, cash book, profit and loss

Owner decision: basic cash-flow and profit-and-loss level accounting, no double-entry. Screen: `/accounts` (menu "Accounts", permission `finance.expense.view`). Also in the Reports hub under Finance and Profitability.

## What is included

- **Expenses** (`KHI01-EXP-000001`): category, amount, paid by (a payment method), date, payee, reference, note. Immutable once posted (database triggers: no edit, no delete). A wrong expense is **voided** with a reason; it stays in the list and the reports marked void and is not counted in totals. Dated today or earlier; a date other than today (backdating) needs `pharmacy.sale.backdate`.
- **Expense categories:** twelve editable defaults (Rent, Salaries and wages, Electricity, ...) are created the first time the list is opened. Add, rename, change kind (operating, payroll, rent, utilities, other) and hide. A category is never deleted.
- **Cash book:** opening cash, cash in, cash out, closing cash, by payment method (cash, bank, wallet, card), expenses by category, and day by day.
- **Profit and loss** (report `net-profit`), plus reports `expenses` and `cash-flow` for print and Excel.
- Everything is per branch (the session branch). Money is integer paisa.

## Formulas

Cash only (payment methods of kind cash). Credit (on account) is not money.

```
cash in      = cash taken on posted invoices (after change)
cash out     = cash refunds on returns
             + posted cash expenses (till or back office)
             + supplier payments made in cash
closing cash = opening cash + cash in - cash out
opening cash = (cash in - cash out) over everything before the first day of the range
```

Shift floats are moved between the safe and the till, so they are neither in nor out. A voided invoice (only possible inside an open shift) is not a sale, so it never counts. A voided expense is left out.

```
net revenue  = invoices without tax - returns without tax        (same as the Profit and loss report)
cost of goods = batch cost of what was sold - cost of restocked returns
gross profit = net revenue - cost of goods
expenses     = posted expenses dated inside the range, by category
net profit   = gross profit - expenses
```

Shown below the profit but **not part of it**: purchases of stock in the range (bills less purchase returns), because stock is an asset until it is sold, and what is owed to suppliers today.

Dates: sales, refunds and supplier payments fall on their branch-local day; an expense falls on its `expense_date`.

## Till cash and back-office cash (the one place they differ)

- A shift's **expected cash** = float + cash sales - cash refunds - **cash expenses taken from that shift's till**. Closing a shift still uses the blind count against this figure.
- **Supplier payments are back-office** and never change a shift.
- An expense is **back office by default**. Ticking "Taken from my till" (cash only, today, needs the user's open shift) links it to the shift, which lowers its expected cash. Such an expense cannot be voided after that shift is closed (the cash count is final); record a correcting entry instead.
- Reconciliation, proven by a test: closing cash of a day = sum of (expected cash - float) of the shifts + 0 - back-office cash paid out (cash expenses not from a till + cash supplier payments).

## Permissions

Existing keys, no new ones (so existing databases keep working): view `finance.expense.view`, add `finance.expense.create`, void `finance.expense.delete` (a delete right means void because nothing is deleted), categories `finance.expense_category.create/edit`, cash book `reports.financial.view/export`, net profit `reports.profit.view/export`. The net-profit report hides its cost and profit lines for users without view-cost / view-profit (`pharmacy.sale.view_cost`, `pharmacy.sale.view_profit`) on the server, also in the Excel export.

Defaults: Accountant `finance.*` and `reports.*`; Auditor read-only; Branch Manager view, create, **void** and export expenses (new databases; an existing database keeps its roles, grant `finance.expense.delete` on the Roles screen); Cashier view and create (till expenses). HO Admin and Super Admin everything.

## Not included

No chart of accounts, no double-entry, no balance sheet, no trial balance, no bank reconciliation, no tax returns, **no payroll** (salaries are entered by hand as an expense category), no petty-cash book separate from expenses, no attachments, no inter-branch accounting for transfers, no opening cash setting (opening cash starts at zero on the first day of use), no consolidated all-branches view.

## API

`GET/POST /api/expenses`, `POST /api/expenses/{id}/void`, `GET /api/expenses/cash-flow`, `GET/POST /api/expense-categories`, `PATCH /api/expense-categories/{id}`, reports `GET /api/reports/{expenses|cash-flow|net-profit}` and `/export?format=xlsx`.

## Sync

Tables `expense_categories` and `expenses` exist in both schemas (SQLite `0011`, Postgres `0009`) and every write adds outbox entries (`entityType` `expense_categories`, `expenses`). The sync pull appliers and the cloud store need to know these two entity types.

## Cash book entries: opening balance and corrections

Owner decision (2026-10-04): the cash book starts at zero, and the owner can set the opening cash with an entry.

- **Opening balance:** one per branch, entered on the day cash tracking starts (Accounts > Cash book > "Add entry"). It cannot be negative. To change it, void it (with a reason) and enter a new one.
- **Adjustment:** adds or removes cash (a count that did not match, money the owner puts in or takes out). A note saying what it is for is required.
- Entries are numbered `CSH`, immutable once posted (database triggers) and voided with a reason, like expenses. Voided entries stay on record and do not count.
- In the cash book an entry dated before the first day of the range is part of the **opening cash**; inside the range it shows as cash in (adds) or cash out (removes) and moves the closing cash. They are counted under the first active cash payment method.
- Permission: `finance.ledger.create` (Accountant through `finance.*`, admins, and now Branch Manager).

## Role migration

Migration `0013_grant_branch_manager_finance` (SQLite) and `0011_grant_branch_manager_finance` (Postgres) give the built-in Branch Manager role `finance.expense.delete` (void expenses), `finance.expense.export` and `finance.ledger.create` on existing databases. It only adds rows, never touches custom roles or other roles, and is safe to run twice. New databases already get these from the role definition.
