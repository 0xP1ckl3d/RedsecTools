# Release Notes

## Unreleased

- Added executable route protection contracts.
- Added migration prefix/id validation.
- Added seeded legacy database upgrade coverage.
- Added central feature flags for fresh admin re-auth, SAML, OpenAPI publishing, service-account API access, and platform webhooks.
- Added admin-gated in-app OpenAPI publishing.
- Added scoped service accounts with hashed bearer tokens.
- Added signed platform webhooks with delivery history and retry state.
- Extracted base schema creation and legacy compatibility patches out of `server/database.js`.
- Added Playwright and axe visual/accessibility smoke coverage.
- Added compliance and operations documentation.

## Rollback Notes

This release adds tables for service accounts and platform webhooks. Migrations are additive. To roll back, restore the pre-release SQLite database and matching `data/` directory backup.
