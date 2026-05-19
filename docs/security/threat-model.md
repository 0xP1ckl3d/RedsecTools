# Threat Model

RedSecTools is designed so plaintext content is encrypted in the browser before being submitted to the server. During normal operation, the server stores opaque ciphertext and does not receive paste, file, chat, or vault plaintext. This does not protect against a malicious or compromised server that serves modified JavaScript to clients.

## Primary Assets

- Browser-side plaintext for paste, share, chat, and vault content.
- Authentication sessions, MFA secrets, recovery codes, trusted devices, and admin sessions.
- Opaque ciphertext, encrypted files, report evidence, wiki content, survey responses, threat data, and audit logs.
- SAML identity configuration, SMTP credentials, webhook secrets, and service-account token hashes.

## Main Trust Boundaries

- Browser crypto boundary: plaintext should stay in the browser for encrypted product surfaces.
- API boundary: user sessions, guest links, extension bearer tokens, service-account tokens, and admin cookies are separate auth modes.
- Admin boundary: high-risk writes are auditable and can require fresh admin authentication.
- Server-side fetch boundary: threat feeds, images, favicons, and webhooks must validate public targets and redirects.
- RedSecAI boundary: AI uses scoped APIs and confirmation-gated mutations; it must not read encrypted plaintext or query the DB directly.

## Key Abuse Cases

- Bypassing route auth through direct static page shells.
- SSRF through feed, favicon, image, or webhook URLs.
- Admin setting changes without auditability or recent authentication.
- Service-account token leakage or over-scoping.
- Webhook secret leakage or unsigned delivery spoofing.
- SAML misconfiguration that locks out local admins or permits untrusted assertions.
- Regression from parser-based sanitisation to regex HTML filtering.

## Required Controls

- Preserve route contract tests and update `docs/security/route-contracts.json` with every new route.
- Keep migrations additive and tracked in `server/core/db/migrations/`.
- Keep service-account tokens hashed at rest and shown only once.
- Sign webhooks with `X-RedSec-Signature` and validate all webhook targets with SSRF protections.
- Keep SAML disabled by default and expose all identity controls in Admin > Security.
