# Financial rules

## Money representation

* All amounts are **integer cents** (USD). JavaScript floating point is never used for authoritative amounts: the server validates integers (`zCents`), multiplies/divides with `mulDiv` (integer, round half away from zero), splits totals with a largest-remainder `allocate` that always sums exactly, and expresses percentages in basis points.
* User input such as `12.50` is parsed digit-by-digit (`parseToCents`); `1.234` is rejected.

## Chart of accounts

| Code | Account | Type |
| --- | --- | --- |
| 1000 | Cash on Hand | Asset |
| 1010 | Bank Account | Asset |
| 1020 | Mobile Money Clearing | Asset |
| 1100 | Accounts Receivable | Asset |
| 1200 | Inventory Asset | Asset |
| 1210 | Returned Goods Awaiting Inspection | Asset |
| 1300 | Supplier Advances & Credits | Asset |
| 1500 | Fixed Assets (Capital Expenditure) | Asset |
| 2000 | Accounts Payable | Liability |
| 2100 | Tax Payable | Liability |
| 2200 | Customer Store Credit | Liability |
| 2300 | Loans Payable | Liability |
| 3000 | Owner Capital · 3100 Owner Drawings · 3200 Retained Earnings · 3300 Opening Balance Equity | Equity |
| 4000 | Sales Revenue · 4900 Other Income | Revenue |
| 4100 | Sales Returns · 4200 Sales Discounts | Contra-revenue |
| 5000 | Cost of Goods Sold · 5100 Inventory Shrinkage & Damage | Expense |
| 6000 | Operating Expenses · 7000 Other Non-operating Expenses | Expense |

## Postings

| Event | Debit | Credit |
| --- | --- | --- |
| Goods received (landed cost) | Inventory | Accounts Payable (supplier) |
| Supplier payment | Accounts Payable | Cash / Bank / Mobile money |
| Supplier return (credit) | Accounts Payable or Supplier credits | Inventory |
| Sale | Accounts Receivable (customer) · Sales Discounts · COGS | Sales Revenue · Tax Payable · Inventory |
| Payment received at POS / later | Cash / Bank / Mobile money (or Store Credit) | Accounts Receivable |
| Overpayment kept as credit | Cash … | Customer Store Credit |
| Customer return | Sales Returns · Tax Payable · Inventory (good) / Shrinkage (damaged) / Awaiting inspection | Accounts Receivable · COGS |
| Refund of excess paid | Accounts Receivable | Cash / Bank / Mobile money / Store Credit |
| Inspection: restock / write-off | Inventory / Shrinkage | Awaiting inspection |
| Stock adjustment − / + | Shrinkage / Inventory | Inventory / Shrinkage (Opening Balance Equity for opening stock) |
| Operating expense | Operating Expenses | Paying account |
| Capital expenditure / owner drawing / loan repayment | Fixed Assets / Owner Drawings / Loans Payable | Paying account |
| Capital injection, loan received, opening cash | Paying account | Owner Capital / Loans Payable / Opening Balance Equity |
| Transfer between accounts | Destination | Source |

Every entry must balance (debits = credits) and contain only non-negative integers; the model refuses anything else. Journal entries are **immutable**: corrections are reversing entries, voids, returns or adjustments, all audited.

## Profit definitions

* **Net sales** = gross sales − discounts − returns (tax excluded).
* **Gross profit** = net sales − COGS (FIFO cost of the units sold, net of returned units at their original cost).
* **Operating profit** = gross profit − operating expenses − inventory shrinkage/damage.
* **Net profit** = operating profit + other income − other expenses.
* Owner drawings, capital purchases, loans and loan repayments never affect profit.
* Purchases are not expenses: they become inventory and only reach the P&L as COGS when sold.

## Balances that are derived, never stored

Customer debt, supplier debt, cash/bank/mobile balances and inventory value are computed from the journal and the FIFO layers. Cached fields on documents (e.g. `sale.balanceDue`) are reconciled automatically against the ledger. Debt totals cannot be edited directly.

## Reconciliation checks (`GET /finance/reconciliation`, Finance → Financial Dashboard)

1. Every journal entry balanced. 2. Trial balance balanced. 3. Balance sheet balances. 4. Inventory account = Σ FIFO layer cost. 5. Stock balances = Σ movements = Σ layer quantities. 6. No negative stock. 7. AR ledger = open invoice balances. 8. Each customer's ledger balance = their invoice balances. 9. AP ledger = purchase balances. 10. Invoice paid amounts = payment allocations. 11. Purchase paid amounts = supplier payments.

## Tax

Configurable rate (basis points) and whether prices include tax. Tax is computed per line on the server and posted to Tax Payable; default is 0%.

## Time zone and periods

Timestamps are stored in UTC. Report periods (today, this month, …) are resolved in the business time zone (default Africa/Mogadishu, UTC+3).
