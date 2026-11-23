# Test plan

All automated tests run against **isolated** databases: the server suite starts a temporary in-memory MongoDB replica set (one database per test file); Playwright uses `autoparts_e2e` and the load test uses `autoparts_perf` (both dropped and re-created by the harness, which refuses names not ending in `_e2e` / `_perf`). No test touches development or production data.

| Level | Tooling | Location | Command |
| --- | --- | --- | --- |
| 1 Static | TypeScript (strict), ESLint 9 + typescript-eslint + react-hooks, Prettier, `npm audit`, production build | root | `npm run typecheck` · `npm run lint` · `npm run format:check` · `npm run build` |
| 2 Unit | Vitest | `backend/src/tests/unit`, `frontend/src/test/format.test.ts` | `npm test` · `npm run test:frontend` |
| 3 Database integration | Vitest + mongodb-memory-server replica set | `backend/src/tests/integration/*` | `npm test` |
| 4 REST API | Supertest (same files) | `backend/src/tests/integration/*` | `npm test` |
| 5 Frontend components | Vitest + Testing Library + jsdom | `frontend/src/test/components.test.tsx` | `npm run test:frontend` |
| 6 End-to-end | Playwright (Chromium) — desktop, tablet 820×1180, mobile Pixel 7 | `frontend/e2e/*` | `npm run test:e2e` (needs `npm run dev:db`) |
| 7 Financial reconciliation | `/finance/reconciliation` asserted after workflows | business-flow, scenarios, more-workflows, E2E step 23, load test | — |
| 8 Concurrency | parallel requests with Supertest | scenarios (F, G), business-flow | `npm test` |
| 9 Security | route matrix, CSRF, injection, uploads, TOTP, session invalidation | `security.test.ts`, `auth.test.ts`, E2E step 25 | `npm test` |
| 10 Performance | `scripts/perf-test.mjs` (median/p95/error rate, environment recorded) | `docs/perf-results.json` | `node scripts/perf-test.mjs` |
| 11 Backup & recovery | encrypted backup → restore into a separate DB → compare | `backup.test.ts` | `npm test` |
| 12 Regression | everything above, re-run after the last change | — | `npm run test:all` then `npm run test:e2e` |

## Coverage by requirement

* **Unit (level 2):** integer money maths (`mulDiv`, `allocate`, basis points), discounts, exclusive and inclusive tax with exact journal identity, payment allocation oldest-first, proportional partial returns, payment status, landed-cost allocation by value/quantity/weight/manual, time-zone period resolution (Africa/Mogadishu), TOTP RFC 6238 vector, CSV quoting and formula neutralisation; client money parsing/formatting and cart totals.
* **Business scenarios A–H** (`scenarios.test.ts`): exact figures from the specification, including concurrent last-item checkout, duplicate checkout and payment submissions, simultaneous adjustments, a partial return submitted twice concurrently, and a simulated database failure in the middle of checkout followed by an idempotent retry.
* **Workflows** (`business-flow.test.ts`, `more-workflows.test.ts`): catalogue (duplicates, invalid prices, price history, compatibility), purchases with landed costs and partial/idempotent receipts, supplier payments and overpayment refusal, FIFO checkout, credit limit, minimum price, credit sales and store credit, returns with inspection, adjustments and approval, stock counts, supplier returns (credit/replacement), warranty claims with replacement, capital/transfers/reversals, recurring expenses, bulk price updates, settings validation and audit, alert jobs, AI report (rule-based) consistency with the P&L, CSV/XLSX/PDF exports, immutability of journal entries and stock movements, audit coverage.
* **Security:** 401 on every protected route without a session; 403 for a Cashier on every route needing a permission the role lacks; CSRF on all writes; account lockout; HttpOnly/SameSite cookies; password change revoking sessions; TOTP enrolment and enforcement; NoSQL-operator injection; regex injection; malformed JSON; safe error bodies; no password hash/TOTP secret exposure; content-sniffed uploads; private expense attachments; logout invalidates the server session (E2E).
* **E2E:** the 25-step owner workflow through the UI with ledger-verified figures; every navigation item rendering without errors, failed API calls or horizontal scrolling on three viewport sizes; mobile navigation drawer.

## Not automated (manual or pending)

Visual layout of printed PDFs, dark-mode appearance, keyboard shortcuts (F2/F9) in the browser, logo/product image upload through the UI, scheduled-backup timing, real HTTPS deployment. See FINAL_VERIFICATION_REPORT.md.
