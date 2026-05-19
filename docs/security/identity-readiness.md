# Identity And Commercial Readiness

This document captures the current non-breaking identity/commercial direction for future threads.

## Current State

- Local username/password login remains the only implemented authentication flow.
- Invite-only registration, MFA, recovery codes, trusted devices, and admin sessions remain active.
- Optional high-risk admin re-auth is available in Admin > Security.
- SAML SSO is implemented as an optional login method and is configured in Admin > Security.

## Fresh Admin Re-auth

`ADMIN_REAUTH_REQUIRED` is a bootstrap default only. New deployments seed the database setting from this value, then admins can manage the live toggle in Admin > Security.

When enabled, high-risk admin writes use `requireRecentAdminAuth` and require the admin session to be 15 minutes old or newer.

## SAML SSO

Implemented SAML routes:

- `/api/auth/sso/saml/login`
- `/api/auth/sso/saml/metadata`
- `/api/auth/sso/saml/acs`

The implementation uses `@node-saml/node-saml` for AuthnRequest generation, SP metadata generation, SAML response parsing, InResponseTo validation, timestamp/audience checks, and XML signature validation.

Admin configuration includes:

- IdP SSO URL.
- IdP signing certificate.
- SP Entity ID.
- SP metadata path.
- Attribute mapping for email, username, and full name.
- Optional auto-provisioning and default role.
- Optional signed AuthnRequests using an SP private key and public certificate.
- Optional SSO-required local-login lockout.

Local login remains available unless Admin > Security enables "Require SSO for login". Keep this as an intentional operator action because a bad IdP configuration can lock users out.

## Stage 4 Direction

Stage 4 is paid self-hosted, not hosted SaaS, and is not implemented yet.

Planned shape:

- License keys.
- Edition flags.
- Support bundle export with redacted diagnostics.
- Hardened deployment docs.
- Signed releases and upgrade notes.

Do not add license enforcement until explicitly requested.
