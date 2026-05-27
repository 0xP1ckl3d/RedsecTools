# Restore Runbook

This runbook restores a Docker Compose RedSecTools deployment from a known-good backup.

## Before You Start

Confirm you have:

- The encrypted RedSecTools platform backup.
- The backup passphrase.
- The `.env` used by the deployment, especially `COOKIE_SECRET`.
- The target RedSecTools release source/image that matches the backup.

Keep `COOKIE_SECRET` unchanged when restoring existing settings and sessions. Encrypted stored settings such as SMTP credentials, webhook secrets, SAML private keys, and MiniTools API keys depend on it.

## Stop The Stack

```bash
docker compose down
```

Confirm no container is still writing to the data volume:

```bash
docker compose ps
```

## Restore Data

For a host-level volume or filesystem backup, copy the restored data directory back into place and ensure the container user can read and write it.

Named volume example:

```bash
docker volume inspect redsectools_redsectools-data
```

Bind mount example:

```bash
rsync -a restored-data/ ./data/
```

The restored data directory should contain the SQLite database and persistent data folders such as:

```text
pastes.db
files/
avatars/
brand/
bulletin-assets/
reporter-pdfs/
reporter-evidence/
reporter-proposals/
shortcut-icons/
lol-lookup/
```

Do not restore temporary upload files from `tmp/` unless you are deliberately recovering an interrupted upload.

## Restore From Admin Backup Export

The Admin backup export is an encrypted platform archive. It contains a manifest plus encrypted JSON payload with the SQLite backup and persistent files.

Decrypt it in a staging location first, then copy the recovered database and files into the Docker data directory.

```bash
mkdir -p /tmp/redsectools-restore
REDSECTOOLS_BACKUP_PASSPHRASE='<backup-passphrase>' \
  node scripts/restore-platform-backup.js redsectools-backup.rsecbackup /tmp/redsectools-restore
```

The utility prints the restored file count, app version, build commit, and latest migration. Verify the manifest before replacing production data:

- `format`
- `createdAt`
- `appVersion`
- `buildCommit`
- `latestMigration`
- `databaseSha256`
- `includedPaths`
- `excludedPaths`
- `encrypted`

Copy the staged restore output into the Docker data directory only after the manifest matches the expected release.

## Check Permissions

For bind-mounted data, ensure the container user can write the directory. The Dockerfile uses UID/GID `1001`.

```bash
sudo chown -R 1001:1001 ./data
```

## Restart

```bash
docker compose up -d
```

Watch startup:

```bash
docker compose logs -f redsectools
```

## Verify

Readiness:

```bash
curl -fsS https://tools.example.com/readyz
```

Expected result:

```json
{"status":"ready"}
```

Operational checks:

- Log in with a normal user account.
- Open `/admin` while signed in and unlock with `ADMIN_PASSWORD`.
- Confirm Admin > Deployment shows database connectivity, latest migration, data directory size, worker status, and no unexpected warnings.
- Confirm the latest migration matches the expected release.
- Open RedSecPaste, RedSecShare, RedSecTeam, RedSecVault, Reporter, and MiniTools areas that are enabled in the restored deployment.
- Send a test SMTP email if SMTP is configured.
- Generate a small Reporter PDF if Reporter is in use.

## If Restore Fails

1. Stop the stack:

   ```bash
   docker compose down
   ```

2. Preserve the failed data directory for investigation.
3. Re-copy the last known-good data backup.
4. Confirm `.env` matches the backup, especially `COOKIE_SECRET`, `DB_PATH`, `TRUSTED_PUBLIC_ORIGINS`, and `COOKIE_SECURE`.
5. Restart and check `/readyz`.

If migrations fail after a code downgrade, redeploy the matching release for the restored database or restore an older database backup that matches the downgraded release.

## Restore Drill Record

For each production release, record:

- Backup file name.
- Backup timestamp.
- Release version and build commit.
- Latest migration.
- Restore target environment.
- `/readyz` result.
- Login/admin verification result.
- Any manual corrections required.
