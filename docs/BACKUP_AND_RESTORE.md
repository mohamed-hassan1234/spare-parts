# Backup and restore

## What a backup is

A single file `autoparts-<kind>-<timestamp>.apbk` in `BACKUP_DIR` containing every collection (canonical Extended JSON, so ids, dates and numbers round-trip exactly), gzip-compressed and encrypted with **AES-256-GCM** using `BACKUP_ENCRYPTION_KEY`. The GCM tag detects tampering or corruption. Each backup log stores the SHA-256 of the file and the document count of every collection.

**Verification:** right after writing, the file is decrypted, parsed and every collection count is compared with what was exported. Only then is it marked *Verified*. You can re-verify any time (Administration → Backup and Restore → *Verify*).

## Creating backups

* **Manual:** Administration → Backup and Restore → *Back up now*, or `npm run backup -w backend`.
* **Scheduled:** every `BACKUP_SCHEDULE_HOURS` hours (default 24) while the server runs with `JOBS_ENABLED=true`.
* **Retention:** the newest `backupRetentionCount` (setting) files are kept; older files are removed.
* **Failure:** a failed backup is logged and raises a critical notification.
* **Off-site copy:** download backups from the page (audited) and keep them on separate storage. Keep `BACKUP_ENCRYPTION_KEY` offline too — without it a backup cannot be read.

## Restoring

Restores are run from the server console only.

1. **Always restore into a new database first and check it:**

```bash
npm run restore -w backend -- autoparts-manual-2026-11-12T14-37-51-508Z.apbk --target autoparts_restore_check
```

   The target must be empty. Point a test instance at it (`MONGODB_URI=…/autoparts_restore_check?replicaSet=rs0`), sign in, open Finance → Financial Dashboard and confirm all integrity checks pass.

2. **Replace the live database (only with explicit owner authorisation):**

```bash
npm run restore -w backend -- <file> --target autoparts_erp --force-live
```

   You must type the database name to confirm. A `PRE_RESTORE` backup of the current data is taken automatically before anything is replaced. Stop the API first so no one writes during the restore, then start it again.

## Verifying a file without restoring

```bash
npm run verify -w backend -- <file>
```

(`npx tsx src/cli.ts verify <file>` from `backend/` if the script alias is not present.)

## Tested

`backend/src/tests/integration/backup.test.ts` creates an encrypted backup, checks that business data is not readable in the file, confirms that restoring over the live database is refused, restores into a separate database and compares document counts, and confirms a non-empty target is refused.
