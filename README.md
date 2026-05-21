# RedSecTools

RedSecTools is a self-hosted offensive security operations workspace for small teams. It brings secure collaboration, engagement planning, reporting, threat monitoring, focused utilities, and governed AI assistance into one team-controlled platform.

## Features

| Area | Module | Description |
| --- | --- | --- |
| Secure collaboration | **RedSecPaste** | Encrypted paste sharing with syntax highlighting, optional password protection, burn-after-reading behavior, and guest links. |
| Secure collaboration | **RedSecShare** | Encrypted file sharing with configurable file limits, optional password protection, burn-after-reading behavior, guest links, and Chrome extension support. |
| Secure collaboration | **RedSecTeam** | End-to-end encrypted real-time messaging with key backup and rekey flows, rich message UI, and paste, share, and vault embeds. |
| Secure collaboration | **RedSecVault** | Encrypted credential and note management for passwords, API keys, SSH keys, TOTP codes, custom fields, team vaults, shares, history, membership permissions, and vault audit trails. |
| Team operations | **Homepage and bulletins** | Authenticated dashboard with announcements, shortcuts, favorites, weather, profile controls, branding, and notifications. |
| Team operations | **RedSecCal** | Scheduling, projects, allocations, reminders, utilisation tracking, multi-day series, and cross-tool links. |
| Team operations | **RedSecSurvey** | Survey creation with public and internal response modes, permission-aware results, CSV export, and administrative oversight. |
| Team operations | **RedSecWiki** | Team and personal Markdown knowledge spaces with trees, previews, published rendering, revision history, search, and RedSecAI integration. |
| Security operations | **RedSecThreat** | RSS, website, API, and onion feed monitoring with SSRF controls, matching and alerting, IOC extraction, MITRE mapping, tags, feed health, and notifications. |
| Security operations | **RedSecReporter** | Report and proposal workspaces with projects, members, designs, templates, findings, comments, evidence, PDF rendering, and reusable write-ups. |
| Security operations | **RedSecEngage** | Client, opportunity, and engagement workflows with contacts, pipeline and QA tracking, team assignment, notes, activity logs, notifications, and Reporter or Calendar links. |
| Security operations | **RedSecMiniTools** | Focused utilities including CyberChef-style transforms, JWT analysis, email header analysis, CVSS scoring, security header checks, TLS checks, DNS intelligence, SecurityTrails lookups, breach lookup, and LeakRadar lookups where enabled. |
| Assisted operations | **RedSecAI** | Governed assistant backed by local Ollama or an admin-configured compatible model endpoint, with scoped application and MiniTools context and confirmation-gated mutations. |
| Platform | **Notifications** | Persisted notification center with same-origin or trusted-origin WebSocket delivery. |
| Platform | **Admin controls** | User, role, permission, MFA, settings, branding, security posture, audit, encrypted backup export, deployment warning, and tool configuration surfaces. |
| Platform | **Integrations** | Scoped service accounts, platform webhooks, authenticated interactive OpenAPI/Swagger docs, optional SAML SSO controls, and Chrome extension APIs. |

## Architecture

RedSecTools uses:

- A **Node.js and Express** backend for page routes, API routes, WebSocket behavior, authentication, integrations, and security controls.
- A **SQLite** database for application state.
- A **static multi-page frontend** in `public/` for the browser UI.
- **Docker** and npm-based self-hosted deployment paths are supported.
- **RedSecAI** can use a local Ollama service where configured. Administrators may also configure compatible external or cloud model endpoints when that is appropriate for their environment.
- Browser-side cryptography is used for protected paste, file share, chat, and vault content areas.

## Security Model

RedSecTools is a security-sensitive application. Its current controls include authenticated page and API routes, server-side RBAC checks, invite-oriented account flows, bcrypt password hashing, TOTP MFA support, recovery flows, signed HTTP-only cookies, CSP and Helmet-backed response headers, audit logging, rate limiting on sensitive paths, and administrative security controls.

RedSecTools is designed so plaintext content is encrypted in the browser before being submitted to the server. During normal operation, the server stores opaque ciphertext and does not receive paste, file, chat, or vault plaintext. This does not protect against a malicious or compromised server that serves modified JavaScript to clients.

