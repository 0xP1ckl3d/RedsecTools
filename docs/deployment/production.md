# Production Deployment

Docker Compose is the recommended production deployment path for RedSecTools.

## Layout

Use one persistent application data volume and keep `.env` outside source control.

```text
redsectools/
  .env
  docker-compose.yml
  data/                 # if using a bind mount instead of the named volume
```

The bundled `docker-compose.yml` uses the named volume `redsectools-data` for `/app/data`. That directory contains the SQLite database, encrypted share files, brand assets, avatars, generated Reporter artefacts, callback data, and MiniTools source caches.

## Required Environment

Create `.env` from `.env.example` and set production values before starting the stack.

```bash
cp .env.example .env
```

Required values:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
ADMIN_PASSWORD=<strong-bootstrap-admin-password>
COOKIE_SECRET=<32-byte-random-secret>
COOKIE_SECURE=true
TRUSTED_PUBLIC_ORIGINS=https://tools.example.com
TRUST_PROXY=loopback
REDSECTOOLS_BUILD_COMMIT=<release-commit-sha>
```

Generate a cookie secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Start

Build and start the stack:

```bash
docker compose up --build -d
```

Check container health:

```bash
docker compose ps
docker compose logs --tail=100 redsectools
```

Check readiness through the reverse proxy:

```bash
curl -fsS https://tools.example.com/readyz
```

## Reverse Proxy And TLS

Terminate TLS at the reverse proxy. Forward traffic to the RedSecTools container on port `3000`.

Set:

```text
COOKIE_SECURE=true
TRUSTED_PUBLIC_ORIGINS=https://tools.example.com
```

Set `TRUST_PROXY` only for the proxy topology you actually run. For a local reverse proxy on the same host, `TRUST_PROXY=loopback` is usually appropriate. Do not enable broad proxy trust unless forwarded headers are controlled.

Forward these headers:

```text
Host
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
```

WebSocket proxying must be enabled for:

```text
/ws
/ws/notifications
/ws/redsecai
/ws/callback
```

## SMTP

SMTP is configured after login in Admin > Settings. Use the built-in test control before relying on invites, reset emails, or share notifications.

## RedSecAI And Ollama

The Compose stack includes the `redsecai` Ollama sidecar and stores model data in `redsectools-ai`.

Configure model settings in `.env`:

```text
REDSECAI_ENABLED=true
REDSECAI_MODEL=qwen3.5:4b
REDSECAI_AUTO_PULL=true
```

For external model endpoints, configure the endpoint and model in Admin and verify diagnostics before enabling operational use.

## Backups

Use Admin > Deployment > Encrypted Backup to export a platform backup. The export includes:

- SQLite database backup.
- Persistent data files under `/app/data`, excluding temporary files and the live database file duplicate.
- Brand assets.
- Uploaded/shared file storage.
- Reporter artefacts stored locally.
- Callback data retained in the database.
- Backup manifest with version, build commit, latest migration, included paths, excluded paths, format, and encryption metadata.

Store backups off-host and protect the passphrase separately.

## Upgrade

1. Announce a maintenance window.
2. Export an encrypted platform backup from Admin.
3. Back up the Docker volume or bind-mounted data directory at the host level.
4. Pull or deploy the new release branch/tag.
5. Set `REDSECTOOLS_BUILD_COMMIT` in `.env`.
6. Rebuild and restart:

   ```bash
   docker compose up --build -d
   ```

7. Check:

   ```bash
   curl -fsS https://tools.example.com/readyz
   docker compose logs --tail=100 redsectools
   ```

8. Confirm Admin > Deployment shows the expected version, build commit, and latest migration.

## Rollback

1. Stop the stack:

   ```bash
   docker compose down
   ```

2. Restore the previous application image/source and the matching data backup.
3. Restore `.env` from the previous release if it changed.
4. Start the stack:

   ```bash
   docker compose up -d
   ```

5. Check `/readyz`, login, Admin > Deployment, and the latest migration shown in the UI.

Do not roll back application code while keeping a newer migrated database unless the release notes explicitly state that it is safe.

## Post-Deployment Checks

- `/healthz` returns `ok`.
- `/readyz` returns `ready`.
- Admin login works.
- Admin > Deployment shows version, build commit, latest migration, database size, data directory size, and worker status.
- SMTP test succeeds if email is required.
- Reporter PDF generation works if Reporter is enabled.
- WebSockets connect for RedSecTeam, notifications, RedSecAI, and callback MiniTool where used.
- RedSecAI diagnostics match the configured endpoint.
- Threat feed and webhook workers show healthy status.
- Backup export completes and the manifest can be inspected during restore drills.
