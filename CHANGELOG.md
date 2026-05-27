# Changelog

## Unreleased

- Standardised Docker Compose as the documented production deployment path.
- Added `/api/version` for package version, build commit, runtime, environment, and latest migration visibility.
- Expanded Admin > Deployment with Platform Health covering runtime, database, storage, SMTP, PDF rendering, WebSockets, RedSecAI, workers, LOL Lookup cache state, cleanup state, and recent warnings.
- Upgraded Admin backup export from a database-only export to an encrypted platform archive with manifest metadata and persistent data files.
- Added production deployment and restore runbooks plus a release checklist.
- Tightened route-contract tests for undocumented routes, high-risk admin writes, MiniTools permissions, and MiniTools feature-flag middleware.
- Added CI checks for route contracts and migrations alongside the default test/build/audit baseline.
- Added controlled-delivery route and migration tests.
- Added feature-flagged OpenAPI publishing, service accounts, and platform webhooks.
- Added admin controls for professional integration surfaces.
- Added database schema and compatibility module boundaries.
- Added compliance, backup/restore, threat model, and security architecture documentation.
