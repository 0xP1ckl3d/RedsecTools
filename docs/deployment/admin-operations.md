# Admin Operations Guide

This guide maps day-to-day platform operations to the current Admin layout. Do not create duplicate admin pages for these workflows; extend the existing cards when the platform grows.

## Deployment Posture

Go to **Admin > Server Settings > Deployment**.

Use the **Deployment Posture** card to review production readiness warnings, runtime summary, and the release readiness checklist. The checklist covers cookie/admin secrets, trusted origins, secure cookies, SMTP, first-user state, RBAC/MFA review, MiniTool visibility, backup and restore validation, RedSecAI provider review, integration toggles, and deployment warnings.

Warnings should be resolved before release or explicitly accepted in the release checklist.

## Platform Health

Platform Health is inside **Server Settings > Deployment**.

The overall status is:

- **Healthy** when core checks are passing and no actionable warnings are present.
- **Warning** when non-critical services need review, such as SMTP not configured or stale LOL Lookup data.
- **Degraded** when core runtime checks fail, such as database connectivity or critically low disk space.

Review the per-service badges for database, migrations, data directory, disk/storage, SMTP, PDF renderer, WebSockets, RedSecAI, threat worker, webhook worker, LOL Lookup, callback cleanup, and recent warnings. Use **Refresh** on the Deployment tab after changing settings or workers.

## Backups

Use **Server Settings > Deployment > Encrypted Backup**.

The export includes the SQLite database, persistent data directory files, brand assets, uploaded/shared encrypted file storage, generated local artefacts, callback data, and a manifest. Temporary files and duplicate live database files are excluded.

Enter and confirm a passphrase, export the archive, then keep the passphrase separately. Losing the passphrase makes the archive unrecoverable. After export, review the manifest summary shown in the card.

## Restore Validation

Use [restore.md](restore.md) for the full runbook.

At minimum, validate backups by extracting a recent archive to a staging directory with:

```bash
REDSECTOOLS_BACKUP_PASSPHRASE='your-passphrase' node scripts/restore-platform-backup.js backup.rsecbackup ./restore-staging
```

For a full restore drill, stop Docker Compose, copy the restored database and data directories into the mounted data directory, check file ownership, restart, verify `/readyz`, confirm login/admin access, and confirm the latest migration in Admin > Deployment.

## Audit Events

Audit Events are reviewed in **Server Settings > Deployment**.

Use category, action, outcome, actor, target type, and time range filters for focused review. Quick filters cover admin logins, failed logins, high-risk admin writes, role changes, user suspension/deletion, MFA resets/disables, service-account token changes, webhook changes, backup exports, SSO setting changes, and RedSecAI confirmed actions when logged.

Audit event retention target lives in the same card. Current cleanup is not automatic for audit events unless a future worker explicitly implements it.

## RBAC Review

Use **Server Settings > Access Controls > RBAC Review**.

The card shows users per role, high-risk role permissions, admin-equivalent users, users without MFA, service-account counts and token scope summary, roles with no users, and users without a role.

High-risk permissions include admin-equivalent access, user/role management, Reporter template/review/approval permissions, Engage global/commercial management, Threat feed management, RedSecAI admin/configuration access, MiniTools administration/API configuration, service-account API management, and webhook administration.

## Service Accounts And Webhooks

Use **Server Settings > Session Security**.

Service accounts and webhooks remain behind explicit enablement toggles. Service-account tokens are shown once, stored only as hashes, and inherit updated scopes immediately. Webhooks use HMAC signatures and should have signing secrets rotated when ownership or receiver infrastructure changes.

## Retention Settings

Retention settings stay with the data they affect:

- **Homepage Settings > Bulletins**: bulletin message/image retention.
- **Tool Settings > Threat**: threat alert/article retention.
- **Tool Settings > MiniTools**: LOL Lookup raw backup retention and callback retention note.
- **Server Settings > Deployment**: audit event retention target.
- **Tool Settings > AI**: action expiry and AI data-boundary notes.
- **Tool Settings > Reporter**: generated export storage note.
- **Tool Settings > Share**: encrypted file expiry and cleanup note.

## Module Data-Handling Notes

Data-boundary notes are placed inside the relevant **Tool Settings** tabs. Review these before enabling external APIs, AI providers, broad admin roles, or high-volume retention settings.

