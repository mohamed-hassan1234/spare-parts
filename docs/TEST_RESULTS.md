# Test results

Run on **2026-11-12** on the development machine: Windows 11 Pro (10.0.26200), Intel Core i7-1355U (12 logical cores), 15.7 GB RAM, Node.js 22.14.0, MongoDB 8.0.11 (single-node replica set). All figures below are copied from actual command output.

## Static validation

| Check | Result |
| --- | --- |
| `tsc --noEmit` server (strict) | ✅ 0 errors |
| `tsc --noEmit` client (strict) | ✅ 0 errors |
| ESLint (server, client, e2e, shared) | ✅ 0 problems |
| Prettier `--check` | ✅ all files formatted |
| Production build (`npm run build`) | ✅ server bundle (tsup) + client (Vite) built |
| Production start smoke test | ✅ `/api/v1/health` ok, SPA served at deep links, CSP/security headers present, protected API 401 |
| `npm audit --omit=dev` | ⚠️ 3 advisories remain (see below) |

Remaining advisories: **zod < 4.6.6** (high — memory exhaustion validating oversized constrained collections; fix requires the zod 4 major upgrade; mitigated by the 1 MB JSON body limit and `max()` limits on every array) and **uuid < 11.1.1 via exceljs** (moderate — only affects calls that pass a `buf` argument, which this application does not; fix would downgrade exceljs to 3.4.0). React Router advisories were resolved by upgrading to 7.18.5.

## Server — Vitest + Supertest (`npm test`)

```
 ✓ src/tests/integration/security.test.ts (12 tests)
 ✓ src/tests/integration/business-flow.test.ts (27 tests)
 ✓ src/tests/integration/scenarios.test.ts (11 tests)
 ✓ src/tests/integration/more-workflows.test.ts (9 tests)
 ✓ src/tests/integration/auth.test.ts (5 tests)
 ✓ src/tests/integration/backup.test.ts (1 test)
 ✓ src/tests/unit/calculations.test.ts (20 tests)
 Test Files  7 passed (7)
      Tests  85 passed (85)
   Duration  96.55s
```

## Client — Vitest + Testing Library (`npm run test:client`)

```
 ✓ src/test/format.test.ts (8 tests)
 ✓ src/test/components.test.tsx (12 tests)
 Test Files  2 passed (2)
      Tests  20 passed (20)
```

## End-to-end — Playwright (`npm run test:e2e`)

Business workflow (desktop, final run after the last change):

```
 ok  1. login as administrator
 ok  2. create a supplier
 ok  3. create a product
 ok  4. register product compatibility
 ok  5–6. create a purchase and receive inventory (Scenario A)
 ok  7. check stock: 100 units, FIFO value $500
 ok  8–10. POS: sell 30 units for cash (Scenario B)
 ok  11–12. generate the invoice and print the receipt (PDF)
 ok  13–16. verify reduced stock, revenue, COGS and gross profit
 ok  17–18. add an operating expense and verify net profit (Scenario C)
 ok  19. register a credit sale of $200 (Scenario D)
 ok  20–21. receive a partial payment of $80 and verify remaining debt $120
 ok  22–23. process a partial return and verify stock and accounting corrections (Scenario G)
 ok  24. export a financial report
 ok  25. logout and verify the session is invalidated
 15 passed (1.2m)
```

Responsive navigation (every one of the 41 navigation pages; no page errors, no 5xx responses, no horizontal overflow):

```
 ok  [desktop] every navigation page renders without errors and without horizontal scroll
 ok  [tablet]  every navigation page renders without errors and without horizontal scroll
 ok  [tablet]  mobile and tablet users can open the navigation menu
 ok  [mobile]  every navigation page renders without errors and without horizontal scroll
 ok  [mobile]  mobile and tablet users can open the navigation menu
 (desktop menu test skipped by design — the sidebar is always visible on desktop)
```

## Performance (`node scripts/perf-test.mjs`, isolated `autoparts_perf` database seeded with demo data)

API and MongoDB on the same laptop over localhost. Times in milliseconds.

