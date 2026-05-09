# RedSecTools

A multi-tool security platform by [RedSec Offensive Security](https://github.com/0xP1ckl3d). All encryption and decryption happens entirely in the browser — the server never sees plaintext content.

<img width="1094" height="782" alt="image" src="https://github.com/user-attachments/assets/be47f756-4744-439a-817d-80beed8b0cb2" />

## Features

| Tool | Description |
|---|---|
| **RedSecPaste** | Encrypted pastebin with optional password protection, burn-after-reading, and syntax highlighting |
| **RedSecShare** | Encrypted file sharing with admin-configurable upload limits, optional password protection, and browser-side encryption |
| **RedSecChat** | End-to-end encrypted real-time messaging with rich text formatting, emoji, and file sharing |
| **RedSecVault** | Encrypted credential manager for passwords, API keys, SSH keys, TOTP 2FA codes, and secure notes |
| **BulletinBoard** | Workspace bulletin feed on the homepage with rich-text notices, scheduling, pinning, preset styling, and WebP image support |
| **RedSecCal** | Team and individual scheduling for assignments, tasks, reminders, utilisation tracking, and project-linked calendar entries |
| **RedSecSurvey** | Role-aware survey builder with public or internal response modes, live results, CSV export, expiry windows, and admin oversight |
| **RedSecThreat** | Threat intelligence monitor with RSS/website/API/onion feed ingestion, keyword and regex matching, automatic IOC extraction, alert triage with criticality levels, and webhook/email/Discord notifications |
| **RedSecWiki** | Team and personal Markdown wiki with page trees, subpages, live preview, published rendering, revision history, and search |
| **RedSecReporter** | SysReptor-style pentest report builder with assigned-member projects, custom report designs, finding templates, CVSS scoring, comments, evidence, and versioned PDF generation |
| **RedSecAI** | Local Ollama-powered assistant (Qwen, Gemma, or any compatible model) for scoped calendar reasoning, wiki drafting, threat-intel summaries, and confirmation-gated actions without access to encrypted paste/share/chat/vault plaintext |
| **RedSecTools Chrome Extension** | Chrome Manifest V3 extension for Vault access, autofill, Paste creation, and Share creation using the same server and encryption model |

**Key security properties:**
- AES-256-GCM encryption via the Web Crypto API (zero server-side crypto)
- Server stores only opaque ciphertext — it cannot read your pastes, files, messages, or vault entries
- Optional password protection adds a second layer (PBKDF2, 600K iterations)
- TOTP-based multi-factor authentication with recovery codes and trusted device support
- Invite-only user registration, bcrypt password hashing, server-side sessions
- Strict CSP, Helmet security headers, rate limiting on all endpoints

---

## Chrome Extension

RedSecTools includes an unpacked Chrome extension in `extension/chrome`.

Current extension scope:
- Vault unlock, search, filtering, detail view, and edit support
- Exact-host-first autofill suggestions, with base-domain fallback only when no exact host match exists
- Save new site passwords into writable vaults with password generation
- Direct RedSecPaste link creation
- Direct RedSecShare link creation
- Extension-specific bearer sessions using `/api/ext/*`
- Same server-configured session TTL, extended session TTL, and remembered-MFA duration as the main app

### Install In Chrome (Not In Chrome Web Store Yet)

1. Download or clone this repository to your machine.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on `Developer mode` in the top-right corner.
4. Click `Load unpacked`.
5. Select the folder:
   - `RedSecTools/extension/chrome`
6. Pin the extension if you want quick access from the Chrome toolbar.

### Updating The Extension

When you pull new changes or replace the extension files:

1. Open `chrome://extensions`
2. Find `RedSecTools`
3. Click the reload icon on the extension card

If the server was updated too, restart the RedSecTools server before reloading the extension.

---

## API Documentation

Repository-only API documentation is available in:

- `docs/api/openapi.json` — OpenAPI 3.1 spec for the current HTTP API
- `docs/api/README.md` — how to view the spec locally and auth notes

These docs are not exposed by the live app. The server does not mount anything under `docs/`.

---

## Homepage Dashboard

The landing page (`/`) is a fully featured dashboard with:

- **Personalized greeting** — "Welcome back, username" with live date and ticking clock
- **Google search bar** — web search without leaving the page
- **Weather widget** — real-time weather for up to 5 admin-configured cities (Open-Meteo API), with local time ticking per city
- **BulletinBoard preview** — the latest 5 active workspace bulletins render as homepage cards below the weather section
- **Quick Access** — 5 user-selected built-in tool favourites followed by 5 shortcut favourites on the homepage, filtered by the current user's role permissions
- **Bulletin dashboard view** — pinned-first bulletin feed with full-message expansion, incremental loading, scheduling, recurrence, and permission-aware in-app management
- **Collapsible sidebar** — navigate between Home, Tools, Bulletin, Shortcuts, Profile, and About views with collapsible Team and Personal link sections
- **Mobile responsive** — sidebar collapses to a tab bar on mobile, weather grid adapts to 2 columns

### Roles and Permissions

Users are now assigned one primary role. Roles are managed in Admin and map to action-based permissions such as:

- `bulletin.view`, `bulletin.create`, `bulletin.edit_any`, `bulletin.pin`, `bulletin.manage`
- `calendar.view`, `calendar.create`, `calendar.view_team`, `calendar.manage`
- `survey.create`, `survey.manage_any`, `survey.view_results_any`
- `threat.view`, `threat.manage`
- `wiki.view`, `wiki.create_personal`, `wiki.create_team`, `wiki.edit_team`, `wiki.manage`
- `reporter.view`, `reporter.create`, `reporter.edit_own`, `reporter.edit_assigned`, `reporter.review`, `reporter.approve`, `reporter.manage_templates`, `reporter.manage_all`

UI visibility follows the user's granted permissions, but enforcement is server-side on the protected APIs and the new tool pages.

### RedSecReporter

RedSecReporter is the report-building workspace for pentest projects. It provides:

- Assigned-member project access: `reporter.view` allows entry to the Reporter tool, but project contents are visible only to assigned project members. Users with `reporter.manage_all` can see every project.
- Project leads and managers can control project membership, roles, status, archive state, readonly state, evidence, comments, notes, generated PDF versions, and imports/exports.
- Custom report designs with editable HTML/CSS, section definitions, design duplication, and live PDF previews.
- Finding templates with searchable insertion, markdown split preview, evidence insertion, scope component selection, and CVSS 3.1/4.0 builder support.
- Versioned PDF generation and temporary PDF previews rendered through Chromium/Puppeteer. The setup scripts include the PDF timeout and Chromium executable variables used by Docker and npm deployments.

Admin > Tools > RedSecReporter shows global report stats, recent projects, project creators, status/archive state, and an expandable list of assigned users who can access each project.

### RedSecAI

RedSecAI is the built-in local assistant backed by a configurable Ollama model (defaults to `qwen3.5:4b`). In Docker Compose it runs against a separate Ollama sidecar; local npm installs use a local Ollama service on `127.0.0.1:11434`. Cloud models (e.g. `gemma4:31b-cloud`) are also supported when the Ollama environment is signed in.

RedSecAI provides an expandable chat bubble on authenticated pages. It can use a server-side allowlist of scoped application APIs for the logged-in user to help summarize permitted calendar, wiki, reporter, and threat-intel context. It does not have admin scope, does not read the database directly, and does not access decrypted RedSecPaste, RedSecShare, RedSecTeam, or RedSecVault content.

Phase 2 adds confirmation-gated actions. RedSecAI can draft scoped calendar entries/updates, wiki page changes, Reporter records, bulletins, shortcuts, threat metadata, and survey changes, but the browser shows an action card and the logged-in user must explicitly confirm before the server calls the existing RBAC-protected API. Pending action cards are persisted server-side until confirmed, rejected, or expired. The model never receives direct database access and cannot silently mutate records.

Admins control RedSecAI globally from **Admin > Tool Settings > RedSecAI** after installation. The `.env` values are bootstrap defaults and emergency overrides; database-backed Admin settings determine the live global enable flag, Ollama base URL, model name, timeout, action-card expiry, autostart, and auto-pull behavior. The same Admin panel shows endpoint processing mode, cloud/external warnings, pending confirmed-action counts, and recent RedSecAI action activity.

RedSecAI uses a same-origin WebSocket at `/ws/redsecai` for streaming responses. WebSocket upgrades are checked against the request host and `TRUSTED_PUBLIC_ORIGINS`; cross-site browser origins are rejected. The legacy `/api/ai/chat` POST route remains available for health checks and fallback use. If RedSecTools is behind a reverse proxy, make sure WebSocket upgrades are allowed for both `/ws` and `/ws/redsecai` and that the proxy forwards the public `Host` or `X-Forwarded-Host`.

### BulletinBoard

BulletinBoard is part of the homepage rather than a standalone tool page. It supports:

- Rich-text HTML authoring with a constrained server-side sanitizer
- Existing emoji picker reuse for inline emoji insertion
- App-managed inline image uploads converted to WebP
- Scheduling, recurring notices (`none`, `daily`, `weekly`), manual pinning, and preset-only visual treatments
- Preset-only visual styles and animations to preserve CSP and avoid stored script/style injection

Bulletin content accepts only safe allowlisted HTML and internal bulletin asset URLs. User-authored CSS and JavaScript are never stored or executed.

### Shortcuts

Users can create personal shortcuts (bookmarks) with:
- Custom emoji icons (7 categories, 400+ emojis) or uploaded custom images (converted to WebP)
- Title, URL, and optional description
- Drag-to-reorder in edit mode
- Favourite up to 5 shortcuts (star button, top-left of card in edit mode) — these appear in Quick Access
- Team shortcuts managed by admin appear alongside personal shortcuts in a split-column layout

### Weather

Admin configures up to 5 locations via the Admin panel (Settings > Weather):
- City search with Open-Meteo geocoding
- Drag-to-reorder locations — order reflected on all users' homepages
- Cache auto-invalidates when locations are modified

---

## Quick Start (Docker)

**Prerequisites:** [Docker Engine 20.10+](https://docs.docker.com/get-docker/) with Docker Compose V2 (included with Docker Desktop)

```bash
# 1. Clone the repository
git clone https://github.com/0xP1ckl3d/RedSecTools.git
cd RedSecTools

# 2. Run the setup script to generate configuration
#    Linux / macOS / Git Bash:
./setup.sh
#    Windows PowerShell:
#    .\setup.ps1

# 3. Note the admin password printed to your terminal

# 4. Start the application
docker compose up -d

# 5. Open http://localhost:3000
```

That's it. The setup script creates a `.env` file with a randomly generated admin password and cookie secret.

Docker starts three containers: the main RedSecTools app, a `redsecai` Ollama sidecar for the AI assistant, and a `tor-proxy` sidecar for RedSecThreat onion feed support. Ollama binds to `0.0.0.0:11434` inside its sidecar so the app container can reach `http://redsecai:11434`; Compose also publishes it on `127.0.0.1:${REDSECAI_HOST_PORT:-11434}` for local diagnostics. On the first run, the AI container pulls the configured model into the `redsectools-ai` named volume unless `REDSECAI_AUTO_PULL=false`. The main RedSecTools app does not wait for that model download to finish; if the model is missing, the chat bubble reports RedSecAI as unavailable until the model is installed.

Admin model changes are live app settings, not container rebuilds. Saving **Admin > Tool Settings > RedSecAI** updates the model name RedSecTools sends to Ollama, then refreshes the status panel. It does not sign in to Ollama Cloud, restart the `redsecai` sidecar, or change the sidecar's already-running `OLLAMA_MODEL` environment variable. For Docker deployments, install or pull models in the `redsecai` service itself.

If the server has limited bandwidth, set `REDSECAI_AUTO_PULL=false` in `.env` before `docker compose up -d`. Later, pull the model into the persistent AI volume:

```bash
docker compose exec redsecai ollama pull qwen3.5:4b
docker compose restart redsectools
```

Ollama Cloud models, for example `gemma4:31b-cloud` or `kimi-k2.5:cloud`, require the Ollama sidecar to be signed in before pulls or API calls can succeed. If diagnostics show `HTTP 401 unauthorized` from `https://ollama.com`, sign in inside the sidecar and pull the cloud model:

```bash
docker compose exec redsecai ollama signin
docker compose exec redsecai ollama pull gemma4:31b-cloud
docker compose exec redsecai ollama list
docker compose restart redsectools
```

The sign-in state and model metadata live in the `redsectools-ai:/root/.ollama` named volume. They persist across normal container restarts and app updates, but are removed if the Docker volume is deleted with commands such as `docker compose down -v` or volume pruning.

Cloud models and external Ollama-compatible endpoints are treated as external AI processors. RedSecAI only sends the current prompt plus selected, RBAC-scoped tool context to the configured endpoint, but admins should assume that context leaves the server when a cloud model or external base URL is used. Encrypted paste, share, chat, and vault plaintext is still excluded by design.

---

## Local Install (npm)

**Prerequisites:** [Node.js](https://nodejs.org/) 20 or later, npm. RedSecAI also needs [Ollama](https://ollama.com/) installed if enabled outside Docker.

```bash
# 1. Clone the repository
git clone https://github.com/0xP1xkl3d/RedSecTools.git
cd RedSecTools

# 2. Run the setup script
#    Linux / macOS / Git Bash:
./setup.sh
#    Windows PowerShell:
.\setup.ps1

# 3. Note the admin password printed to your terminal

# 4. Install dependencies and build
npm install
npm run build

# 5. Optional first-run warmup for RedSecAI local mode
ollama pull qwen3.5:4b

# 6. Start the server. If REDSECAI_AUTOSTART=true, RedSecTools will
#    start the local Ollama service and pull the configured model if missing.
npm start

# For development with live reload:
# npm run dev
```

Open `http://localhost:3000` in your browser.

---

## Environment Variables

Configuration is managed through a `.env` file in the project root. The setup script generates this automatically. To configure manually, copy `.env.example` to `.env` and edit:

| Variable | Required | Default | Description |
|---|---|---|---|
| `ADMIN_PASSWORD` | Yes | — | Password for the `/admin` dashboard |
| `COOKIE_SECRET` | Yes | — | 32-byte hex string for signing cookies. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `PORT` | No | `3000` | HTTP port the server listens on |
| `HOST` | No | `0.0.0.0` | Bind address. Use `0.0.0.0` for Docker/Tailscale/LAN access, `127.0.0.1` for Cloudflare Tunnel or reverse proxy |
| `NODE_ENV` | No | `production` | Node environment (`production` or `development`) |
| `COOKIE_SECURE` | No | `true` in production | Set `true` when users access the app over HTTPS. Set `false` only for direct HTTP/local deployments. |
| `DB_PATH` | No | `./data/pastes.db` | Path to the SQLite database file |
| `REPORTER_PDF_TIMEOUT_MS` | No | `120000` | RedSecReporter PDF rendering timeout in milliseconds |
| `PUPPETEER_EXECUTABLE_PATH` | No | Auto-detected, `/usr/bin/chromium` in Docker | Chrome/Chromium executable used for RedSecReporter PDF rendering |
| `REDSECAI_ENABLED` | No | `true` | Enables the authenticated RedSecAI chat API and widget |
| `REDSECAI_BASE_URL` | No | `http://127.0.0.1:11434` | Ollama-compatible model endpoint. Docker Compose sets this to the `redsecai` service |
| `REDSECAI_MODEL` | No | `qwen3.5:4b` | Ollama model name used by RedSecAI. Cloud models such as `gemma4:31b-cloud` require `ollama signin` and `ollama pull` in the Ollama environment first |
| `REDSECAI_TIMEOUT_MS` | No | `300000` | Timeout for local model responses |
| `REDSECAI_NUM_CTX` | No | `4096` | Ollama context window requested by RedSecAI |
| `REDSECAI_ACTION_TTL_SECONDS` | No | `7200` | Default expiry for pending RedSecAI confirmation cards. High-impact actions are capped at 30 minutes |
| `REDSECAI_AUTOSTART` | No | `true` for local Ollama URLs | Starts local Ollama automatically when RedSecTools starts. Docker disables this because the AI runs in its own container |
| `REDSECAI_AUTO_PULL` | No | `true` | Pulls the configured model if it is missing. In Docker this runs in the `redsecai` container entrypoint at sidecar startup; in local npm mode it controls local Ollama auto-pull. Cloud pulls still require the Ollama environment to be signed in |
| `REDSECAI_HOST` | No | `127.0.0.1` | Docker-only host bind address for the diagnostic Ollama port |
| `REDSECAI_HOST_PORT` | No | `11434` | Docker-only host port for diagnostic access to Ollama |
| `REDSECAI_INTERNAL_ORIGIN` | No | `http://127.0.0.1:$PORT` | Internal same-app origin used for scoped API context fetches when the bind address is unusual |
| `TRUSTED_PUBLIC_ORIGINS` | Yes for production email/share links | Localhost defaults plus any extra origins entered during setup | Comma-separated allowlist of public origins used for invite links, password-reset links, and guest links |

SMTP email settings are configured in the Admin > Settings UI (stored encrypted in the database) — not via environment variables.

### Updating Existing Deployments For RedSecAI

For existing local npm installs, add these lines to `.env`, restart RedSecTools, then open **Admin > Tool Settings > RedSecAI**:

```env
REDSECAI_ENABLED=true
REDSECAI_BASE_URL=http://127.0.0.1:11434
REDSECAI_MODEL=qwen3.5:4b
REDSECAI_TIMEOUT_MS=300000
REDSECAI_NUM_CTX=4096
REDSECAI_AUTOSTART=true
REDSECAI_AUTO_PULL=true
```

Install Ollama locally. Pull the model when bandwidth allows:

```bash
ollama pull qwen3.5:4b
```

For existing Docker production installs, deploy the updated `docker-compose.yml`, then run:

```bash
docker compose build redsectools redsecai
docker compose up -d
```

The app container talks to `http://redsecai:11434` internally. If an older Admin setting still says `http://127.0.0.1:11434`, Docker startup will prefer the compose-provided internal service URL so the container does not accidentally call itself. You can also verify the sidecar from the Docker host:

```bash
curl http://127.0.0.1:${REDSECAI_HOST_PORT:-11434}/api/tags
docker compose exec redsectools node -e "fetch('http://redsecai:11434/api/tags').then(r=>r.text()).then(console.log)"
```

To postpone model download, set this in the remote `.env` before deployment:

```env
REDSECAI_AUTO_PULL=false
```

Then install the model later:

```bash
docker compose exec redsecai ollama pull qwen3.5:4b
docker compose restart redsectools
```

For Ollama Cloud models in Docker, sign in and pull from inside the sidecar:

```bash
docker compose exec redsecai ollama signin
docker compose exec redsecai ollama pull gemma4:31b-cloud
docker compose exec redsecai ollama list
docker compose restart redsectools
```

If Admin diagnostics show `HTTP 401 unauthorized`, the sidecar is not signed in to Ollama Cloud. If diagnostics show `Local model is not installed yet`, the model is not listed by `docker compose exec redsecai ollama list`; pull it in that sidecar or set `REDSECAI_MODEL` in `.env` and recreate the sidecar so entrypoint auto-pull can run:

```bash
REDSECAI_MODEL=gemma4:31b-cloud
REDSECAI_AUTO_PULL=true
docker compose up -d --force-recreate redsecai
docker compose logs -f redsecai
```

The model is stored in the `redsectools-ai` named volume. Normal app updates do not reinstall it unless you delete volumes with `docker compose down -v` or prune Docker volumes.

For normal updates after the model is already installed, avoid rebuilding every service:

```bash
git pull
docker compose build redsectools
docker compose up -d --no-deps redsectools
```

Rebuild `redsecai` only when `docker/redsecai/*`, the Ollama base image, or the configured model/bootstrap behavior changes.

Reverse proxies must pass WebSocket upgrade headers for RedSecAI streaming:

```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_http_version 1.1;
```

### Trusted Public Origins

Security-sensitive links are now generated only for trusted public origins. This prevents host-header poisoning while still supporting multiple valid deployment URLs.

Examples:

```env
TRUSTED_PUBLIC_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
TRUSTED_PUBLIC_ORIGINS=https://tools.example.com,https://tools.internal.example.com
```

Guidance:
- Add every URL users or admins will actually use to access the app.
- Keep ports in the value when they are part of the user-facing URL.
- The setup scripts now prompt for additional trusted origins and secure-cookie mode during bootstrap, so Docker and proxy deployments can be configured without editing `.env` afterward.
- If any user-facing URL is HTTPS, keep `COOKIE_SECURE=true`. Use `COOKIE_SECURE=false` only when accessing RedSecTools directly over plain HTTP.
- For Docker deployments, update `.env` and restart the container with `docker compose up -d`.
- For npm deployments, update `.env` and restart the Node process.

---

## Changing the Admin Password

1. Open `.env` in a text editor
2. Change the `ADMIN_PASSWORD` value
3. Restart the application:
   - **Docker:** `docker compose up -d`
   - **npm:** stop the server with Ctrl+C, then `npm start`

---

## Updating

Pull the latest code and rebuild. Your database and uploaded files are preserved.

**Docker:**
```bash
git pull
docker compose build --no-cache
docker compose up -d
```

**npm:**
```bash
git pull
npm install
npm run build
# Then restart the server
```

Your data is stored separately from the application code and is never affected by updates.

---

## Usage

### Admin Dashboard (`/admin`)

Log in with the admin password from your `.env` file. After the first user is created, admin access requires both an active user session and the admin password (two-step authentication).

**Current admin grouping:**
- **Server Settings**
  SMTP configuration, session security, and access controls / role management
- **Homepage Settings**
  Weather locations, bulletin retention/purge administration, and team shortcuts
- **User Settings**
  Users and invite management, including invite role assignment
- **Tool Settings**
  RedSecCal workweek/capacity settings plus RedSecTeam, RedSecPaste, RedSecShare, and RedSecVault administration

### Creating Pastes (`/paste`)

1. Log in (or use a guest link)
2. Write or paste your content
3. Optionally set a password for double encryption
4. Choose an expiration time (1 hour, 12 hours, 24 hours, 3 days)
5. Enable burn-after-reading to self-destruct after first view
6. Share the resulting link — the decryption key is in the URL fragment (never sent to the server)

### Sharing Files (`/share`)

1. Log in (or use a guest link)
2. Upload one or more files within the server-admin-configured file count and file size limits
3. Optionally set a password for double encryption
4. Choose expiration and burn-after-reading options
5. Share the link — filenames are also encrypted

### Chat (`/chat`)

End-to-end encrypted real-time messaging with other registered users. Supports rich text formatting (bold, italic, underline, code, code blocks, lists), emoji picker (7 categories), file/paste/share link embeds, and group conversations. Messages are encrypted client-side and auto-expire after 7 days.

### Vault (`/vault`)

Encrypted credential manager supporting passwords, API keys, SSH keys, TOTP 2FA codes, and secure notes. Personal vaults are encrypted with the user's password. Team vaults use RSA key pairs for member-to-member key exchange. Entries can be shared directly between users.

### Calendar (`/calendar`)

RedSecCal provides a dashboard-style operations planner with:

- Sidebar views for personal schedule, project management, team project schedule, and statistics
- Individual calendars for each user with weekly planning, all-day events, multi-day spans, and timed entries
- Role-aware visibility so some users see only their own calendar while elevated roles can review team schedules
- Manager-controlled project planning with consultant allocation, delivery windows, and project-linked calendar entries
- Weekly, monthly, and yearly utilisation reporting across users and projects

Projects support estimates in either hours or days, a global default daily-hours setting for manager allocations, daily-rate billing, estimated full-project cost, and dual progress tracking for scheduled time versus completed time. Linked project calendar items can autofill project details, and scheduled project effort is rolled up directly from the calendar entries created against that project.

### Survey (`/survey`)

RedSecSurvey provides an internal survey workspace with:

- Draft, published, ended, and closed lifecycle states
- Public anonymous or internal named response modes
- Time-windowed response collection with reopen support for ended surveys
- Builder, live status updates, and result views with CSV export
- Basic anti-abuse protections for public responses using per-survey browser response sessions plus duplicate-user submission blocking for authenticated responders
- Admin visibility and deletion controls from the Admin tool settings area

### Threat Intel (`/threat`)

RedSecThreat provides a threat intelligence monitoring dashboard with:

- **Feed sources** — RSS, website (HTML scraping), REST API, and Tor onion (.onion via SOCKS proxy). Each source runs on its own configurable polling interval with SHA-256 content hashing for deduplication
- **User-scoped monitoring** — Default watchlist keywords are shared, but each user can disable defaults, create personal keywords and tags, and maintain their own read state without duplicating stored feed content in the database
- **IOC extraction** — Automatic extraction of IPs, domains, file hashes, URLs, and email addresses from matched content
- **Alert system** — Matched items generate a shared stored alert per source item, then attach user-owned keyword matches, tags, and read state on top. Alert detail includes source links, full stored context, and local-time timestamps in the UI
- **Notifications** — Admin-controlled email/webhook/Discord policy with per-user opt-in delivery. Email alerts always use the user account email; Discord and generic webhook destinations are user-configured
- **API templates** — Reusable feed templates with preconfigured endpoint, auth, headers, and field mapping, managed from the admin panel alongside feeds and policy
- **Tags** — Shared default tags plus personal user tags, applied independently to each user’s keywords and alerts
- **Permissions** — `threat.view` grants access to the personal threat workspace; global feed sources, API templates, and notification policy are administered from the separate admin panel

#### Dark Web / Onion Feed Setup

RedSecThreat can poll `.onion` feeds, but those feeds require a Tor-capable SOCKS proxy.

- **Docker deployments** — `docker-compose.yml` now includes a `tor-proxy` sidecar and sets `TOR_PROXY=socks5h://tor-proxy:9050` for the app container. In most Docker installs, onion feeds work as soon as the stack is up.
- **Admin override** — Admins can set **Admin > RedSecThreat > Tor / SOCKS Proxy URL** to override the default Docker sidecar address or point at another Tor/SOCKS gateway.
- **Non-Docker deployments** — Run a local Tor service and set the admin proxy field to something like `socks5h://127.0.0.1:9050`.
- **Operational note** — Onion feeds remain visible in the admin feed list even if no proxy is configured, but they will not fetch successfully until a Tor/SOCKS proxy is available.

#### Threat Notifications

Threat notifications are split between admin policy and user preferences:

- **Admins** decide which notification types are allowed and configure shared sender behavior such as the optional email from-override and Discord sender branding.
- **Users** only opt in to the channels admins allow. Email notifications go to the user’s login email automatically. Discord and webhook recipients are configured by the user.

### Wiki (`/wiki`)

RedSecWiki is the internal knowledge hub for RedSecTools. It now provides:

- A **team wiki** for shared process docs, runbooks, engagement notes, and living documentation
- A **personal wiki** for private notes, checklists, meeting prep, and individual working pages
- Nested page trees with subpages in both spaces
- Markdown authoring with the same rendered output used for live preview and published pages
- Revision history with restore
- Search across visible spaces
- Role-aware creation and editing rules for personal and team pages

The Wiki interface uses the same shell pattern as the homepage and admin surfaces: a persistent sidebar, focused content region, and tool-specific management instead of the smaller floating layout used by earlier placeholder tools.

Wiki is intended for runbooks, methodology notes, onboarding docs, internal references, project knowledge, and personal working pages, all within the same permission-aware platform shell as the other RedSecTools apps.

### Chrome Extension

After loading the unpacked extension, sign in with the same RedSecTools server URL and your normal user account.

The extension supports:
- Vault browsing and filtering across personal, team, and shared entries
- Full entry detail view with copy, reveal, and edit actions where permitted
- Login-form matching and explicit fill on the current site
- Creating a new password entry for the current site
- Creating RedSecPaste and RedSecShare links directly from the popup

The extension is currently distributed as an unpacked build only. It is not yet published in the Chrome Web Store.

### Multi-Factor Authentication

Users can enable TOTP-based MFA from the homepage Profile view. Supports:
- Standard authenticator apps (Google Authenticator, Authy, 1Password, etc.)
- Recovery codes (one-time use, regenerable)
- "Remember this browser" — skip MFA for trusted devices (configurable duration)
- "Keep me signed in" — extended session duration
- Admin can enforce MFA for all users, or reset a user's MFA for account recovery

When MFA is required by admin policy, new registrations must complete MFA setup before they receive a normal authenticated session.

---

## Architecture

### Encryption Model

All encryption uses the Web Crypto API. The server performs zero cryptographic operations.

**No password:** Random AES-256-GCM key generated in browser, exported to URL fragment (`#key`). Server never sees the key.

**With password (double encryption):** Content encrypted with random key K (goes in URL fragment), then ciphertext re-encrypted with password-derived key P (PBKDF2, 600K iterations). Recipient needs both the URL key and the password.

### Tech Stack

- **Backend:** Express.js, SQLite (better-sqlite3 with WAL mode), Helmet, bcrypt, Nodemailer, rss-parser, cheerio, socks-proxy-agent, Puppeteer (PDF generation)
- **Frontend:** Vanilla JS (ES modules), Tailwind CSS, Web Crypto API
- **Real-time:** WebSocket (ws library) for chat and RedSecAI streaming
- **Storage:** SQLite database + encrypted files on disk

### Key Files

| Path | Purpose |
|---|---|
| `server/index.js` | Express server, routing, cleanup interval |
| `server/database.js` | SQLite schema, prepared statements, CRUD, role seeding, and collaboration data access |
| `server/middleware/auth.js` | User/admin session middleware |
| `server/middleware/permissions.js` | Permission attachment and route/page permission enforcement |
| `server/routes/auth.js` | Login, register, profile, guest links, password reset |
| `server/routes/paste.js` | Paste CRUD, rate limiting |
| `server/routes/share.js` | File upload/download, rate limiting |
| `server/routes/admin.js` | Core admin auth and existing admin dashboard API |
| `server/routes/admin-collab.js` | Admin role, user-role, and bulletin management APIs |
| `server/routes/homepage.js` | Homepage dashboard API (shortcuts, weather) |
| `server/routes/homepage-dashboard.js` | Bulletin feed, bulletin assets, and built-in tool favourite APIs |
| `server/routes/calendar.js` | RedSecCal API |
| `server/routes/survey.js` | RedSecSurvey API |
| `server/routes/threat.js` | RedSecThreat user API (read-only feed catalogue, personal keywords/tags/alerts, personal notifications, health) |
| `server/routes/reporter.js` | RedSecReporter API (projects, findings, sections, designs, templates, evidence, comments, notes, PDFs) |
| `server/routes/redsecai.js` | RedSecAI HTTP API (status, chat, action confirm/reject) |
| `server/threat-feed-service.js` | Feed fetch engine (RSS, website, API, onion), keyword matching, IOC extraction |
| `server/threat-notify-service.js` | Notification dispatch (webhook, email, Discord) |
| `server/chat-ws.js` | WebSocket server for encrypted real-time chat |
| `server/redsecai-ws.js` | WebSocket server for RedSecAI streaming responses |
| `server/modules/redsecai/` | RedSecAI orchestrator, tool routing, context builder, action review, and provider modules |
| `server/routes/wiki.js` | RedSecWiki API |
| `public/js/crypto.js` | AES-256-GCM + PBKDF2 (zero dependencies) |
| `public/js/file-crypto.js` | File encryption module |
| `public/js/homepage.js` | Homepage dashboard orchestrator |
| `public/js/homepage-shortcuts.js` | Shortcut CRUD, drag reorder, favourites |
| `public/js/homepage-weather.js` | Weather widget with live time updates |
| `public/js/admin.js` | Admin dashboard (tabbed UI, roles, bulletins) |

### Database Schema

The SQLite database now includes the original encrypted content/auth/chat/vault tables plus collaboration tables for:

- `roles`, `role_permissions` — primary user role and permission assignments
- `bulletins`, `bulletin_assets` — homepage bulletin messages and managed WebP assets
- `calendar_projects`, `calendar_entries` — RedSecCal projects and events/assignments
- `surveys`, `survey_questions`, `survey_question_options`, `survey_responses`, `survey_answers` — RedSecSurvey
- `wiki_pages`, `wiki_page_revisions` — RedSecWiki team/personal page tree, published markdown render, and revision history
- `reporter_projects`, `reporter_findings`, `reporter_sections`, `reporter_designs`, `reporter_finding_templates`, `reporter_project_members`, `reporter_comments`, `reporter_evidence`, `reporter_notes`, `reporter_project_pdfs`, `reporter_import_jobs` — RedSecReporter projects, findings, designs, templates, membership, comments, evidence, and PDF versioning
- `redsecai_pending_actions` — RedSecAI confirmation-gated pending write actions
- `homepage_settings` — homepage layout plus built-in tool favourites
- `threat_feeds`, `threat_keywords`, `threat_tags`, `threat_alerts`, `threat_api_templates`, `threat_notification_configs`, `threat_user_notifications`, `threat_suppressed_alerts` — RedSecThreat shared feed, template, and alert content tables
- `threat_feed_keywords`, `threat_feed_tags`, `threat_keyword_tags`, `threat_alert_tags` — RedSecThreat shared many-to-many relationship tables
- `threat_user_keyword_disabled`, `threat_user_keyword_tags`, `threat_user_alert_keywords`, `threat_user_alert_state`, `threat_user_alert_tags`, `threat_user_hidden_alerts` — per-user overrides, alert ownership, read state, and personal tagging without duplicating alert payloads

---

## Data and Backups

### npm Installs

All data is stored in the `data/` directory:
- `data/pastes.db` — SQLite database (users, pastes, shares, invites, sessions, shortcuts, favourites)
- `data/files/` — Encrypted uploaded files
- `data/avatars/` — User avatar images (WebP)
- `data/shortcut-icons/` — Shortcut custom icons (WebP)

To back up, stop the server and copy the `data/` directory:
```bash
cp -r data/ data-backup-$(date +%Y%m%d)/
```

### Docker Installs

Data is stored in a Docker named volume `redsectools-data`.

```bash
# View volume location
docker volume inspect redsectools-data

# Back up to a tarball
docker run --rm \
  -v redsectools-data:/data \
  -v $(pwd):/backup \
  alpine tar czf /backup/redsectools-backup.tar.gz -C /data .

# Restore from backup
docker run --rm \
  -v redsectools-data:/data \
  -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/redsectools-backup.tar.gz"
```

To delete all data: `docker compose down -v` (this is destructive and irreversible).

---

## Troubleshooting

**Container exits immediately (Docker)**
Run `docker compose logs` to check the error. The most common cause is a missing or invalid `COOKIE_SECRET` in `.env`. Re-run the setup script or set it manually.

**"Cannot find module" errors (npm)**
Run `npm install` to install dependencies, then `npm run build` to compile the CSS.

**How do I run the automated checks?**
Run `npm test` for the lightweight security/rendering test suite, then `npm run build` and `npm start` or `npm run dev` for manual browser verification.

**Port already in use**
Change `PORT` in your `.env` file to a different port (e.g., `PORT=8080`).

**WebSocket not connecting (chat)**
If running behind a reverse proxy, ensure it passes through `Upgrade` and `Connection` headers for WebSocket support.

**Weather not showing on homepage**
Ensure admin has configured at least one weather location (Admin > Settings > Weather). The widget requires the Open-Meteo API to be reachable from the server.

---

## License

RedSecTools — RedSec Offensive Security
