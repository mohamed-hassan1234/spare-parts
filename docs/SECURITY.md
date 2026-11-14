# Security

## Authentication

* No public registration. The single Super Admin is created on the server console (`npm run init-admin`); there are no default or hard-coded passwords.
* Passwords: minimum 10 characters with upper case, lower case and a digit; hashed with **Argon2id** (19 MiB memory, 2 iterations); rehashed automatically if parameters change.
* Sessions: random token in an `ap_sid` cookie that is **HttpOnly, SameSite=Strict, Secure** (when `COOKIE_SECURE=true`); only a hash of the token is stored. Absolute lifetime `SESSION_TTL_HOURS`, idle timeout `SESSION_IDLE_MINUTES`. Logout revokes the session server-side (a copied cookie stops working — verified by E2E test 25). Password change revokes all other sessions.
* Brute force: per-account lockout after `LOGIN_MAX_ATTEMPTS` failures for `LOGIN_LOCK_MINUTES`; per-IP monitoring raises a *suspicious sign-in* notification; every attempt is recorded with IP and user agent. Unknown usernames take the same time as wrong passwords.
* Optional **TOTP two-factor authentication** (RFC 6238, verified against the RFC test vector).

## Authorization

* Role-based permissions defined in `shared/src/index.ts` (Super Admin, Manager, Cashier, Storekeeper, Accountant). Every route declares its permission and the server checks it before running the handler. The UI hides what a role cannot do, but **the server is the authority**.
* Automated test: every one of the 138 registered routes returns 401 without a session, and every route needing a permission a Cashier lacks returns 403 for a Cashier.

## Request protection

* **CSRF**: per-session token required in `X-CSRF-Token` on every non-GET request, plus SameSite=Strict cookies and an explicit CORS allow-list.
* **Validation**: every body and query is parsed by zod (types, ranges, integer cents, string lengths). MongoDB operator injection in JSON bodies is rejected; Express 5's query parser never builds nested objects; search terms are regex-escaped.
* **Rate limiting**: `RATE_LIMIT_PER_MINUTE` per IP on the API (default 600).
* **Headers** (helmet): strict Content-Security-Policy (no inline scripts), `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, etc.
* **Errors**: clients get safe messages only; unexpected errors return "Something went wrong. The operation was not completed." and are logged server-side with secrets redacted.

## Files

* Product images and logos: content-sniffed (PNG/JPEG/WebP), size-limited, random file names, served with `nosniff`.
* Expense receipts: PDF/PNG/JPEG content-sniffed, stored **outside** the public uploads folder and served only to users with `expenses:read`.
* Imports: CSV/XLSX, 2 MB and 5,000 rows maximum; spreadsheet formula injection is neutralised in exports.

## Data protection

* Audit log (append-only from the application) for logins, product and price changes, purchases, receipts, sales, payments, refunds, adjustments, expenses, settings, backups and restores, with actor, timestamp, IP, before/after values.
* Journal entries and inventory movements are immutable at the model layer.
* Backups are AES-256-GCM encrypted; the key never leaves the server environment.
* The AI module receives only aggregated figures and product names — no customer personal data — and cannot change any data.

## Production checklist

`NODE_ENV=production`, long random `APP_SECRET`, `COOKIE_SECURE=true`, HTTPS termination (reverse proxy), `CORS_ORIGINS` set to the real origin, MongoDB with authentication enabled and not exposed to the internet, `BACKUP_ENCRYPTION_KEY` stored offline, OS firewall allowing only 443.

## Reporting a vulnerability

Contact the system owner directly; do not open public issues containing exploit details.
