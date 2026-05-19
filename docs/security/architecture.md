# Security Architecture

## Authentication Modes

- `redsec_session`: signed browser user session backed by server-side session storage.
- `redsec_guest`: signed guest-link session limited to paste or share creation.
- Extension bearer token: separate Chrome extension session under `/api/ext`.
- Service-account bearer token: scoped professional API access under `/api/v1`, disabled by default.
- `redsec_admin`: admin cookie that also requires a linked user session after bootstrap.

## Enterprise Identity

SAML is the only enterprise identity route. The real routes are:

- `GET /api/auth/sso/saml/login`
- `GET /api/auth/sso/saml/metadata`
- `POST /api/auth/sso/saml/acs`

Do not add fake SSO, fake OIDC, or unused identity routes. Local login remains available unless Admin > Security explicitly enables SSO-required login.

## Integration Security

Service-account tokens are generated with the `rst_sa_` prefix, stored as SHA-256 hashes, scoped, revocable, expirable, and audited. Webhook secrets are encrypted at rest, deliveries are HMAC-SHA256 signed, and targets are validated as public HTTP(S) URLs before delivery.

## Route Governance

`docs/security/route-contracts.json` is executable documentation. The route-contract test parses Express routes and fails when a route is not covered by an auth/permission/rate-limit/audit contract.
