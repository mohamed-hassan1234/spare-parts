# Installation guide (Windows)

## 1. Prerequisites

| Software | Version | Notes |
| --- | --- | --- |
| Node.js | 22.9 or newer (tested with 22.14) | https://nodejs.org — includes npm |
| MongoDB Community Server | 7.0 or 8.x | Must run as a **replica set**. The dev script starts one for you. |
| Git (optional) | any | |

If MongoDB is installed in the default location (`C:\Program Files\MongoDB\Server\<version>\bin`), `npm run dev:db` finds it even when it is not on `PATH`. You can also set `MONGOD_PATH` to the full path of `mongod.exe`.

## 2. Install dependencies

Open PowerShell in the project folder:

```bash
npm install
```

## 3. Configure

```bash
npm run setup
```

Generate two secrets and paste them into `.env` as `APP_SECRET` and `BACKUP_ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Keep a copy of `BACKUP_ENCRYPTION_KEY` somewhere safe and offline — backups cannot be restored without it.

## 4. Start the database (development)

```bash
npm run dev:db
```

This starts `mongod` on `127.0.0.1:27018` as replica set `rs0`, with data in `.data\mongo`. Leave this window open. The default `MONGODB_URI` in `.env.example` already points at it.

## 5. Create the owner account

```bash
npm run init-admin
```

You are asked for a username, full name, optional recovery email and a password (at least 10 characters with upper case, lower case and a number). Only one Super Admin can be created this way; there is no registration page.

## 6. Run the application

Two more terminals:

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

Open http://localhost:5173 and sign in.

Optional, for trying the system on a **development** database only: `npm run seed:dev` inserts clearly fictional demo suppliers, products, purchases, sales and expenses through the real business services. It refuses to run in production or on a database that already has sales.

## 7. Verify the installation

```bash
npm run typecheck
```

```bash
npm test
```

The test suite starts its own temporary in-memory MongoDB replica set; it never touches your data.

## Troubleshooting

* **"MongoDB must run as a replica set"** — use `npm run dev:db`, or add `?replicaSet=rs0` to `MONGODB_URI` for your own replica set.
* **Port 5173/4000 already in use** — stop the other program or change `PORT` in `.env` (and the Vite proxy via `VITE_API_PROXY`).
* **Locked out after failed logins** — wait `LOGIN_LOCK_MINUTES`, or reset from the console: `npm run reset-password -w backend -- <username>`.
