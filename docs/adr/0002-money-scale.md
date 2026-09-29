# ADR-0002: Money representation and rounding

Status: **Proposed** (needs approval). Date: 2026-09-30.

## Context

Pharmacy prices are quoted per pack but sold per strip or per tablet. A pack cost of PKR 187.50 for 30 tablets is PKR 6.25 per tablet, and a bonus-quantity purchase can make per-tablet cost land on fractions of a paisa. CLAUDE.md forbids floats and asks for a higher fixed scale for per-unit cost. The HCloud screenshots show one day's revenue as 4,663.08 on most reports and 4,663.07 on one, which we must not repeat.

## Decision (proposed)

| Quantity | Type | Scale |
|---|---|---|
| Any **posted amount** (line totals, discounts, taxes, payments, balances, ledger entries) | integer, `*_minor` | **1 paisa** (1 PKR = 100) |
| **Per-unit rate or cost** (unit cost, batch cost, sale rate per smallest unit, transfer price) | integer, `*_unit_micro` | **1 micro-PKR = 0.000001 PKR** (1 paisa = 10,000 micro) |
| **Quantity** | integer in the smallest stocking unit | 1 tablet (or the item's base unit) |
| **Rates and percentages** (tax, discount) | integer basis points, `*_bp` | 1 bp = 0.01 % |
| Currency | `PKR` fixed for now | no currency column until multi-currency is needed |

Rules, all in `packages/core/money` and unit-tested:

1. Products of rate and quantity use **BigInt** internally, then convert. Values are stored as SQLite INTEGER (64-bit) and Postgres `bigint`. JS `number` is never used for money maths.
2. `line_amount_minor = round( qty_base x rate_unit_micro / 10,000 )`. **Rounding happens once per line**, when the line amount is created, using **round half up** on the magnitude (0.5 paisa rounds away from zero). Half-even is rejected because cashiers and auditors expect 0.5 to round up.
3. Order of operations: line discount, then tax on the discounted amount (or tax-inclusive extraction if the item is tax-inclusive, decided by open question Q7), each rounded once to paisa.
4. Bill totals are the **sum of rounded line values**, never a recomputation from unrounded parts. Every report that sums lines therefore equals the invoice total.
5. **Bill rounding** (for example to the nearest PKR 1) is a separate stored value `rounding_minor`, configurable per branch, never hidden in another field.
6. Cost of sale = sum over batch allocations of `qty x batch cost`, each rounded to paisa per allocation and stored on the allocation row. Profit is computed from those stored values.
7. A bill-level discount is spread over lines with the **largest remainder method**, so the parts add up exactly.
8. Display formatting is separate from storage: PKR with grouping (`1,234.50`), Western digits in both languages.
9. Negative zero cannot occur.

## Consequences

- Column names carry the unit, so a mismatch is visible in review.
- A 64-bit integer at 1 micro-PKR holds rates up to about PKR 9 trillion per unit, far beyond need.
- Excel import parses decimal strings straight into these integers, never through floats.
- A **reconciliation test** asserts that one day's revenue is identical on every report.

## Alternatives considered

- Decimal strings or `numeric`: SQLite has no exact decimal type. Rejected.
- Rates at 1/100 paisa: simpler, but loses precision on large bonus purchases. Rejected.
- Half-even rounding: statistically neutral, but surprises users. Rejected unless tax rules or the owner require it (Q7).
