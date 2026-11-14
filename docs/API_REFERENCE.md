# API reference

* Base path: `/api/v1`. Interactive OpenAPI docs: **`/api/docs`** (spec at `/api/v1/openapi.json`, generated from the same zod schemas the server validates with).
* Responses: `{ "data": ... }` on success; `{ "error": { "code", "message", "details?" } }` on failure.
* Status codes: 200/201 success (an idempotent replay returns 200 with `replayed: true`), 400 validation, 401 not signed in, 403 permission/CSRF, 404 not found, 409 conflict (duplicate, insufficient stock), 422 business rule violated, 429 rate limited, 500 unexpected (nothing saved).
* Auth: session cookie from `POST /auth/login`. Every non-GET request must send `X-CSRF-Token` (from login or `GET /auth/me`).
* Money: integer cents. Quantities: positive integers. Dates: ISO 8601.
* Idempotency: send `Idempotency-Key` (8–100 chars) on checkout (required), goods receipts, payments, returns and expenses. Repeating a key returns the original result.
* Lists accept `page`, `limit` (≤500), `sort` (`field` or `-field`), `search` and return `{ items, total, page, limit, pages }`.
* Reports accept `period` = `today|yesterday|last7|last30|thisMonth|prevMonth|thisYear|all|custom` (+`from`,`to`) and `format=json|csv|xlsx|pdf`.

## Endpoints (138 routes; permission in brackets)

**Auth** — `POST /auth/login` [public] · `POST /auth/logout` · `GET /auth/me` · `POST /auth/change-password` · `GET /auth/sessions` · `DELETE /auth/sessions/:id` · `GET /auth/login-activity` [audit:read] · `POST /auth/2fa/setup|confirm|disable`

**Catalogue** — `GET|POST /categories`, `PATCH /categories/:id` · `GET|POST /brands`, `PATCH /brands/:id` · `GET /products` (search name/SKU/barcode/OEM/alt; filters category, brand, stock, status) · `GET /products/lookup?code=` (exact barcode/SKU/part no.) · `GET /products/export` · `POST /products/import` (CSV or .xlsx, `dryRun`) · `POST /products` · `POST /products/bulk-price` · `GET|PATCH /products/:id` · `POST /products/:id/archive|restore` · `GET /products/:id/history` · `POST /products/:id/image` · `GET|POST /vehicles`, `PATCH /vehicles/:id`, `GET /vehicles/makes`, `GET /vehicles/parts` · `POST /compatibility`, `PATCH|DELETE /compatibility/:id`

**Partners** — `GET|POST /suppliers`, `GET|PATCH /suppliers/:id`, `GET /suppliers/:id/statement` · `GET|POST /customers`, `GET|PATCH /customers/:id`, `GET /customers/:id/statement`

**Purchases** — `GET|POST /purchases` · `GET|PATCH /purchases/:id` (draft only) · `POST /purchases/:id/order|cancel|receive|post|payments` · `GET /purchase-receipts` · `GET|POST /supplier-payments` · `GET|POST /supplier-returns`, `POST /supplier-returns/:id/replacement`

**Inventory** — `GET /inventory` · `GET /inventory/warehouses|movements|valuation|low-stock` · `GET|POST /inventory/adjustments`, `POST /inventory/adjustments/:id/approve|reject` · `GET|POST /inventory/stock-counts` · `POST /inventory/reservations`, `/inventory/reservations/release`

**Sales** — `GET /sales` · `POST /sales` (checkout, Idempotency-Key required) · `GET /sales/:id` · `GET /sales/:id/invoice?format=a4|thermal` (PDF) · `POST /sales/:id/payments` · `POST /sales/:id/returns` · `GET|POST /customer-payments` · `GET /returns`, `POST /returns/:id/inspect` · `GET|POST /warranty-claims`, `PATCH /warranty-claims/:id`

**Finance** — `GET|POST /expense-categories`, `PATCH /expense-categories/:id` · `GET|POST /expenses`, `GET|PATCH /expenses/:id`, `POST /expenses/:id/void`, `POST|GET /expenses/:id/attachment` · `GET|POST /recurring-expenses`, `PATCH /recurring-expenses/:id`, `POST /recurring-expenses/:id/record` · `GET /finance/accounts|journal|trial-balance|balance-sheet|cash|reconciliation` · `GET /finance/ledger/:account` · `GET /finance/cash-statement/:account` · `POST /finance/journal/:id/reverse` · `POST /finance/transactions` (capital, loans, transfers, opening cash, other income/expense)

**Reports & dashboard** — `GET /reports/profit-loss|sales|purchases|inventory|expenses|cash-flow|receivables|payables|general-ledger|trial-balance` · `GET /dashboard/overview|charts|sales-chart|profit-chart|activity`

**Administration** — `GET /settings`, `GET /settings/public`, `PATCH /settings`, `POST /settings/logo` · `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` · `GET /audit-logs` · `GET|POST /backups`, `POST /backups/:id/verify`, `GET /backups/:id/download` · `GET /ai/status`, `POST /ai/monthly-report` · `GET /health` [public]

## Example: checkout

```http
POST /api/v1/sales
X-CSRF-Token: …
Idempotency-Key: sale-6f1c…
Content-Type: application/json

{ "customerId": "…optional…", "items": [{ "productId": "…", "qty": 2 }], "cartDiscount": 0,
  "payments": [{ "method": "CASH", "amount": 1600 }] }
```

Response `201 { data: { sale, replayed: false } }`; repeating the same key returns `200 { data: { sale, replayed: true } }`. Insufficient stock → `409`; credit limit, minimum price or overpayment rules → `422`.
