# AutoParts ERP

Web-based ERP and Point of Sale for an automotive spare parts shop: catalogue and vehicle compatibility, purchasing with landed costs, FIFO inventory, POS with credit sales, customer and supplier debts, expenses, a double-entry ledger, financial statements, returns and warranty, audit logs, encrypted backups and optional AI insights.

**Stack:** MongoDB (replica set) · Express 5 + TypeScript · React 18 + Vite + TypeScript · Tailwind CSS 4 · shadcn/ui-style Radix components · TanStack Query · React Hook Form + Zod · Recharts. Money is always integer cents.

## Quick start (Windows, development)

Prerequisites: Node.js 20.11+ (tested on 22.14) and MongoDB 7/8 (`mongod`) — or nothing extra: the dev script falls back to the MongoDB binary cached by the test suite.

```bash
npm install
```

```bash
copy .env.example .env
```

Edit `.env`: set `APP_SECRET` and `BACKUP_ENCRYPTION_KEY` (see comments in the file). Then, in three terminals:

```bash
npm run dev:db
```

```bash
npm run init-admin
```

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open http://localhost:5173 and sign in with the Super Admin you just created. Optional fictional demo data for a **development** database: `npm run seed:dev`.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev:db` | Local single-node MongoDB replica set on port 27018 (data in `.data/`) |
| `npm run dev:server` / `dev:client` | API on :4000 (watch mode) / web on :5173 (proxies `/api`) |
| `npm run init-admin` | Create the one Super Admin (CLI only — there is no public registration) |
| `npm run typecheck` · `npm run lint` · `npm run format:check` | Static checks |
| `npm test` | Server unit + integration tests (in-memory MongoDB replica set) |
| `npm run test:client` | Client unit/component tests (Vitest + Testing Library) |
| `npm run test:e2e` | Playwright browser tests on an isolated stack (needs `npm run dev:db`) |
| `node scripts/perf-test.mjs` | Load test on an isolated database; writes `docs/perf-results.json` |
| `npm run build` | Production build (server bundle + static web app) |
| `npm run backup -w server` / `restore -w server` | Encrypted backup / restore from the console |

## Documentation

Everything is in [`docs/`](docs): [Architecture](docs/ARCHITECTURE.md) · [Database schema](docs/DATABASE_SCHEMA.md) · [API reference](docs/API_REFERENCE.md) · [Installation](docs/INSTALLATION_GUIDE.md) · [Admin guide](docs/ADMIN_GUIDE.md) · [Products](docs/PRODUCT_MANAGEMENT_GUIDE.md) · [Inventory](docs/INVENTORY_WORKFLOWS.md) · [Sales & POS](docs/SALES_AND_POS_WORKFLOWS.md) · [Financial rules](docs/FINANCIAL_RULES.md) · [Security](docs/SECURITY.md) · [Backup & restore](docs/BACKUP_AND_RESTORE.md) · [Deployment](docs/DEPLOYMENT_GUIDE.md) · [Test plan](docs/TEST_PLAN.md) · [Test results](docs/TEST_RESULTS.md) · [Final verification report](docs/FINAL_VERIFICATION_REPORT.md).

The interactive OpenAPI documentation is served by the API at `/api/docs`.

## Repository layout

```
shared/   constants, permissions, chart-of-account codes, money helpers (used by both sides)
server/   Express API: src/modules/<domain>/{models,service,routes}, utils, jobs, cli, tests
client/   React app: src/pages, src/components, src/lib; e2e/ Playwright specs
scripts/  dev MongoDB launcher, performance test
docs/     documentation and verification reports
```