Administrators should also account for the boundaries of optional features:

- MiniTools that process locally in the browser do not need to send their input to an external lookup service.
- Server-side lookup tools can make controlled network requests or call configured third-party APIs.
- RedSecAI can send prompts and scoped context to the configured model endpoint.
- External APIs, cloud AI endpoints, SMTP providers, webhooks, and SSO identity providers have their own data-handling and availability risks.

Authorization is enforced server-side; frontend visibility alone is not an access control boundary.

## Quick Start

These steps describe a fresh npm-based install.

1. Clone the repository.

   ```bash
   git clone https://github.com/0xP1ckl3d/RedSecTools.git
   cd RedSecTools
   ```

2. Install dependencies.

   ```bash
   npm install
   ```

3. Create and configure `.env`.

   ```bash
   cp .env.example .env
   ```

   On PowerShell:

   ```powershell
   Copy-Item .env.example .env
   ```

4. Set a strong `COOKIE_SECRET` in `.env`.

   RedSecTools refuses to start with a missing or default cookie secret. Review the rest of `.env` before exposing the app outside a local development environment.

5. Build frontend assets.

   ```bash
   npm run build
   ```

6. Start the application.

   ```bash
   npm start
   ```

Tracked database migrations run during application startup.

### First admin access

`ADMIN_PASSWORD` is the bootstrap password for `/admin`.

- Before any RedSecTools user accounts exist, `/admin` can be unlocked with `ADMIN_PASSWORD` so the initial deployment can be configured.
- After the first user account has been created, admin access requires both an active signed-in RedSecTools user session and the admin password. Sign in to the application first, then open `/admin`.

Keep the generated or configured admin password available after first setup. Creating a user account does not replace it.

### Assisted local setup

Fresh local setup scripts are also available:

```bash
./setup.sh
```

On PowerShell:

```powershell
.\setup.ps1
```

The setup scripts create `.env` values such as a generated admin password and cookie secret, then guide the initial host, port, cookie, trusted-origin, and RedSecAI choices.

### Docker

The repository includes a Dockerfile and Docker Compose stack. After preparing `.env`, start the application stack with:

```bash
docker compose up --build
```

The Compose stack includes the RedSecTools app, an Ollama-backed RedSecAI sidecar, and a Tor proxy sidecar used by supported threat workflows.

## Configuration

Start with `.env.example`, then complete runtime configuration in Admin where a setting is intentionally managed through the UI.

### Environment variables

| Area | Variables | Notes |
| --- | --- | --- |
| Server | `HOST`, `PORT`, `NODE_ENV`, `DB_PATH` | Control bind behavior, runtime mode, and optional SQLite path override. |
| Session and proxy security | `COOKIE_SECRET`, `COOKIE_SECURE`, `TRUST_PROXY`, `TRUSTED_PUBLIC_ORIGINS` | Use a strong cookie secret. Enable secure cookies behind HTTPS. Set proxy trust and trusted origins deliberately. |
| Admin bootstrap | `ADMIN_PASSWORD` | Used for initial admin setup paths where configured. Handle it as a secret. |
| Feature defaults | `ADMIN_REAUTH_REQUIRED`, `OPENAPI_ENABLED`, `SERVICE_ACCOUNTS_ENABLED`, `WEBHOOKS_ENABLED`, `SSO_ENABLED`, `SSO_REQUIRE_FOR_LOGIN` | Environment defaults for operational feature controls that are also surfaced through Admin settings. Keep SAML defaults disabled until the IdP flow is configured and tested. |
| RedSecAI | `REDSECAI_ENABLED`, `REDSECAI_BASE_URL`, `REDSECAI_MODEL`, `REDSECAI_TIMEOUT_MS`, `REDSECAI_NUM_CTX`, `REDSECAI_ACTION_TTL_SECONDS`, `REDSECAI_AUTOSTART`, `REDSECAI_AUTO_PULL`, `REDSECAI_HOST`, `REDSECAI_HOST_PORT` | Configure local Ollama and compatible model endpoint behavior for npm or Docker deployment paths. |
| Reporter PDF | `REPORTER_PDF_TIMEOUT_MS`, `PUPPETEER_EXECUTABLE_PATH` | Control PDF renderer behavior where Reporter PDF export is used. |

