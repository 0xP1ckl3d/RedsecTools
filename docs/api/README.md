# RedSecTools API Documentation

This folder contains the repository-only API documentation for RedSecTools.

Files:
- `openapi.json` — OpenAPI 3.1 spec covering the HTTP API, auth requirements, request bodies, and common responses.

The current spec now includes the collaboration feature set introduced in the app:

- role-aware `/api/auth/me` responses with `role`, `permissions`, and `availableTools`
- homepage bulletin feed, bulletin asset upload, and built-in tool favourite endpoints
- admin role management and bulletin management endpoints
- RedSecCal bootstrap, weekly schedule, project management, team allocation, statistics, and admin calendar-setting route groups
- early RedSecSurvey and RedSecWiki route groups used by the current in-progress placeholder implementations

Important:
- These docs are **not** exposed by the live app.
- The Express server only serves files from `public/` and explicit route mounts in `server/index.js`.
- Nothing under `docs/` is mounted or reachable unless you separately publish it yourself.

## How to view the docs

Any OpenAPI-compatible viewer will work. Common options:

1. Open `docs/api/openapi.json` in [Swagger Editor](https://editor.swagger.io/)
2. Import it into Postman, Insomnia, or Bruno
3. Use any local OpenAPI viewer you already prefer

## Auth overview

The spec documents the auth required for each route using these schemes:

- `UserSessionCookie`
  - Signed cookie: `redsec_session`
  - Used by the main authenticated web app API
  - `/api/auth/me` now returns the effective role and flattened permission set for the session

- `GuestSessionCookie`
  - Signed cookie: `redsec_guest`
  - Only valid for guest-enabled paste/share creation flows
  - Guest links are tool-scoped (`paste` or `share`)

- `ExtensionBearer`
  - `Authorization: Bearer <extension session token>`
  - Used by the Chrome extension API under `/api/ext`

- `AdminCookie`
  - Signed cookie: `redsec_admin`
  - Used by admin endpoints under `/admin/api`
  - After bootstrap, admin API access also requires an active linked `redsec_session`

## Notes

- The source of truth for behavior is still the route handlers in `server/routes/`.
- This spec documents the current routes and payload shapes used by the app today, including the collaboration and extension endpoints.
- Bulletin content is intentionally documented as sanitized HTML plus preset-driven presentation metadata. Raw CSS, JavaScript, and arbitrary asset URLs are not accepted by the live app.
- Survey and Wiki are currently placeholder tools under active development. Their documented route shapes are real and mounted, but those tool surfaces are still evolving and may change faster than the mature Paste/Share/Vault/Auth parts of the app.