| Scenario | Requests | Concurrency | Median | p95 | Max | Errors | Throughput (req/s) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Product search | 400 | 10 | 87.3 | 164.9 | 204.8 | 0% | 101.8 |
| Barcode lookup | 400 | 10 | 92.6 | 166.5 | 177.1 | 0% | 94.5 |
| Dashboard KPIs | 100 | 5 | 239.7 | 376.1 | 502.1 | 0% | 19.6 |
| Dashboard charts | 60 | 5 | 249.2 | 360.9 | 365.4 | 0% | 19.0 |
| Sales report | 60 | 5 | 99.5 | 172.6 | 173.1 | 0% | 45.7 |
| Profit & loss | 100 | 5 | 45.3 | 84.6 | 87.1 | 0% | 98.2 |
| Reconciliation checks | 20 | 2 | 78.0 | 102.8 | 102.8 | 0% | 24.9 |
| POS checkout, 1 cashier | 50 | 1 | 71.1 | 136.5 | 189.1 | 0% | 12.4 |
| POS checkout, 3 tills in parallel | 60 | 3 | 310.0 | 768.4 | 1096.1 | 0% | 7.8 |
| POS checkout, 10 concurrent on one product (stress) | 200 | 10 | 1244.7 | 6643.4 | 10535.6 | 0% | 4.8 |

After the load: reconciliation **OK (0 failed checks)**, test product stock **4,690 = expected 4,690** (no lost or duplicated sales). Raw data: `docs/perf-results.json`.

Interpretation: a single till completes a sale in ~0.07 s (p95 0.14 s). Under heavy contention every checkout still succeeds exactly once, but MongoDB serialises the transactions on shared counters and the same stock row, so latency rises sharply (p95 6.6 s at 10 simultaneous checkouts of one product). This is far beyond a one-shop workload but should be revisited before multi-branch use (see the final report).

## Defects found during verification and fixed (each with a regression test)

| # | Defect | Fix | Regression test |
| --- | --- | --- | --- |
| 1 | Voiding an expense / reversing any journal entry always failed (immutability hook rejected Mongoose's automatic `$setOnInsert`) | Hook ignores the inert `$setOnInsert`, refuses upserts | business-flow "records and voids expenses", more-workflows "reverses a transfer" |
| 2 | Returned items awaiting inspection could never be inspected ("already inspected") | Check the decision field, not the always-present sub-object | business-flow damaged returns, scenario G |
| 3 | Every backup was reported as *not verified* (EJSON Int32 version compared with `!==`) | Numeric comparison | backup.test |
| 4 | Notification de-duplication index was invalid on MongoDB 8.0 and silently skipped | `isRead` flag + migration 0002; index-sync failures now fail the test suite | security "de-duplicates unread alerts" |
| 5 | Concurrent duplicate submissions of returns/payments/receipts/expenses answered 409 instead of the original result | `onceByKey` replay on duplicate idempotency key; replays return 200 | scenario F, scenario G |
| 6 | Expense attachment download returned 500 when the upload folder path contained a dot-directory | `sendFile` with explicit safe path options | security "secure file uploads" |
| 7 | Production build crashed at start (shared TypeScript package not bundled) | tsup `noExternal` | production smoke test |
| 8 | Creating a product from the UI failed (server rejected `brandId: null`); brand/category could not be cleared | nullable references | E2E step 3 |
| 9 | Development DB launcher wrote data into a URL-encoded folder (`spare%20parts`) | `fileURLToPath` | manual |
| 10 | `init-admin` hung in non-interactive use; demo seed failed (short idempotency key) | CLI/seed fixes | E2E global setup, manual |
| 11 | Inline theme script blocked by the production CSP | external `theme-init.js` | manual (production smoke) |
| 12 | Accessibility: form labels not associated with inputs; required marker read as part of the label; KPI cards unlabeled | automatic `Field` ids, CSS marker with empty alt text, labelled groups | component tests, E2E |
| 13 | React Router open-redirect advisories | upgraded to 7.18.5 | full E2E re-run |
