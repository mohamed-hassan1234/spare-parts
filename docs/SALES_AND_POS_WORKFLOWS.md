# Sales and POS workflows

## Making a sale (Sales → Point of Sale)

1. **Find products**: type a name, SKU, barcode, OEM or alternative part number (F2 focuses the search). Scanning a barcode and pressing Enter adds the exact match. Results show price, stock available and shelf.
2. **Cart**: change quantities (limited to available stock). Users with discount permission can change unit prices, add line discounts and a cart discount. Discounts above the configured limit or prices below the product minimum are refused by the server.
3. **Customer**: leave empty for a walk-in (must pay in full) or search a registered customer. Credit is allowed only for customers with a credit limit, and never beyond it.
4. **Payments**: cash, mobile money, bank transfer and store credit; split across methods with *Split*. *Exact amount* fills the balance. For cash, enter the amount tendered to see the change due — only the amount due is recorded.
5. **Complete sale** (F9). The server re-prices the cart, allocates stock FIFO, computes COGS, records payments or the receivable, posts the journal entry and creates the invoice — all at once or not at all. If the network fails and you press again, the same sale is returned instead of a duplicate.
6. Print the **thermal receipt** or the **A4 invoice** (PDF) from the confirmation.

## Credit sales and payments

* An unpaid balance creates a receivable with a due date (customer payment terms).
* Receive payments from the invoice (*Receive payment*) or from Customers → Customer Payments (applied to the oldest invoices first). Overpayment is refused unless you choose to keep it as store credit.
* Customer statements (Customers → Customer Statements) show every invoice, payment and return with a running balance; export or print them.

## Returns

From the invoice → *Return items*: choose quantities (never more than sold minus already returned), condition and reason. The refund uses the original invoice price, revenue and COGS are reversed proportionally, and any excess already paid is refunded by the chosen method (cash, mobile money, bank or store credit). Damaged items never return to sellable stock.

## Invoices

Sales → Invoices lists all invoices with A4 and receipt printing. Invoice PDFs are generated from the stored invoice (items, prices, totals, paid, balance due), so reprints always match the original.

## Warranty

From the invoice line → *Claim* (only within the warranty period sold). Warranty → Warranty Claims: review, approve, reject or resolve (replaced from stock — booked as a loss at FIFO cost —, repaired, refunded via a return, other).
