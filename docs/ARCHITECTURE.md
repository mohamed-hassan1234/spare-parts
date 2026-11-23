# Architecture

## Overview

```
Browser (React SPA) ──HTTPS──▶ Express API (/api/v1) ──transactions──▶ MongoDB replica set
     │  session cookie (HttpOnly, SameSite=Strict)          │
     │  X-CSRF-Token on writes, Idempotency-Key on money    ├─ scheduler: alert checks, scheduled backups
     └─ PDF/CSV/XLSX downloads straight from the API         └─ CLI: init-admin, migrate, backup, restore, seed-dev
```

* **One process, one origin in production.** The API serves the built web app, so no CORS is needed in production.
* **Monorepo (npm workspaces):** `shared` (constants, permissions, account codes, money helpers), `server`, `client`.

## Server

`backend/src/modules/<domain>/` holds each domain as **models** (Mongoose schemas, indexes, immutability hooks), **service** (business rules and transactions — the only place that writes), and **routes** (HTTP + zod validation + permission). Domains: `auth`, `catalog`, `partners` (customers/suppliers), `purchases`, `inventory`, `sales` (POS, payments, returns, warranty), `expenses`, `ledger`, `finance` (expense, cash and ledger routes), `reports`, `admin` (settings, notifications, audit, backups), `ai`, `backup`, `system`.

Cross-cutting pieces:

| Concern | Where |
| --- | --- |
| Route registration, permission check, zod parsing, OpenAPI | `utils/http.ts` (`ModuleRouter`, `routeRegistry`) |
| Transactions | `utils/tx.ts` (`withTx`, snapshot reads, majority writes, automatic retry of transient conflicts) |
| Idempotency | unique `idempotencyKey` indexes + `utils/idempotency.ts` (`onceByKey` replays the original result on a race) |
| Money | integer cents only (`utils/money.ts`, `shared`): `mulDiv`, largest-remainder `allocate`, basis-point percentages |
| Errors | `utils/errors.ts` (`AppError`) + central `errorHandler` (safe messages, no stack traces) |
| Logging | pino / pino-http, secrets redacted |
| Audit | `system/audit.service.ts` — written inside the same transaction as the change |
| Jobs | `jobs/scheduler.ts` — overdue invoices, supplier payments due, low/out/dead stock, scheduled backups |

### The posting pipeline

Every money- or stock-changing operation is one MongoDB transaction that writes the business document, the immutable inventory movements and FIFO layers, the balanced journal entry, and the audit record. If any step fails, nothing is saved.

```
checkout ─▶ price cart (server) ─▶ validate discounts/min price/credit limit ─▶ issueStock (FIFO, atomic $inc with qty guard)
        ─▶ postJournal (AR, revenue, discounts, tax, COGS, inventory) ─▶ Sale ─▶ payments ─▶ audit ─▶ commit
```

Oversell protection: `issueStock` decrements `InventoryBalance.qtyAvailable` with a conditional update (`qtyAvailable >= qty`) inside the transaction; concurrent sales of the last unit therefore produce one success and a clear 409 "Insufficient stock".

## Client

* `src/lib/api.ts` — fetch wrapper (cookies, CSRF header, Idempotency-Key, typed `ApiError`).
* `src/lib/auth.tsx` — session state, permissions (`can()`), business settings.
* `src/lib/hooks.ts` — TanStack Query helpers; mutations invalidate affected data (and the dashboard).
* `src/components/` — UI primitives (`ui/`), data table, pickers, money input, charts, layout/navigation.
* `src/pages/` — one module per area, lazy-loaded per route.

The client never calculates authoritative totals: POS and purchase screens show previews, the server recomputes and the UI displays the server's result.

## Multi-branch readiness

Stock balances, movements and cost layers carry `warehouseId`; Version 1 uses one default warehouse (`MAIN_SHOP`). Roles `MANAGER`, `CASHIER`, `STOREKEEPER`, `ACCOUNTANT` exist with permission sets in `shared/src/index.ts`; staff user management UI is not part of Version 1 (see the final report).
