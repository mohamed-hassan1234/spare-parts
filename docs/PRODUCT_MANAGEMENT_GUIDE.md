# Product management guide

## Creating a product (Products → All Products → New product)

* **SKU** — your unique code (stored upper-case; duplicates are refused).
* **Name**, **manufacturer part number**, **OEM numbers** and **alternative numbers** (comma separated) — all searchable in the product list and POS.
* **Barcode** — unique when set; scanning it at the POS adds the item instantly.
* **Category / brand** — create them first under Products → Categories / Brands (subcategories supported).
* **Selling price** and **minimum selling price** — the POS refuses to sell below the minimum unless a user with discount permission overrides it.
* **Reorder point / reorder quantity** — drive low-stock alerts and reorder suggestions.
* **Shelf location**, **unit**, **weight** (used for weight-based landed-cost allocation), **condition** (new/used/refurbished), **warranty months and terms**.

Cost is never typed on the product: it comes from purchase receipts at landed cost (FIFO). The product page shows on-hand, reserved and available quantities, FIFO value and average cost.

## Images

Product page → *Upload image* (PNG/JPEG/WebP up to 2 MB; the file content is checked, not just the extension).

## Prices

Edit the product to change the price; add a reason. Every change is stored in **Price history**. Products → *Bulk price update* changes all products of a category or brand by a percentage or fixed amount, with a reason. Issued invoices are never changed.

## Archiving

*Archive* hides the product from sale and purchase but keeps all history (movements, invoices, purchases). *Restore* brings it back. Products are never deleted.

## Import and export

* **Export**: Products → Export → CSV, Excel or PDF.
* **Import**: Products → Import → choose a `.csv` or `.xlsx` file (first worksheet). Columns: `sku, name, sellingPrice, minimumSellingPrice, category, brand, manufacturerPartNumber, oemPartNumbers (; separated), alternativePartNumbers, barcode, reorderPoint, reorderQuantity, storageLocation, warrantyMonths, unit, weightGrams, description`, plus optional `openingQty` and `openingUnitCost` to post opening stock. Prices are in dollars (`12.50`). Use **Validate only** first; existing SKUs and unknown categories are reported per row.

## Vehicle compatibility (Products → Vehicle Compatibility)

1. *Register vehicle*: make, model, generation, year range, engine size and code, fuel type, transmission, variant.
2. *Link part* (or, from a product page, *Add vehicle*): choose the product, the **data source** (manufacturer catalogue, OEM cross-reference, supplier data, physically verified, customer report, other), a reference, and whether it is verified.
3. The **Parts finder** searches by make, model, year, engine and part name/number and returns only products with a recorded compatibility link. Unverified links are clearly flagged. The system never infers fitment from product names.
