# Deployment guide

> Production deployment requires explicit approval from the owner. Nothing in this repository deploys automatically.

## Recommended topology (single shop)

```
Internet ──443──▶ Reverse proxy (Caddy / IIS / nginx, TLS) ──▶ Node.js API :4000 (serves web app) ──▶ MongoDB replica set (localhost only)
```

## Steps

1. **Server:** Windows Server or Linux with Node.js 20.11+ and MongoDB 7/8 configured as a replica set (even a single node: `replication.replSetName: rs0`, then `rs.initiate()`). Enable MongoDB authentication and bind it to localhost.
2. **Build:**

```bash
npm ci
```

```bash
npm run build
```

   The server bundle is in `server/dist`, the web app in `client/dist`.
3. **Configure** `.env` in the project root (see `.env.example`): `NODE_ENV=production`, `MONGODB_URI` with credentials, a long random `APP_SECRET`, `COOKIE_SECURE=true`, `CORS_ORIGINS=https://your-domain`, `BACKUP_ENCRYPTION_KEY` (stored offline as well), `BACKUP_DIR` on a disk that is itself backed up.
4. **Create the owner:** `npm run init-admin` (first deployment only).
5. **Start:** from `server/`:

```bash
npm start
```

   Run it as a service (Windows: NSSM or a scheduled task at startup; Linux: systemd) with automatic restart. The API serves the web app at `/` and the API at `/api/v1`.
6. **TLS:** terminate HTTPS at the reverse proxy and forward to `http://127.0.0.1:4000`. In production the app trusts one proxy hop for client IPs.
7. **Check:** `GET https://your-domain/api/v1/health` → `{"status":"ok","db":"up"}`; sign in; Finance → Financial Dashboard → all integrity checks green; Administration → Backup and Restore → *Back up now* shows *Verified*.

## Operations

* **Logs:** structured JSON on stdout (pino). Redirect to a file or log collector. Unexpected errors are logged with request path; secrets are redacted.
* **Monitoring:** poll `/api/v1/health` (returns 503 when the database is unreachable). Notifications in the app cover failed backups and suspicious sign-ins.
* **Upgrades:** take a backup, deploy the new build, restart; migrations run automatically at start (`npm run migrate -w server` shows status).
* **Restore drills:** quarterly, restore the latest backup into a scratch database and run the integrity checks (see BACKUP_AND_RESTORE.md).

## Verified locally

The production build was started with `NODE_ENV=production` and checked: health endpoint OK, single-page app served at deep links (e.g. `/sales`), CSP and security headers present, protected API returns 401 without a session. HTTPS, a real domain and a service manager were **not** set up in this environment.
