# Database schema

MongoDB 7+ **replica set** (transactions are mandatory). All money fields are integer cents; all timestamps are UTC. Collections and indexes are created by `bootstrap()` on start; invalid index definitions fail the test suite.

## Collections

| Collection | Purpose | Key fields / constraints |
| --- | --- | --- |
| `users` | Owner and future staff | `username` unique, `passwordHash` (Argon2id, never returned), `role`, `totpSecret` (hidden) |
| `sessions` | Server-side sessions | token hash, `csrfToken`, `expiresAt` (TTL), `revokedAt` |
| `login_events` | Every login attempt | username, success/reason, IP, user agent |
| `business_settings` | Single document `_id: "business"` | currency USD, timezone Africa/Mogadishu, tax, prefixes, policies |
| `categories`, `brands` | Catalogue taxonomy | case-insensitive unique names |
| `products` | Parts | `sku` unique (upper-case), `barcode` unique when present, OEM/alt numbers indexed, text index, prices in cents, `isActive` (archive) |
| `price_history` | Every price change | old/new value, reason, user |
| `vehicles` | Make/model/generation/years/engine/variant | unique variant |
| `product_compatibilities` | Product ↔ vehicle fitment | unique pair, `source`, `verified` |
| `suppliers`, `customers` | Partners | codes, terms, credit limit (customers) — balances are **derived** from the ledger, never stored |
| `warehouses` | Stock locations | one default `MAIN_SHOP` |
| `inventory_balances` | Cached on-hand / reserved / available per product+warehouse | unique (product, warehouse); reconciled against movements and layers |
| `inventory_movements` | **Immutable** stock ledger | unique (sourceType, sourceId, lineKey, type) — prevents double posting; updates/deletes throw |
| `inventory_cost_layers` | FIFO layers | received qty/cost, remaining qty/cost, `receivedAt` |
| `stock_adjustments`, `stock_counts` | Corrections with reason and approval | status PENDING/APPROVED/REJECTED |
| `purchases` | Purchase orders with landed-cost allocation | items with `landedCost`, `qtyReceived`, status flow |
| `purchase_receipts` | Goods received notes | unique `idempotencyKey` |
| `supplier_payments`, `supplier_returns` | AP settlement and returns | unique `idempotencyKey` |
| `sales` | Invoices (items embedded with FIFO allocations and COGS) | unique `invoiceNo`, unique `idempotencyKey` |
| `customer_payments` | Payments, store credit and refunds with allocations | unique `idempotencyKey` |
| `customer_returns` | Returns referencing the original sale lines | unique `idempotencyKey`, inspection decisions |
| `warranty_claims` | Claims per invoice line | status, resolution, replacement cost |
| `expense_categories`, `expenses`, `recurring_expenses` | Operating / capex / drawings / loan repayments | unique `idempotencyKey`, `attachmentFile` (private) |
| `chart_of_accounts` | Fixed account codes (see FINANCIAL_RULES) | `code` unique |
| `journal_entries` | **Immutable** double-entry journal (lines embedded) | validated balanced on save; only `reversedBy` may be set afterwards |
| `counters` | Atomic document numbering (INV-, PO-, GRN-, JE-…) | updated inside transactions |
| `notifications` | Alerts | partial unique index on `dedupeKey` while unread |
| `audit_logs` | Append-only audit trail | actor, action, entity, before/after, IP, correlation id |
| `backup_logs` | Backup history | file, sha256, per-collection counts, verified flag |
| `migrations` | Applied schema migrations | `_id` = migration id |

## Integrity principles (enforced in code and checked by `/finance/reconciliation`)

1. Every stock change writes an `inventory_movements` row (immutable) in the same transaction.
2. Every posted operation writes a balanced `journal_entries` document (debits = credits, integers only).
3. Credit sales debit Accounts Receivable for the customer; unpaid purchases credit Accounts Payable for the supplier.
4. Payments, receipts, returns and expenses carry unique idempotency keys.
5. Derived balances (customer/supplier balances, cash, inventory value) are always computed from the journal and FIFO layers and reconciled by automated checks.

## Migrations

`server/src/db/migrations.ts` holds forward-only migrations, applied once on start (`npm run migrate` shows status). `0002-notification-isread-flag` replaced an index unsupported on MongoDB 8.0.
