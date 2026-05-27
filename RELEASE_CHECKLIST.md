# Release Checklist

Use this checklist before merging a release branch into `main`.

## Branch And Version

- Development work completed on a non-`main` branch. Treat `main` as the stable release branch.
- `package.json` and `package-lock.json` version updated.
- `CHANGELOG.md` updated.
- `REDSECTOOLS_BUILD_COMMIT` identified for deployment.

## Required Checks

```bash
npm test
npm run build
npm audit --omit=dev
node --test tests/route-contracts.test.js tests/migrations.test.js
```

## Operational Checks

- Clean Docker Compose build succeeds.
- `/healthz` returns `ok`.
- `/readyz` returns `ready`.
- Admin > Deployment shows version, build commit, latest migration, database status, storage status, worker status, and recent warnings.
- Admin backup export completes and includes a manifest.
- Restore runbook has been exercised against a staging or disposable environment.
- SMTP test completed if email is configured.
- Reporter PDF smoke test completed if Reporter is enabled.
- WebSocket paths verified behind the reverse proxy.

## Security Checks

- Route contract tests pass.
- New routes are documented in `docs/security/route-contracts.json`.
- High-risk admin writes require recent admin auth where applicable.
- MiniTools API routes require `minitools.view` and server-side feature flags.
- CSP was not weakened.
- Browser-side encryption semantics for paste, share, RedSecTeam, and vault were preserved.

## Merge And Tag

- Merge release branch into `main`.
- Tag the release.
- Deploy with `REDSECTOOLS_BUILD_COMMIT` set to the tagged commit SHA.
- Keep the previous release artefact and data backup available for rollback.
