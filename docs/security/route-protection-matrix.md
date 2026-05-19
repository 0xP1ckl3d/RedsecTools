# Route Protection Matrix

This is the current route-protection baseline for RedSecTools. Keep it updated when routes are added, moved, or materially re-protected.

Legend:

- `public`: no login required by design.
- `public_link`: unauthenticated bearer-by-link access. Do not require a user session.
- `guest_or_user`: normal user session or valid scoped guest session.
- `user`: authenticated RedSecTools user session.
- `admin`: active admin session, linked to a user session after users exist.
- `extension`: Chrome extension bearer session.
- `permission`: route also requires server-side RBAC checks or object-level access checks.

## Public And Link Routes

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/login` | public | Login page |
| GET | `/register` | public | Invite token still required by API |
| GET | `/forgot-password` | public | Password reset request page |
| GET | `/reset-password` | public | Token validated by API |
| GET | `/p/:id` | public_link | Page shell only; paste key remains URL fragment/client-side |
| GET | `/s/:id` | public_link | Page shell only; share key remains URL fragment/client-side |
| GET | `/survey/r/:token` | public_link | Public survey response page |
| GET | `/guest/:token` | public_link | Redeems guest invite into scoped signed guest cookie |
| GET | `/api/paste/:id` | public_link | Public encrypted payload read |
| GET | `/api/share/:id` | public_link | Public encrypted metadata read |
| GET | `/api/share/:shareId/file/:fileId` | public_link | Verifies file belongs to share |
| GET | `/api/share/config` | public | Upload limits only |
| GET | `/api/auth/smtp-status` | public | Capability/status only |
| POST | `/api/auth/login` | public | Rate-limited |
| POST | `/api/auth/login/mfa*` | public | Pending-login token flow |
| POST | `/api/auth/register` | public | Invite token required |
| POST | `/api/auth/forgot-password` | public | Rate-limited, generic response |
| POST | `/api/auth/reset-password` | public | Token required |
| GET/POST | `/api/survey/respond/:token` | public_link | Public or internal survey rules enforced by route |
| GET | `/api/homepage/shortcut-icon/:id` | public asset | ID/path validation required |
| GET | `/healthz` | public | Liveness only; no sensitive deployment data |
| GET | `/readyz` | public | Readiness checks; returns DB check and latest migration id only |
| GET | `/api/auth/sso/config` | public | Returns SAML availability and login path only |
| GET | `/api/auth/sso/saml/login` | public | Starts SAML AuthnRequest flow when enabled |
| GET | `/api/auth/sso/saml/metadata` | public | Emits SP metadata when SAML is configured |
| POST | `/api/auth/sso/saml/acs` | public | Validates signed SAML response before session creation |

## Authenticated Page Shells

Direct static shell URLs must reuse the same gates as their friendly page routes.

| Page | Auth | Permission |
|---|---|---|
| `/`, `/index.html` | user | none |
| `/paste`, `/paste/index.html` | guest_or_user | guest must be scoped to paste |
| `/share`, `/share/index.html` | guest_or_user | guest must be scoped to share |
| `/chat`, `/chat/index.html` | user | none |
| `/vault`, `/vault/index.html` | user | none |
| `/calendar`, `/calendar/index.html` | user | `calendar.view` or `calendar.view_team` or `calendar.manage` |
| `/survey`, `/survey/index.html` | user | `survey.create` or `survey.manage_any` or `survey.view_results_any` |
| `/survey/results`, `/survey/results.html` | user | `survey.create` or `survey.manage_any` or `survey.view_results_any` |
| `/wiki`, `/wiki/index.html` | user | any wiki view/create/edit/manage permission |
| `/threat`, `/threat/index.html` | user | `threat.view` or `threat.manage` |
| `/reporter`, `/reporter/index.html` | user | any Reporter view/create/edit/review/approve/manage permission |
| `/engage`, `/engage/index.html` | user | any Engage view/manage permission |
| `/ai`, `/ai/index.html` | user | RedSecAI enabled |
| `/admin`, `/admin.html` | public shell | APIs require admin session |

## Authenticated API Groups

| Route prefix | Auth | Permission / object checks |
|---|---|---|
| `/api/paste` POST | guest_or_user | guest must be scoped to paste |
| `/api/share` POST | guest_or_user | guest must be scoped to share |
| `/api/auth/me` | optional | Returns user/guest/public state |
| `/api/auth/change-password` | user | current password required |
| `/api/auth/verify-password` | user | password limiter |
| `/api/auth/update-*` | user | self profile only |
| `/api/auth/guest-link` | user | creator must be logged in |
| `/api/auth/email-link` | user | creator must be logged in |
| `/api/auth/mfa/*` | user | password/MFA validation depending route |
| `/api/chat/*` | user | conversation membership/object checks |
| `/api/vault/*` | user | vault membership/owner/share checks |
| `/api/calendar/*` | user | calendar RBAC plus object checks |
| `/api/survey/*` | user | survey RBAC plus ownership/manage checks |
| `/api/wiki/*` | user | wiki RBAC plus workspace/page checks |
| `/api/threat/*` | user | `threat.view`/`threat.manage` style route checks |
| `/api/reporter/*` | user | Reporter RBAC plus project membership/object checks |
| `/api/engage/*` | user | Engage RBAC plus visibility/commercial/team/QA checks |
| `/api/ai/*` | user | RedSecAI scoped tool permissions and confirmation-gated mutation checks |
| `/api/notifications/*` | user | notification owner checks |
| `/api/homepage/*` | user unless asset route | bulletin/shortcut ownership and RBAC checks |
| `/api/avatar/*` | user | avatar owner/session checks |

## Admin And Extension Routes

| Route prefix | Auth | Notes |
|---|---|---|
| `/admin/login` | public/admin password | After users exist, requires active linked user session |
| `/admin/logout` | optional admin cookie | Clears admin session |
| `/admin/api/*` | admin | High-risk write actions are wired through `requireRecentAdminAuth`; enforcement is managed in Admin > Security with `ADMIN_REAUTH_REQUIRED` as the bootstrap default |
| `/admin/api/settings/sso` | admin | Manages SAML SSO settings, signing certs, attribute mapping, provisioning, and SSO-required policy |
| `/api/ext/auth/login` | public | Extension login with MFA branches |
| `/api/ext/*` | extension | Bearer extension session, user suspension checks, object checks |

## Follow-Up Work

- Convert this document into a machine-readable route inventory.
- Add tests that compare high-risk route registration against this matrix.
- Add negative route tests for static shell direct URLs.
- Add SAML route tests with signed response fixtures before expanding beyond the current SAML option.
