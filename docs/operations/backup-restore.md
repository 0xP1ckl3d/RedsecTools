# Backup And Restore

## Backup

Use Admin > Deployment > Encrypted Backup Export for database backups. Backup export is a high-risk admin action and can require fresh admin authentication when Admin > Security enables that control.

Keep file storage, uploaded evidence, brand assets, shortcut icons, and encrypted share files with the database backup when restoring a full deployment.

## Restore

1. Stop the application.
2. Back up the current database and data directory before replacing anything.
3. Restore the SQLite database and matching `data/` assets.
4. Start the application with the same `COOKIE_SECRET`; encrypted stored settings such as SMTP, SAML private keys, and webhook secrets depend on it.
5. Check `/readyz`, Admin > Deployment, schema migrations, and audit logs.
6. Run a browser smoke test for login, admin security, paste, share, vault, and SAML metadata if SSO is enabled.

## Rollback

Migrations must be additive. A rollback should restore the pre-release database backup and matching file assets rather than trying to destructively reverse schema changes in-place.
