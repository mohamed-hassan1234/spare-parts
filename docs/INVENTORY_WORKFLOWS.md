# Inventory workflows

## Principles

* Stock only changes through an **immutable movement** (`inventory_movements`) written in the same transaction as its source document (receipt, sale, return, adjustment, supplier return, warranty replacement).
* Cost uses **FIFO layers**: each receipt creates a layer at landed unit cost; sales consume the oldest layers first and record the exact allocation on the invoice line.
* **Available = on hand − reserved.** A normal sale can never make available stock negative (atomic conditional update; concurrent sales of the last unit → one succeeds, the other gets "Insufficient stock").
* Inventory value = Σ remaining FIFO layer cost, and must equal the Inventory ledger account (checked automatically).

## Purchasing and receiving

1. Purchases → New Purchase: supplier, supplier invoice number, date, items (qty, unit price, discount) and landed costs (freight, customs, other) with the allocation method (value, quantity or weight).
2. *Save draft* (editable) or *Place order*.
3. *Receive goods*: enter quantities received now (partial receipts allowed). Each receipt creates FIFO layers at landed cost, movements, and **Dr Inventory / Cr Accounts Payable**. Retrying the same receipt (double click, network retry) is ignored.
4. When fully received, *Post & close*. Pay the supplier from the purchase or from Supplier Payments.
5. Drafts and orders without receipts can be cancelled with a reason.

## Adjustments and counts

* **Stock Adjustments**: increase or decrease with a reason (count correction, damage, theft/loss, expired, found, opening balance, data correction, other) and notes. Increases require a unit cost (creates a FIFO layer). Decreases are costed FIFO and booked to *Inventory Shrinkage & Damage*. Adjustments can be posted immediately or left **pending** for approval; pending ones change nothing until approved. Rejection needs a reason.
* **Stock Counts**: enter physical quantities (one product or all). The system captures the system quantity at submission and creates count-correction adjustments for the differences.

## Returns and damaged goods

* Customer returns marked **Good** go back to stock at their original cost; **Damaged** are written off; **Needs inspection** go to *Returned goods awaiting inspection* (not sellable) until someone chooses *Restock* or *Write off* on the Customer Returns page.
* **Supplier returns** remove stock at FIFO cost and either reduce what you owe (credit) or wait for replacement goods (*Receive replacement*).

## Monitoring

* **Low Stock**: products at or below their reorder point with a suggested order quantity.
* **Reports → Inventory Reports**: valuation, aging (0–30/31–90/91–180/180+ days by layer), turnover, fast/slow movers and dead stock (no sale for the configured number of days).
* **Stock Movements**: full history filterable by product, type, reference and date.
