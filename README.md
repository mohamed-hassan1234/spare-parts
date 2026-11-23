# AutoParts ERP

Web-based ERP and Point of Sale for an automotive spare parts shop. It runs the daily work of the shop in one system: products, stock, purchasing, sales, debts, expenses, accounting, and reports.

## Contents

[Features](#features) · [Technology](#technology-stack) · [Requirements](#system-requirements) · [Folder structure](#folder-structure) · [Quick start](#quick-start) · [Environment](#environment-configuration) · [Database](#database-setup) · [Running](#running-the-application) · [Commands](#available-commands) · [Troubleshooting](#troubleshooting) · [Security](#security-guidelines) · [Contributing](#github-contribution-instructions) · [Deployment](#deployment-notes)

## Features

- **Catalogue:** products, categories, brands, vehicles, and part-to-vehicle compatibility, with CSV/Excel import and export
- **Inventory:** FIFO costing, stock movements, adjustments, low-stock and dead-stock alerts
- **Purchasing:** purchase orders, goods receiving, landed costs, supplier payments
- **Point of Sale:** cash and credit sales, discounts with approval limits, receipts
- **Customers and suppliers:** balances, debts, and payments
- **Returns and warranty:** return inspection and stock handling
- **Expenses:** operating expenses, capital spending, owner drawings, loan repayments
- **Accounting:** double-entry ledger, chart of accounts, financial statements
- **Reports:** business and financial reports, with optional AI-written monthly summaries
- **Administration:** role-based access (5 roles, 31 permissions), audit logs, business settings
- **Backups:** encrypted, scheduled or manual, with verification and restore

There is no public registration. The owner account is created from the server console.

## Technology Stack

| Area | Technology |
| --- | --- |
| Frontend | React 18, Vite 6, TypeScript 5, Tailwind CSS 4, Radix UI, TanStack Query, React Hook Form, Zod, Recharts |
| Backend | Node.js, Express 5, TypeScript 5, Mongoose 8, Zod, Pino, Argon2 |
| Database | MongoDB 7 or 8, **as a replica set** (financial records use transactions) |
| Testing | Vitest, Testing Library, Supertest, mongodb-memory-server, Playwright |
| Structure | npm workspaces: `frontend`, `backend`, `shared` |

Money is always stored as integer cents.

## System Requirements

- [Git](https://git-scm.com/)
- [Node.js](https://nodejs.org/) **22.9 or newer** (tested on 22.14) and npm 10
- [MongoDB](https://www.mongodb.com/try/download/community) 7 or 8. If `mongod` isn't installed, run `npm test` once and `npm run dev:db` will use the MongoDB binary that the tests download.

## Folder Structure

```
spare-parts/
├── frontend/            React web app
│   ├── public/          Static files (favicon, theme script)
│   ├── src/             Pages, components, and client libraries
│   ├── e2e/             Playwright browser tests
│   └── .env.example
├── backend/             Express API
│   ├── src/
│   │   ├── modules/     One folder per business domain (models, service, routes)
│   │   ├── db/          Connection, migrations, seed
│   │   ├── jobs/        Scheduled alerts and backups
│   │   ├── tests/       Unit and integration tests
│   │   └── cli.ts       Operator commands
│   └── .env.example
├── shared/              Constants, permissions, and money helpers used by both sides
├── scripts/             Setup, bootstrap, dev, start, and local MongoDB scripts
├── docs/                Detailed guides and verification reports
└── package.json         Root commands
```

## Quick Start

**1. Download the project**

```bash
git clone https://github.com/mohamed-hassan1234/spare-parts.git
```

```bash
cd spare-parts
```

**2. Install dependencies**

```bash
npm install
```

**3. Prepare the configuration**

```bash
npm run setup
```

This checks your Node.js version, creates `backend/.env` with newly generated secrets, creates `frontend/.env`, and tests the database connection. It never overwrites an existing `.env` file.

**4. Start MongoDB** in a second terminal and leave it running:

```bash
npm run dev:db
```

**5. Initialize and verify the database**

```bash
npm run seed
```

```bash
npm run seed:verify
```

**6. Create the owner account.** You choose the username and password, and the password is hidden as you type:

```bash
npm run init-admin
```

**7. Start the app.** Stop the `dev:db` terminal first if you like, because this command starts MongoDB when it isn't running:

```bash
npm run dev
```

Open <http://localhost:5173> and sign in.

### One-command alternative

With MongoDB running, this replaces steps 3 and 5:

```bash
npm run bootstrap
```

It runs these steps in order and stops with an explanation if one fails:

1. Checks Node.js and installs missing dependencies
2. Creates missing `.env` files
3. Validates the configuration
4. Checks the database, and refuses to continue on a production environment
5. Applies migrations and required data
6. Verifies the result

It doesn't create the owner account, so run `npm run init-admin` afterwards on a new database.

## Environment Configuration

`npm run setup` creates these files for you. To create them by hand:

Windows PowerShell:

```bash
Copy-Item backend/.env.example backend/.env
```

```bash
Copy-Item frontend/.env.example frontend/.env
```

macOS or Linux:

```bash
cp backend/.env.example backend/.env
```

```bash
cp frontend/.env.example frontend/.env
```

To generate a value for `APP_SECRET` or `BACKUP_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The backend reads the root `.env` (if you have one from an older install), then `backend/.env`, which takes priority. Real environment variables override both. A message such as `.env not found. Continuing without it` is harmless when one of the two files doesn't exist.

### Backend variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production` |
| `PORT` | No | `4000` | API port |
| `MONGODB_URI` | Yes | Local replica set on 27018 | Database connection, must be a replica set |
| `CORS_ORIGINS` | No | `http://localhost:5173` | Allowed browser origins, comma separated |
| `APP_SECRET` | **Yes in production** | Development-only value | Signs security tokens |
| `SESSION_TTL_HOURS` | No | `12` | Maximum session length |
| `SESSION_IDLE_MINUTES` | No | `30` | Idle sign-out |
| `COOKIE_SECURE` | **Yes in production** | `false` | Set `true` behind HTTPS |
| `LOGIN_MAX_ATTEMPTS` | No | `5` | Failed logins before lockout |
| `LOGIN_LOCK_MINUTES` | No | `15` | Lockout length |
| `RATE_LIMIT_PER_MINUTE` | No | `600` | API rate limit per IP |
| `UPLOAD_DIR` | No | `./uploads` | Uploaded images, relative to `backend/` |
| `BACKUP_DIR` | No | `./backups` | Backups, relative to `backend/` |
| `BACKUP_ENCRYPTION_KEY` | For backups | None | 64 hex characters. **Keep a copy offline** |
| `BACKUP_RETENTION_COUNT` | No | `14` | Backups to keep |
| `BACKUP_SCHEDULE_HOURS` | No | `24` | Backup interval, `0` disables |
| `JOBS_ENABLED` | No | `true` | Alert checks and scheduled backups |
| `LOG_LEVEL` | No | `info` | Log detail |
| `ANTHROPIC_API_KEY` | No | None | Enables optional AI report summaries |
| `AI_MODEL` | No | `claude-opus-5-5` | Model for AI summaries |
| `INIT_ADMIN_USERNAME`, `INIT_ADMIN_FULLNAME`, `INIT_ADMIN_PASSWORD`, `INIT_ADMIN_EMAIL` | No | None | Non-interactive `init-admin` only |

### Frontend variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_PROXY` | `http://localhost:4000` | Where the dev server forwards `/api` and `/uploads` |

Every `VITE_` value is visible in browser code, so never put a secret in `frontend/.env`.

## Database Setup

The app needs a MongoDB **replica set** because sales, purchases, and ledger entries are saved in transactions.

- **Local:** `npm run dev:db` starts a single-node replica set on `127.0.0.1:27018`, with data in `.data/mongo`.
- **Cloud:** MongoDB Atlas clusters are replica sets. Put the connection string in `MONGODB_URI`.

### Seeding

```bash
npm run seed
```

The seed adds only the records the system needs:

| Collection | Records |
| --- | --- |
| `chart_of_accounts` | 24 system accounts |
| `warehouses` | Default "Main Shop" |
| `expense_categories` | 14 default categories |
| `business_settings` | Default business settings |

It also creates collections and indexes and applies pending migrations. It reports inserted, skipped, and failed records for each collection.

The seed is safe to repeat. It only inserts what's missing, never changes or deletes existing records, and creates no users or business data. With `NODE_ENV=production` it refuses to run unless you take a backup and set `SEED_ALLOW_PRODUCTION=true` for that command.

Roles and permissions are defined in code (`shared/src/index.ts`), so they aren't stored as records. Verification checks that they're valid.

### Verification

```bash
npm run seed:verify
```

This read-only check confirms required records, duplicates, the default warehouse, role permissions, migrations, and user roles. It exits with an error if any check fails.

### Optional demo data

```bash
npm run seed:dev
```

This adds fictional products and transactions for **development only**. It needs an owner account and refuses to run on a database that already has sales.

## Running the Application

### Development

```bash
npm run dev
```

| Service | URL |
| --- | --- |
| Web app | <http://localhost:5173> |
| API | <http://localhost:4000/api> |
| API documentation | <http://localhost:4000/api/docs> |

This starts MongoDB if it's local and not running, then the API and web app with hot reload. Press Ctrl+C to stop them.

### Production build

```bash
npm run build
```

The API bundle goes to `backend/dist` and the web app to `frontend/dist`.

### Production start

```bash
npm start
```

This runs with `NODE_ENV=production`. The API also serves the web app, so everything is on one port: <http://localhost:4000>. It requires a real `APP_SECRET`.

## Available Commands

Run all commands from the project root.

| Command | What it does |
| --- | --- |
| `npm install` | Install all workspace dependencies |
| `npm run setup` | Check prerequisites, create missing `.env` files, test the database |
| `npm run bootstrap` | Setup, seed, and verify in one safe step |
| `npm run dev` | Start database (if needed), API, and web app |
| `npm run dev:db` | Start only the local MongoDB replica set |
| `npm run dev:backend` | Start only the API |
| `npm run dev:frontend` | Start only the web app |
| `npm run seed` | Insert missing required data |
| `npm run seed:verify` | Check required data (read-only) |
| `npm run seed:dev` | Add fictional demo data (development only) |
| `npm run migrate` | Apply and list migrations |
| `npm run init-admin` | Create the single Super Admin |
| `npm run reset-password` | Reset a user's password and sign them out |
| `npm run build` | Build backend and frontend |
| `npm start` | Run the production build |
| `npm run typecheck` | TypeScript checks |
| `npm run lint` | ESLint |
| `npm run format:check` / `format` | Check or apply Prettier formatting |
| `npm test` | Backend unit and integration tests |
| `npm run test:frontend` | Frontend component tests |
| `npm run test:e2e` | Browser tests on an isolated database (needs `npm run dev:db`) |
| `npm run test:all` | Typecheck, lint, all unit tests, and build |
| `npm run backup -w backend` | Create an encrypted backup |
| `npm run restore -w backend -- <file> --target <db>` | Restore a backup to a separate database |

## Troubleshooting

| Problem | Solution |
| --- | --- |
| **Missing dependencies** (`Cannot find module`) | Run `npm install` from the project root. |
| **Missing environment variables** | Run `npm run setup` and fix anything marked `[fail]`. |
| **`connect ECONNREFUSED 127.0.0.1:27018`** | MongoDB isn't running. Run `npm run dev:db`. |
| **"MongoDB must run as a replica set"** | Use `npm run dev:db`, or start `mongod` with `--replSet` and add `?replicaSet=rs0` to `MONGODB_URI`. |
| **Seed errors** | Run `npm run seed:verify` to see the failing check, fix it, and run the seed again. It's safe to repeat. |
| **Duplicate key errors** | A record conflicts with a unique index. Find it using the verify output. Don't drop the collection. |
| **CORS errors** | Add the browser's exact origin to `CORS_ORIGINS`, then restart the API. |
| **Web app can't reach the API** (500 on `/api`) | Check the API is running on port 4000 and `VITE_API_PROXY` matches. The API can take several seconds to start. |
| **Port already in use** | Find it with `netstat -ano \| findstr :4000` (Windows) or `lsof -i :4000` (macOS/Linux), then stop that process or change `PORT`. |
| **Build problems** | Run `npm run typecheck` to see the error. Delete `node_modules` and run `npm install` if packages are broken. |
| **Can't sign in** | On a new database, run `npm run init-admin`. For a forgotten password, run `npm run reset-password`. |
| **Locked out after failed logins** | Wait `LOGIN_LOCK_MINUTES` or reset the password from the console. |

## Security Guidelines

- **Never commit `.env` files.** They're ignored by Git; only `.env.example` templates are tracked.
- **Passwords** are hashed with Argon2 and can't be read back, only reset.
- **The owner account** is created from the console. No administrator password is hardcoded, and existing passwords are never reset automatically.
- **Secrets stay on the backend.** Never put one in a `VITE_` variable.
- **In production:** use a unique `APP_SECRET`, set `COOKIE_SECURE=true`, serve over HTTPS, and restrict database access.
- **Backups** are encrypted. Without `BACKUP_ENCRYPTION_KEY` they can't be restored, so store a copy offline.

More detail: [docs/SECURITY.md](docs/SECURITY.md).

## GitHub Contribution Instructions

```bash
git checkout -b feature/short-description
```

```bash
npm run test:all
```

```bash
git status
```

Check that no `.env` file or secret is listed, then stage specific files:

```bash
git add path/to/changed-file
```

```bash
git commit -m "Describe the change"
```

```bash
git push -u origin feature/short-description
```

Then open a pull request on GitHub.

## Deployment Notes

The supported deployment is a single Node.js process that serves the API and the built web app, connected to a MongoDB replica set, behind an HTTPS reverse proxy. The repository has no Docker or CI configuration. Follow [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md).

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Database schema](docs/DATABASE_SCHEMA.md) · [API reference](docs/API_REFERENCE.md) · [Installation](docs/INSTALLATION_GUIDE.md) · [Admin guide](docs/ADMIN_GUIDE.md) · [Products](docs/PRODUCT_MANAGEMENT_GUIDE.md) · [Inventory](docs/INVENTORY_WORKFLOWS.md) · [Sales and POS](docs/SALES_AND_POS_WORKFLOWS.md) · [Financial rules](docs/FINANCIAL_RULES.md) · [Security](docs/SECURITY.md) · [Backup and restore](docs/BACKUP_AND_RESTORE.md) · [Deployment](docs/DEPLOYMENT_GUIDE.md) · [Test plan](docs/TEST_PLAN.md) · [Test results](docs/TEST_RESULTS.md)
