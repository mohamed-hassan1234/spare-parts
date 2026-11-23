# Administrator guide

## Daily routine

1. **Dashboard** — check today's revenue, cash, receivables, payables and the inventory alerts. Change the reporting period with the selector; the period and time zone are always shown under the title.
2. **Point of Sale** — serve customers (see SALES_AND_POS_WORKFLOWS.md).
3. **Notifications** (bell icon) — low/out-of-stock items, overdue customer invoices, supplier payments due within 3 days, dead stock, failed backups, suspicious sign-in activity.
4. **End of day** — Finance → Cash Accounts: compare the cash-on-hand balance with the cash in the drawer. Differences must be recorded (e.g. Finance → Cash Accounts → *Capital / transfer / other*), never edited.

## Weekly / monthly

* **Finance → Financial Dashboard → Integrity checks** — all checks should be green. Any red check means data must be investigated before closing the month.
* **Customer Debts / Supplier Debts** — follow up overdue balances using the aging buckets.
* **Expenses → Recurring** — record rent, salaries and bills with one click per month.
* **Reports → AI Insights** — monthly summary (works without AI; with `ANTHROPIC_API_KEY` set, AI writes the narrative only).
* **Backup and Restore** — confirm the latest backup is *Verified*; download a copy to external storage.

## Business settings (Administration → Business Settings)

Shop name, logo, phone, address (printed on invoices and receipts), currency (USD), time zone (Africa/Mogadishu — all reports use it), invoice/purchase number prefixes, tax name and rate, whether prices include tax, minimum-price enforcement, maximum discount without approval, return window and policy text, warranty policy, low-stock default, dead-stock threshold, session idle timeout and backup retention. Every change is audited with before/after values.

## Security settings (Administration → Security Settings)

* Change your password (signs out every other session).
* Turn on two-factor authentication: *Set up* → add the key to an authenticator app → enter the 6-digit code.
* Review and sign out other active sessions.
* Audit Logs → *Sign-in attempts* shows every successful and failed login with IP and device.

## Correcting mistakes (never edit history)

| Mistake | Correction |
| --- | --- |
| Wrong expense | Expenses → open it → *Void* (reason required), then record it again |
| Wrong product price | Edit the product — the change is recorded in price history; past invoices keep their price |
| Physical stock differs | Inventory → Stock Counts (or Stock Adjustments) with a reason |
| Customer returned goods | Sale → *Return items* (refund or store credit, linked to the invoice) |
| Wrong capital/transfer entry | Finance → General Ledger → entry → *Reverse* |
| Purchase not yet received | Purchase → *Cancel* (reason required) |

Debt balances cannot be typed in; they only change through sales, payments, returns and their reversals.

## Staff accounts

Version 1 runs with the single Super Admin. Roles for Manager, Cashier, Storekeeper and Accountant and their permissions already exist and are enforced by the API (verified by automated tests), but there is no staff-management screen yet; see FINAL_VERIFICATION_REPORT.md.

## Recovery

Forgotten password: on the server console run `npm run reset-password -w backend -- <username>`. This signs the user out everywhere and is audited.
