# Mediescare: User Manual and Operating Guide

For pharmacy staff, branch managers and owners. Every step uses the exact words you see on the screen, shown in **bold**. Keyboard keys are shown like **F10**.

**Who does what.** Not every person sees every screen. The menu on the left shows only what your role may open. If a button or menu item is missing, your role does not have that right; ask your manager or owner.

| Role                          | Typical work                                                      |
| ----------------------------- | ----------------------------------------------------------------- |
| **Cashier**                   | POS, shifts, holding bills, small cash expenses from the till     |
| **Pharmacist**                | POS, items and stock, controlled drugs                            |
| **Store Keeper**              | Stock, receiving, stock counts, requesting stock from Head Office |
| **Purchase Officer**          | Suppliers, purchase orders, supplier bills and returns            |
| **Accountant**                | Accounts, cash book, reports                                      |
| **Branch Manager**            | Everything in the branch: approvals, voids, settings, users       |
| **Owner / Head Office Admin** | All of the above, all branches, prices, transfers approval        |

## Contents

1. [Getting started](#1-getting-started)
2. [Daily operations](#2-daily-operations)
   - [2.1 The POS screen (selling)](#21-the-pos-screen-selling)
   - [2.2 Purchasing and stock entry](#22-purchasing-and-stock-entry)
   - [2.3 Inventory and stock take](#23-inventory-and-stock-take-stock-take)
   - [2.4 Accounts and cash book](#24-accounts-and-cash-book-accounts)
   - [2.5 Multi-branch transfers](#25-multi-branch-transfers-transfers)
   - [2.6 End of day: close the shift](#26-end-of-day-close-the-shift-and-run-reports)
3. [Other things you will need](#3-other-things-you-will-need)
4. [Troubleshooting](#4-troubleshooting)
5. [Quick reference](#5-quick-reference)

---

## 1. Getting started

### 1.1 First-time setup

Do this once, on the computer that will hold the branch data. It takes about five minutes.

**Before you start, have ready:**

- The name of your organisation and your first branch.
- A strong password for the Owner (at least 10 characters).
- A pen and paper, or a printer, for the **Data Recovery Key** (you will need it in step 5).

#### Step 1. Choose how this computer will be used

When Mediescare opens for the first time it asks **How will this computer be used?**

| Choice              | Choose it when                                                                                 | What it means                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **Single PC**       | One computer runs everything. Best for a small branch with one or two counters on the same PC. | All data is on this PC.                                                                            |
| **Branch Server**   | This PC stores the branch data and **other counters connect to it** over the shop network.     | Choose this if you will add more counters (terminals).                                             |
| **Branch Terminal** | This is an **extra counter** that connects to the Branch Server. It keeps no data of its own.  | Do not choose this for the first computer. See [section 3.5](#35-adding-another-counter-terminal). |

If you are not sure, choose **Single PC**. If you already know you will add more counters, choose **Branch Server** from the start.

If you choose **Branch Server**, you will see a button **Let other counters connect**. It opens the Windows Firewall for your shop network only (ports TCP 3210 and UDP 3211). Windows will ask for administrator permission. Nothing changes unless you press it. You can also do it later from the **Network** menu.

Press **Continue**.

#### Step 2. Create the organisation and the Owner account

The screen **Create a new organisation** appears. Fill in:

| Field                         | What to enter                                                                                                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Organisation name**         | Your business name, for example your pharmacy group                                                                                                                                                                               |
| **Branch code**               | A short code for this branch: 2 to 8 capital letters or digits, starting with a letter, for example **HO01** or **KHI02**. It becomes the start of every document number (for example `KHI02-INV-000123`), so choose it carefully |
| **Branch name**               | For example "Head Office" or "Clifton Branch"                                                                                                                                                                                     |
| **Your full name**            | The Owner's name                                                                                                                                                                                                                  |
| **Username**                  | Lowercase letters, digits, dot, dash or underscore only, for example `owner` or `ali.khan`. No capital letters or spaces                                                                                                          |
| **Password (10+ characters)** | At least 10 characters. Do not use common passwords and do not include your username                                                                                                                                              |
| **Confirm password**          | The same password again                                                                                                                                                                                                           |

The first branch of a new organisation is **Head Office** (the main store). Other branches join it later.

Press **Create and continue**.

#### Step 3. Save the Data Recovery Key (very important)

A page **Save your recovery key** appears, showing a key made of 8 groups of 4 letters and digits.

> **This key is the only way to open your backups on a new computer, or if this computer's Windows profile is lost. It is shown once and is not stored anywhere else.**

1. **Write it down or print it.** Check every character.
2. Keep it somewhere safe, **away from this computer** (for example a locked drawer, or with the owner).
3. Tick **I have saved this recovery key in a safe place.** The button stays disabled until you do.
4. Press **Continue to sign in**.

If you lose the key you can create a new one later (**Backups** screen, **New recovery key**), but older backups still need the key that was current when they were made.

#### Step 4. Sign in

On the sign-in screen there are two tabs:

- **Password**: type your username and password. Use this for the Owner, managers and anyone who administers the system.
- **Quick PIN (counter)**: a short PIN for fast sign-in at the counter. A PIN can only be used for selling and counter work, never for administration. Set up PINs under **Users** (see [section 3.1](#31-adding-staff-users-roles-and-pins)).

After 5 wrong passwords an account is locked for 15 minutes.

### 1.2 Switching between English and Urdu

Mediescare works fully in English and in Urdu. Urdu switches the whole screen to **right-to-left**.

1. Look at the **top bar**, at the top of every screen.
2. Press the language button (it shows the other language: **اردو** when you are in English, **English** when you are in Urdu).
3. The screen changes at once. **Your choice is saved for your own sign-in.** Other staff keep their own language.

Notes:

- Numbers, money amounts, barcodes, dates and document numbers always use normal digits (0 to 9), in both languages.
- **Receipts and printed documents are always in English.**
- Some messages that come from the system itself (for example a database error) may still appear in English.

---

## 2. Daily operations

### 2.1 The POS screen (selling)

**Who:** Cashier, Pharmacist, Branch Manager. **Menu:** **POS**.

#### Before you sell: open your shift

You must open a shift before you can sell. When you open **POS** for the first time in the day, the screen **Open your shift** appears.

1. Take the cash that is in your drawer and **count it**.
2. Type the amount in **Opening cash (PKR)** (this is your float, for example 5000).
3. Press **Open shift**.

The shift number appears at the top (**Shift …**). If you try to sell without a shift, the system will not allow it.

#### Selling step by step

The cursor starts in the search box (**Scan barcode or type item name**). Press **F3** at any time to return to it.

**1. Add medicines**

- **With a barcode scanner:** scan the box. The medicine is added to the cart at once. (The cursor must be in the search box.)
- **By typing:** type part of the name, generic name or code. A list appears with the stock and the earliest expiry. Press **Enter** to take the first one, or click another.
- If nothing is found, the screen says **Nothing found … Press F8 to record a missed sale** (see below).

**2. Check the cart**

Each row shows **Unit**, **Batch**, **Qty**, **Disc %** and **Amount**.

- **Unit:** choose how you sell it, for example **Strip** or **Tablet** (or **Box**). The price adjusts automatically.
- **Qty:** type the quantity. To add one more quickly, press **Ctrl + Up Arrow**.
- **Batch:** the system chooses the batch that expires first (**Auto (first expiry)**). You can pick another batch if the customer wants it. **Expired batches can never be sold.**
- If it says **Only N in stock**, you cannot sell more than that.
- To remove a row use **Remove line**.

**3. Controlled drugs (narcotics)**

If an item is **Controlled**, a window **Controlled item** asks for the **Patient name**, **Patient CNIC** (13 digits, for example 42101-1234567-1) and **Doctor name**. This is saved in the narcotic register by law. You cannot complete the sale without it.

**4. Customer (optional)**

By default the sale is for a **Walk-in customer**. Press **F2** to choose a saved customer (search by name, phone or MR number) or **+ New customer**. You need a customer for a sale **on account** (credit).

**5. Apply a discount**

- **One medicine:** type a percentage in **Disc %** on that row.
- **Whole bill:** type a percentage in **Bill discount %** under the cart.
- Every role has a discount limit. If you go above yours, the window **Manager approval needed** appears. **A manager types their own username and PIN** and presses **Approve**. The approval works once and expires in 2 minutes. This is recorded.
- The same approval is needed to change a price, to sell below cost, or for refunds above your limit.

**6. Take payment**

The totals box shows **Sub-total**, **Tax**, **Rounding** and **Grand total (PKR)**. Bills are rounded to the nearest whole rupee by default (your manager can change this in Settings).

_Cash sale:_

1. Press **F9** for **Exact cash**, **or** press **+ Add payment**, choose the **Payment method** (for example Cash) and type **Amount received**.
2. If the customer gives more, the screen shows **Change**. Give it back.

_Card, wallet, bank or QR sale:_ press **+ Add payment**, choose that **Payment method**, and enter the amount. The payment must be the full bill.

_Split payment:_ press **+ Add payment** again and enter part of the amount in each method until **Due** shows 0.00. For example, 1000 in cash and 500 by card.

_Sale on account:_ add the customer first (**F2**), then choose the credit method for the part the customer will pay later. The customer's credit limit applies.

**7. Save**

Press **Save (F10)**. The window **Saved …** shows the invoice number. If the customer paid in cash and gave more than the bill, it shows **Give back** and the amount in large letters.

#### Printing the receipt and opening the cash drawer

- Press **Print receipt** in the **Saved** window. The receipt prints on the 80 mm thermal printer.
- If your manager turned on **Print the receipt automatically after each sale** (Settings), it prints by itself.
- **The cash drawer opens by itself** when a sale has a cash payment, if your manager turned on **Open the cash drawer when a sale has a cash payment** (Settings). The drawer is connected to the printer.
- Press **New sale** to start the next customer.

If the printer does not work, the sale is **still saved**. You can print later from **Sales** (open the invoice). In a normal web browser (not the desktop app) the browser's own print window is used instead of the thermal printer.

#### Other counter actions

| What you want                                               | How                                                                                                    |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Hold a bill** while the customer fetches something        | Press **F4** (**Hold**). The bill is saved on the server                                               |
| **Recall** a held bill (on any counter)                     | Press **F5** (**Recall**), choose it from **Held invoices**                                            |
| **Missed sale** (customer wanted something you do not have) | Press **F8**, type the item and the customer's phone if you like. Purchasing will see it when ordering |
| **Clear** the cart                                          | **Clear**                                                                                              |
| Close your shift                                            | **F12** (see [section 2.6](#26-end-of-day-close-the-shift-and-run-reports))                            |

#### Returns and cancelling a sale

Open **Sales** in the menu, search the **Invoice number**, press **Open**.

- **Return items:** enter **Return qty** for each line (in the smallest unit, for example tablets), choose the **Return reason** and the **Refund method**, and decide **Put back on the shelf** (tick it if the goods are saleable). Press **Give refund**.
- **Void invoice:** only for a sale made in **your own still-open shift**. Give a reason. The stock goes back and the invoice stays in the books, marked void.
- **Posted invoices are never edited or deleted.** Large refunds need a manager's approval.

---

### 2.2 Purchasing and stock entry

**Who:** Purchase Officer, Store Keeper, Branch Manager. **Menu:** **Purchasing** (and **Stock**).

The **Purchasing** screen has four tabs: **Purchase orders**, **Supplier bills**, **Returns to suppliers** and **Suppliers & payments**.

#### Add a new supplier

1. Open **Purchasing**, tab **Suppliers & payments**.
2. Press **Add supplier**.
3. Type the **Supplier name** and press **Add**.

(You can also press **+** beside the supplier list while receiving stock.) The screen currently asks only for the name.

#### Order stock from a supplier (optional but recommended)

1. **Purchasing**, press **New purchase order**.
2. Choose the **Supplier** and, if you like, **Expected on** and a **Note**.
3. Add items: type a name in **Type an item name to add a row**, or press **Fill from low stock**. That button adds everything at or below its reorder level and everything customers asked for and you did not have (missed sales), with a suggested quantity.
4. For each row check the **Unit**, **Qty** and **Price / unit**.
5. Press **Save as draft**.
6. Open the order (click it) and press **Approve** (needs the approve right). The order can be printed with **Print**.
7. When the goods arrive, open the order and press **Receive goods** (next section).

A draft can be edited with **Edit**. An approved order cannot be changed; use **Cancel order** (with a reason) and write a new one.

#### Receive stock and enter the supplier's bill

Use **Receive goods** from an approved order, or press **Add stock without an order** (also available on the **Stock** screen as **Add stock**).

**Prerequisites:** the supplier exists, and every item already exists in **Items**.

1. Choose the **Supplier**. Type the **Supplier invoice no.** and the **Invoice date** from the paper bill.
2. Add each item: type in **Type an item name to add a row**. When you receive against an order, the rows are already filled in.
3. For each row fill in:

| Field            | What to enter                                                        |
| ---------------- | -------------------------------------------------------------------- |
| **Unit**         | What the supplier counted in, for example **Strip** or **Box**       |
| **Qty**          | How many you **paid for**                                            |
| **Bonus**        | Free units the supplier added (these lower the real cost per unit)   |
| **Batch no.**    | The batch number printed on the pack (required)                      |
| **Expiry**       | The expiry date on the pack (required). **Expired stock is refused** |
| **Price / unit** | The price of **one unit** (for example one strip)                    |

The **Amount** of each row and the total of **Goods** are worked out for you.

4. Fill in the bill totals under the table, as printed on the supplier's invoice (all in PKR):

| Field              | Meaning                                                                        |
| ------------------ | ------------------------------------------------------------------------------ |
| **Discount**       | Discount on the bill                                                           |
| **Sales tax**      | Sales tax charged                                                              |
| **Advance tax**    | Advance tax charged                                                            |
| **WHT (withheld)** | Withholding tax that **you** withhold when paying the supplier (kept separate) |
| **Freight**        | Carriage or delivery charge                                                    |

**The standard formula the system uses:**

> **Bill total = Goods − Discount + Sales tax + Advance tax + Freight**
>
> **You pay the supplier: Bill total − WHT**

_Example:_ Goods 18,000 − Discount 500 + Sales tax 300 + Freight 200 = **Bill total 18,000**. If WHT is 100, you pay the supplier **17,900**.

**Shortcut:** if your manager has set the default tax rates in **Settings**, press **Fill taxes from branch rates**. It fills Sales tax and WHT from the goods after discount, and Advance tax from the goods after discount plus sales tax. Check the numbers against the supplier's paper bill and change them if they differ. Nothing is final until you save.

5. Add a **Stock note** if you like.
6. Press **Receive stock**. A message **Stock received: …** with the bill number appears. The stock is now on your shelf, with its batch and expiry.

#### Pay a supplier

1. **Purchasing**, tab **Suppliers & payments**, click the supplier. Their account opens (**We owe**, aging, unpaid bills).
2. For a bill, press **Pay** next to it. For a payment on account, press **Record payment**.
3. Enter the **Amount**, choose **Paid by**, add a **Reference** (cheque or transfer number) and press **Save payment**.

A payment cannot be larger than what the bill still owes. Payments are never edited; a mistake is corrected with a new entry. The **Supplier bills** tab (with **Unpaid only**) shows what is still due.

#### Return goods to a supplier (purchase return)

Use this for damaged, expired, near-expiry, wrong or recalled goods.

1. **Purchasing**, press **Return to supplier** (or open the tab **Returns to suppliers**).
2. Choose the **Supplier** and the **Reason** (**Damaged**, **Expired**, **Near expiry**, **Wrong item sent**, **Overstock**, **Recall** or **Other**). Type the supplier's **Supplier credit note no.** if they gave you one.
3. In **Find item** type the medicine. The batches that are in stock appear. **Click the batch that is going back.**
4. Choose the **Unit** and enter the **Return qty**. You cannot return more than the batch holds.
5. The **Credit** is worked out at the batch's cost.
6. Press **Return goods**.

The stock leaves your shelf, and the credit **reduces what you owe that supplier** in their account. A posted return cannot be edited.

---

### 2.3 Inventory and stock take (/stock-take)

**Who:** Store Keeper, Pharmacist, Branch Manager. **Menu:** **Stock** and **Stock take**.

#### Look up an item and its expiry

1. Open **Stock**.
2. Type in **Search stock** (name, generic name or code). Use the **Filter** to show **All items**, **In stock** or **Low stock**.
3. Each row shows **On hand**, **Sellable**, **Expired**, **Reorder at**, **Earliest expiry** and **Value** (value only for roles allowed to see cost).
4. Click a row to see its **Batches**: batch number, **Expiry**, how many **days left**, and whether a batch is **Blocked**. Expiry colours warn you before the date (the default warning windows are 30, 60, 90 and 180 days).

**Strip versus box versus tablet.** Stock is counted in the **smallest unit** (for example tablets). Numbers on the **Stock** screen are in that unit. If an item is set up as 1 strip = 10 tablets and 1 box = 100 tablets, then 470 tablets means 47 strips or 4 boxes and 7 loose tablets. When you sell or receive, you choose **Tablet**, **Strip** or **Box** and the system converts. In a stock count you enter packs plus loose units (below). To see an item's pack sizes, open **Items**.

The **Expiry** report (menu **Reports**) lists stock already expired and stock expiring in 0–30, 31–60, 61–90 and 91–180 days. Check it regularly and return or sell near-expiry stock first.

#### Correct one batch quickly (adjustment)

1. On **Stock**, click the item, then press **Adjust** beside the batch.
2. Enter **Change** (a plus number adds, a minus number removes, in the smallest unit).
3. Choose the reason: **Stock count correction**, **Damaged**, **Expired, written off**, **Used inside the pharmacy**, **Free sample**, **Lost**, **Found** or **Other (describe)**.
4. Add the **Note** (required for Other) and press **Save adjustment**.

You cannot remove more than the batch holds.

#### Do a physical stock count (stock take)

Use this to compare the shelf with the system, for example monthly, or for one rack at a time.

**Prerequisites:** only one count can be open at a time. To count, you need the right to create counts; to **post** the result you need the separate **approve** right (usually the manager).

1. Open **Stock take** and press **Start a count**.
2. Type a **Count name** (for example "Full count" or "Rack A"). Under **What to count** choose **Everything in stock**, **One category** or **One rack**. Press **Start count**.
3. **At this moment the system freezes what it expects.** You can keep selling; sales made during the count are kept.
4. The count sheet lists every batch with **System** quantity. Count the shelf and, for each row, enter what you find in the boxes: the **packs** (for example Strip) and the **loose** units (for example Tablet). The count saves when you leave the box.
5. Use the buttons **All**, **Not counted** and **Differences** and the search box (**Item, code or batch**) to find rows. The top shows how many are counted and the **Shortage at cost** and **Surplus at cost** (cost only for allowed roles).
6. When finished, a manager presses **Post differences**. A window explains: only the differences are written to the stock record and the count closes. If some batches were not counted, choose **Leave them as they are** or **Treat them as not found (count zero)**. Press **Post differences**.
7. The window **Count posted** shows how many batches were adjusted. If a shortage was bigger than what is left (because stock was sold during the count) it is limited and reported.

A posted count **cannot be undone**; a mistake is fixed with a new adjustment or a new count. To abandon a count that has not been posted, press **Cancel count** and give a reason.

---

### 2.4 Accounts and cash book (/accounts)

**Who:** Accountant, Branch Manager, Owner. Cashiers can add small expenses. **Menu:** **Accounts**.

The screen has four tabs: **Expenses**, **Categories**, **Cash book** and **Profit and loss**. Buying stock is **not** an expense here: it is recorded in Purchasing and becomes a cost when the goods are sold.

#### Set the opening cash balance (once)

The cash book starts at **zero** on the day you first use the system. Tell it how much cash was already there:

1. Open **Accounts**, tab **Cash book**. Scroll to **Cash book entries**.
2. Press **Add entry**.
3. Choose **Type: Opening balance**. Enter the **Amount (PKR)** (the cash in your safe and till).
4. **Date:** leave empty for today, or choose the day you start tracking.
5. In **What is it for?** write a short note (for example "Cash on the day we started").
6. Press **Save**.

Rules: there is **one opening balance per branch** and it cannot be negative. If you made a mistake, use **Void entry** (with a reason) and enter the correct one. Voided entries stay on record but do not count.

To correct the cash later (a count that did not match, or money the owner puts in or takes out), use **Add entry** with **Type: Adjustment**, choose **Add cash** or **Remove cash**, and always write what it is for.

#### Add a daily expense (petty cash)

1. Tab **Expenses**, press **Add expense**.
2. Fill in: **Category** (for example Rent or Utilities), **Amount (PKR)**, **Paid by** (Cash, Bank and so on), **Date** (default today), **Paid to**, **Receipt or reference no.** and **Note**.
3. Press **Save**.

The expense gets a voucher number. Under **Expenses** you can filter by category, payment method and dates. If you made a mistake, press **Void** next to it and give a reason: it stays in the list, marked void, and is no longer counted.

To manage the list of categories use tab **Categories** (**Add category**, **Rename**, **Hide**). A category that has past expenses is hidden, never deleted.

#### Take money from your till (till cash deduction)

When a cashier pays a small cash expense **out of the till** (for example tea or courier), record it so that the shift cash count still balances:

1. Make sure **your shift is open** (see section 2.1).
2. **Accounts**, **Add expense**. Choose **Paid by: Cash**, enter the amount and details.
3. Tick **Taken from my till**. The hint explains: it **lowers the cash your open shift should hold**.
4. Press **Save**. The expense shows a **from till** label.

Use it only for cash taken from your drawer, dated today. Leave it **off** for cash paid from the safe or the office. A till expense **cannot be voided after its shift is closed**; ask a manager to make a correcting entry instead.

#### View the cash book

Tab **Cash book**: choose the dates (Today, This month and so on) and read:

- **Opening cash**, **Cash in**, **Cash out** and **Closing cash**.
- **Cash movement**: cash taken on invoices, cash refunded, cash expenses, cash paid to suppliers, and your cash book entries.
- **Expenses by category**, **By payment method** and a **Day by day** table with the closing cash of each day.

Shift floats move cash between the safe and the till; they are not income or expense. Buttons **Export Excel** and **Print / Save as PDF** give you a copy.

#### View Net Profit and Loss

Tab **Profit and loss**: choose the month or dates. It shows:

> **Net profit = revenue without tax (after returns) − cost of the goods sold − expenses**

You see revenue, cost of goods, **gross profit**, expenses by category and **net profit**. Cost and profit lines are visible only to roles allowed to see them. Use **Export Excel** or **Print / Save as PDF**.

---

### 2.5 Multi-branch transfers (/transfers)

**Who:** Store Keeper and Branch Manager at the branch; Head Office staff for approving and dispatching. **Menu:** **Transfers**.

Head Office holds the main store and buys from suppliers. Branches ask Head Office for stock. Goods are sent **at cost** (no extra margin). Head Office also **sets the prices and tax rates for every branch**: a branch cannot change them.

The journey of stock:

> **Requisition** (branch asks) → **Approval** (Head Office) → **Transfer note** (Head Office picks batches) → **Dispatch** (stock leaves Head Office, now **in transit**) → **Receive** (branch counts) → **Closed**

The branch screen says "Ask Head Office for stock and count what arrives". The Head Office screen says "approve requisitions, write transfer notes and dispatch".

**Prerequisite:** both PCs must be connected to the cloud (**Settings**, Cloud sync), because documents travel between branches through the cloud. If the internet is down, work continues locally and the documents arrive later.

#### A. At the branch: request stock from Head Office

1. Open **Transfers**, tab **Requisitions**, press **New requisition**.
2. Search an item (**Search an item by name or code…**) and add it. Enter the quantity (in the item's unit). Add more items the same way.
3. Set **Needed by** if you like, and a **Note**.
4. Press **Send to Head Office**. A message **Requisition … sent to Head Office** appears and its status is **waiting**.

You can **Cancel requisition** (with a reason) while it is still waiting.

#### B. At Head Office: approve and dispatch

1. **Transfers**, tab **Requisitions**. Open the requisition that is **waiting**.
2. Check the quantities in **Approved quantity**. You may **lower** a quantity (0 leaves the item out). You cannot approve more than was asked. Press **Approve**.
3. Press **Write transfer note**. The system picks batches **first expiry first** for you.
4. Open the draft in tab **Transfers**. In the note you can change the batch for a line (**Batch (first expiry first)**). Expired, blocked or empty batches are not allowed, and you cannot send more than you have. The page shows **Goods are sent at batch cost. Nothing leaves your stock until you dispatch the note.**
   - For stock the branch did not request, use **New transfer note**, choose **None (direct transfer)** and **Send to** the branch.
5. Press **Print A4** if you want a paper copy for the driver.
6. Press **Dispatch**. The goods **leave Head Office stock and are in transit**: they are in nobody's stock until the branch receives them. The message says **Transfer … dispatched. The goods are in transit**.

To abandon a note before dispatch, use **Cancel note**.

#### C. At the branch: receive the incoming stock

1. **Transfers**, tab **In transit / Receive**. The list shows transfers dispatched to your branch.
2. Open the transfer and press **Receive**. The window **Receive …** says: count what is in front of you.
3. For each line enter, in the smallest unit (for example tablets):
   - **Received**: good units that go into your stock.
   - **Damaged**: units that arrived broken or spoiled.
   - Anything dispatched but **neither received nor damaged** is counted as **short** (missing).
4. Add a **Note** (for example what happened to the damaged goods).
5. The window shows **N damaged and N short will be recorded as a loss at cost.**
6. Press **Receive into stock**.

The good units enter your stock **with the same batch number and expiry** as Head Office sent. Damaged and short units **never enter your stock** and are written off as a loss at cost. A transfer can be received **only once**, so count carefully before you press the button.

#### D. Checking that everything adds up (reconciliation)

Tab **Reconciliation** shows, for each branch, what was **Dispatched**, what is **In transit**, what was received, and the **Damage and shortage loss**, all at cost. **Every transfer balances** means dispatched equals received + damaged + short. The **Stock ledger check** (press **Check again**) confirms that nobody's stock is below zero and that the stock history is consistent. A receipt reaches Head Office after the branch syncs, so Head Office may show goods as in transit until then.

---

### 2.6 End of day: close the shift and run reports

#### Close your shift and count the cash

Do this when you finish your work, or at the change of shift.

**Before you start:** finish or hold any open bill. Take the cash out of the drawer and count it once, carefully, **without looking at what the system expects** (a "blind count").

1. On **POS**, press **F12** (or **Close shift**). The window **Close shift …** says: count all the cash in the drawer and enter the total. The system total is shown only after you save.
2. Type the total in **Cash counted (PKR)**. Count **everything**: your float and all the day's cash sales.
3. Press **Close shift**.
4. The window **Shift closed** shows:
   - **Expected in drawer** (float + cash sales − cash refunds − cash expenses you took from the till),
   - **You counted**,
   - **Difference**.
   - A message tells you: **The drawer matches.**, **The drawer has more than expected.** or **The drawer is short. A manager will review it.**
5. Hand the cash to the manager or put it in the safe as your shop's rules say.

If there is a difference, do not try to fix it by editing sales (posted sales cannot be edited). Tell your manager; they can review the day and make a cash book adjustment if needed.

#### Run the daily sales report

1. Open **Reports** in the menu.
2. Choose **Sales by day**. (Other useful ones: **Invoices**, **Sales by item**, **Sales by cashier**, **Sales by payment mode**, **Discounts given**, **Current stock**, **Low stock**, **Expiry**, **Narcotic register**, **Missed sales**, **Expenses**, **Cash flow**, **Profit and loss**, **Net profit**.)
3. Choose the dates: **Today**, **Yesterday**, **This week**, **This month**, **Last 30 days** or **Custom**.
4. Read the table and the totals on top.
5. Press **Export Excel** to save a spreadsheet, or **Print / Save as PDF** to print or save a copy.

Compare the report's cash figure with the shift close result and the **Cash book**. Reports show only what your role may see; cost and profit columns are hidden from roles without the right.

#### End-of-day checklist (manager)

- [ ] All shifts closed and any cash differences noted
- [ ] **Sales by day** report printed or saved
- [ ] Today's expenses entered in **Accounts**
- [ ] Held bills cleared (**F5** shows none left)
- [ ] Open **Backups**: the daily backup exists (an automatic backup is made every day). Once a week press **Copy to drive** to put a copy on an external drive

---

## 3. Other things you will need

### 3.1 Adding staff: users, roles and PINs

**Who:** Owner and managers. **Menu:** **Users**.

1. Press **Add user**. Enter **Username** (lowercase letters, digits, dot, dash, underscore), full name and **Roles**.
2. A temporary password is created. The person must change it the first time they sign in.
3. To give a cashier a fast counter sign-in, press **PIN** beside the user and set a **New PIN** of 4 to 6 digits. A PIN is also used for manager approvals. It cannot open administration screens.
4. **Password reset** gives a new temporary password if someone forgets theirs.
5. To stop someone working, disable the user; they are signed out at once. Nothing is ever deleted; the history stays.

### 3.2 Items: adding a medicine

**Menu:** **Items**, press **Add item**. Fill in **Name**, **Generic name**, **Barcodes (comma separated)**, the units and pack sizes (for example Tablet, Strip = 10 tablets, Box), **Selling price** and reorder level, and tick **Prescription required**, **Controlled / narcotic** or **Cold chain** where they apply (the reorder level is **Reorder level** in the smallest unit). Press **Save item**. If your branch is not Head Office, the price and tax fields are read-only because Head Office sets them.

To load many items from Excel use **Import from Excel** on the Items screen: download the template, fill it in, upload it, check the preview and then import. Rows that already exist are skipped, so it is safe to run twice.

### 3.3 Settings (managers and owners)

**Menu:** **Settings**, then **Save settings**.

- **Billing:** **Round the bill total to** (nearest whole rupee, nearest 50 paisa or none) and a **Note printed on invoices**.
- **Tax rates:** your default **Sales tax**, **Advance tax** and **Withholding tax (WHT)** percentages. They only pre-fill forms.
- **Receipt printer:** pick your printer, **Paper width** (80 mm), **Copies**, **Drawer connector** (try **Pin 2** first, **Pin 5** if the drawer does not open), and the two ticks for printing automatically and opening the drawer on cash. Use **Print test receipt** and **Open cash drawer** to test before you save. The printer list and test buttons work only in the Mediescare desktop app.
- **Cloud sync and terminals:** see the next section.

### 3.4 Backups and the recovery key

**Menu:** **Backups**. A backup is made automatically every day and is encrypted. Press **Back up now** for an extra one, **Verify** to check it, and **Copy to drive** to keep a copy on an external drive. Keep some copies away from the shop.

To restore (for example on a new computer), use the desktop menu **Data → Restore from backup…** and have your **Data Recovery Key** ready. Restoring replaces all data on that computer.

### 3.5 Adding another counter (terminal)

1. The main PC must have been set up as **Branch Server** (section 1.1).
2. On the Branch Server open **Settings → Cloud sync and terminals** and press **New terminal pairing code**. A code like 1234-5678 appears. It works **once** and for **10 minutes**.
3. On the new PC choose **Branch Terminal** in the first-run window. It searches the network and lists the servers it finds. Choose yours (or type its address if none is found).
4. Enter the **Pairing code** and press **Pair**. The terminal opens the server's sign-in screen.
5. If the terminal cannot reach the server it shows **cannot reach the branch server** with **Retry**, **Re-pair** and **Change server**. Check that the server PC is on, on the same network, and that the firewall step in 1.1 was done.

### 3.6 Adding a branch (owner only)

1. On the Head Office PC open **Branches** and create an **enrollment code** for the new branch (branch code and name). The code is shown once and works once for 24 hours.
2. On the new branch PC, in the first-run setup choose **Join an existing organisation**, enter the **Cloud address** and the **Enrollment code**, then your own owner name, username and password, and press **Join and continue**. It receives the items and other data from Head Office (it can take a few minutes; keep the window open, internet is needed for this step only).
3. Save the new PC's **recovery key** when it is shown.

---

## 4. Troubleshooting

| Problem                                          | What to do                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Open your shift" appears when I try to sell     | Open a shift first (**Opening cash (PKR)**, **Open shift**)                                                                                                                              |
| A medicine cannot be sold ("no sellable stock")  | All its batches are expired, blocked or empty. Check **Stock → Batches**. Expired stock can never be sold                                                                                |
| The barcode scanner types but nothing is added   | Click the search box or press **F3**, then scan again. Check the barcode exists on the item                                                                                              |
| A manager approval is asked                      | Your discount, refund or price change is above your limit. The manager types their own username and PIN                                                                                  |
| The receipt does not print                       | The sale is saved anyway. In **Settings** check the printer name and use **Print test receipt**. Printing works in the desktop app only                                                  |
| The cash drawer does not open                    | Check the cable is in the printer's RJ11 socket, use **Open cash drawer** in Settings, try **Pin 5**, and make sure the drawer option is ticked                                          |
| Cannot receive stock: "expired" or missing batch | Enter the batch number and a future expiry date for every row                                                                                                                            |
| Stock count: I cannot start a count              | Another count is open. Finish or cancel it first                                                                                                                                         |
| Transfer cannot be received                      | It must have been dispatched and have reached your branch (needs sync). Check **Settings → Cloud sync**                                                                                  |
| The internet is down                             | Keep working. Everything is saved on this PC and sent to the cloud automatically later (**Settings** shows **Waiting to send**)                                                          |
| I forgot my password                             | Ask the owner or manager for **Password reset** on the **Users** screen                                                                                                                  |
| I lost the recovery key                          | The system still works, but backups cannot be opened on another computer. Create a new key under **Backups → New recovery key** and keep it safe. Older backups still need their old key |
| A screen or button is missing                    | Your role does not have that right. Ask the manager                                                                                                                                      |

If something unexpected happens, write down the message exactly as shown and the time, and ask your manager or support.

## 5. Quick reference

**POS keys**

| Key                 | Does                         |
| ------------------- | ---------------------------- |
| **F2**              | Choose the customer          |
| **F3**              | Go to the search box         |
| **F4**              | Hold the bill                |
| **F5**              | Recall a held bill           |
| **F8**              | Record a missed sale         |
| **F9**              | Exact cash                   |
| **F10**             | Save the sale                |
| **F12**             | Close the shift              |
| **Esc**             | Clear the search             |
| **Ctrl + Up Arrow** | One more of the selected row |

**Golden rules**

1. Count the opening cash when you open a shift, and count all cash at close.
2. Never sell expired medicine. The system will stop you; do not look for ways around it.
3. Posted documents are never edited or deleted. Use a **return**, a **void** (with a reason) or a **correcting entry**.
4. Always type the real batch number and expiry when receiving stock.
5. Keep the **Data Recovery Key** safe and away from the computer.
6. Keep working if the internet is down. Nothing is lost.