### Admin-managed settings

| Area | Current controls |
| --- | --- |
| Security | Fresh admin re-auth enforcement, SAML SSO enablement and SSO-required login behavior, SAML metadata and certificate settings, OpenAPI visibility, service-account API access, and webhook delivery. |
| Email | SMTP settings and test controls are configured in Admin rather than through the example environment file. |
| AI | RedSecAI enablement, endpoint and model settings, diagnostics, and operational limits where exposed. |
| MiniTools and integrations | Tool enablement plus API keys or limits for configured third-party services such as SecurityTrails and LeakRadar. |
| Audit and export | Audit event review/export and encrypted database backup export. |
| Platform presentation | Branding, dashboard and tool settings, security posture information, and deployment warnings. |

Treat service-account tokens, webhook secrets, SMTP credentials, AI credentials, and third-party API keys as secrets. Do not log or publish them.

## Development Workflow

### npm scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the Express app with `nodemon` and watch Tailwind CSS output. |
| `npm run build` | Build and minify frontend CSS assets. |
| `npm start` | Start the application server. |
| `npm test` | Run the Node test suite. |
| `npm run test:visual` | Run Playwright smoke and accessibility coverage. |

Recommended checks:

```bash
npm test
npm run build
npm audit --omit=dev
```

### CSS workflow

`public/css/style.css` is generated output. Make source stylesheet changes in `public/css/input.css`, then use `npm run build` or `npm run dev` to regenerate CSS.

### Frontend conventions

- Keep browser code compatible with the current CSP posture.
- Do not add inline scripts or inline styles to work around frontend issues.
- Reuse shared UI behavior and styling patterns before creating one-off tool surfaces.
- Keep browser-side encryption boundaries intact when touching paste, share, chat, or vault workflows.

## Deployment Notes

- Use the setup flow above to create the deployment environment before starting the app.
- Terminate production traffic over TLS and verify reverse proxy behavior before exposing the service.
- Keep the SQLite data directory persistent. Docker Compose persists app data through the `redsectools-data` volume.
- Back up application data deliberately and protect exported backup material. The Admin backup path exports an encrypted database backup, but retention, off-host storage, restore drills, and secret handling remain operational responsibilities.
- Verify SMTP, RedSecAI endpoint behavior, MiniTools API keys, webhook targets, service-account scopes, and SAML flows before relying on them in production workflows.
- Monitor health and readiness endpoints at `GET /healthz` and `GET /readyz`.
- Run post-deploy checks for login, MFA policy, permissions, backup/export behavior, audit logging, page access gates, and any enabled integrations.

The Docker image includes dependencies needed by the supported Reporter PDF flow. Reverse proxies and TLS termination remain deployment concerns outside the app container.

## MiniTools Privacy Model

RedSecMiniTools includes both browser-local utilities and server-assisted lookups.

- Local tools such as CyberChef-style transforms, JWT analysis, header analysis, and CVSS calculation process their working input in the browser.
- Server-side lookup tools such as security header checks, TLS checks, DNS intelligence, and supported threat or intelligence lookups can make controlled outbound requests from the application.
- Third-party-backed tools such as SecurityTrails and LeakRadar require admin configuration and should be enabled only when their data flows fit the deployment.
- Sensitive inputs should be handled deliberately. A small utility surface is still part of the application's security boundary when it talks to the server or an external API.

## Contributing

Development work should stay close to the current platform shape:

- Reuse existing components, services, validation paths, and security helpers.
- Preserve CSP-safe JavaScript patterns and the distinction between source CSS and generated CSS.
- Do not bypass RBAC, audit expectations, or browser-side encryption boundaries.
- Add or update tests when routes, permissions, integrations, storage behavior, or major UI workflows change.
- Keep documentation current when setup, deployment behavior, security assumptions, or module capabilities change.
