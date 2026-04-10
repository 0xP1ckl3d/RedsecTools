# RedSecTools

A multi-tool security platform by [RedSec Offensive Security](https://github.com/0xP1ckl3d). All encryption and decryption happens entirely in the browser — the server never sees plaintext content.

## Features

| Tool | Description |
|---|---|
| **RedSecPaste** | Encrypted pastebin with optional password protection, burn-after-reading, and syntax highlighting |
| **RedSecShare** | Encrypted file sharing up to 250MB per file, with optional password protection |
| **RedSecChat** | End-to-end encrypted real-time messaging with rich text formatting, emoji, and file sharing |
| **RedSecVault** | Encrypted credential manager for passwords, API keys, SSH keys, TOTP 2FA codes, and secure notes |

**Key security properties:**
- AES-256-GCM encryption via the Web Crypto API (zero server-side crypto)
- Server stores only opaque ciphertext — it cannot read your pastes, files, messages, or vault entries
- Optional password protection adds a second layer (PBKDF2, 600K iterations)
- TOTP-based multi-factor authentication with recovery codes and trusted device support
- Invite-only user registration, bcrypt password hashing, server-side sessions
- Strict CSP, Helmet security headers, rate limiting on all endpoints

---

## Homepage Dashboard

The landing page (`/`) is a fully featured dashboard with:

- **Personalized greeting** — "Welcome back, username" with live date and ticking clock
- **Google search bar** — web search without leaving the page
- **Weather widget** — real-time weather for up to 5 admin-configured cities (Open-Meteo API), with local time ticking per city
- **Quick Access** — two-row grid: top row has all four RedSec tools, bottom row shows your favourite shortcuts (up to 4)
- **Collapsible sidebar** — navigate between Home, Tools, and Shortcuts views with collapsible Team and Personal link sections
- **Mobile responsive** — sidebar collapses to a tab bar on mobile, weather grid adapts to 2 columns

### Shortcuts

Users can create personal shortcuts (bookmarks) with:
- Custom emoji icons (7 categories, 400+ emojis) or uploaded custom images (converted to WebP)
- Title, URL, and optional description
- Drag-to-reorder in edit mode
- Favourite up to 4 shortcuts (star button, top-left of card in edit mode) — these appear in Quick Access
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

---

## Local Install (npm)

**Prerequisites:** [Node.js](https://nodejs.org/) 20 or later, npm

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

# 5. Start the server
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
| `DB_PATH` | No | `./data/pastes.db` | Path to the SQLite database file |

SMTP email settings are configured in the Admin > Settings UI (stored encrypted in the database) — not via environment variables.

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

**Server Configuration** (first group of tabs):
- **Settings** — SMTP configuration with test email, password masked after save
- **Security** — Session duration, extended session TTL, MFA policy, trusted browser duration
- **Weather** — Manage up to 5 weather locations with city search and drag-to-reorder
- **Shortcuts** — Manage team shortcuts (visible to all users) with emoji/image icons, add/edit/delete
- **Invites** — Create registration invite links (sent via email or displayed as URL)

**Tools Management** (second group of tabs):
- **Chat** — View and delete conversations
- **Pastes** — View, search, and bulk-delete pastes
- **Files** — View, search, and bulk-delete shared files
- **Users** — View, edit, suspend, delete users; reset passwords; disable MFA for account recovery
- **Vaults** — View and delete encrypted vaults

### Creating Pastes (`/paste`)

1. Log in (or use a guest link)
2. Write or paste your content
3. Optionally set a password for double encryption
4. Choose an expiration time (1 hour, 12 hours, 24 hours, 3 days)
5. Enable burn-after-reading to self-destruct after first view
6. Share the resulting link — the decryption key is in the URL fragment (never sent to the server)

### Sharing Files (`/share`)

1. Log in (or use a guest link)
2. Upload one or more files (up to 250MB each)
3. Optionally set a password for double encryption
4. Choose expiration and burn-after-reading options
5. Share the link — filenames are also encrypted

### Chat (`/chat`)

End-to-end encrypted real-time messaging with other registered users. Supports rich text formatting (bold, italic, underline, code, code blocks, lists), emoji picker (7 categories), file/paste/share link embeds, and group conversations. Messages are encrypted client-side and auto-expire after 7 days.

### Vault (`/vault`)

Encrypted credential manager supporting passwords, API keys, SSH keys, TOTP 2FA codes, and secure notes. Personal vaults are encrypted with the user's password. Team vaults use RSA key pairs for member-to-member key exchange. Entries can be shared directly between users.

### Multi-Factor Authentication

Users can enable TOTP-based MFA from their profile page. Supports:
- Standard authenticator apps (Google Authenticator, Authy, 1Password, etc.)
- Recovery codes (one-time use, regenerable)
- "Remember this browser" — skip MFA for trusted devices (configurable duration)
- "Keep me signed in" — extended session duration
- Admin can enforce MFA for all users, or reset a user's MFA for account recovery

---

## Architecture

### Encryption Model

All encryption uses the Web Crypto API. The server performs zero cryptographic operations.

**No password:** Random AES-256-GCM key generated in browser, exported to URL fragment (`#key`). Server never sees the key.

**With password (double encryption):** Content encrypted with random key K (goes in URL fragment), then ciphertext re-encrypted with password-derived key P (PBKDF2, 600K iterations). Recipient needs both the URL key and the password.

### Tech Stack

- **Backend:** Express.js, SQLite (better-sqlite3 with WAL mode), Helmet, bcrypt, Nodemailer
- **Frontend:** Vanilla JS (ES modules), Tailwind CSS, Web Crypto API
- **Real-time:** WebSocket (ws library) for chat
- **Storage:** SQLite database + encrypted files on disk

### Key Files

| Path | Purpose |
|---|---|
| `server/index.js` | Express server, routing, cleanup interval |
| `server/database.js` | SQLite with 11 tables, prepared statements, CRUD |
| `server/middleware/auth.js` | User/admin session middleware |
| `server/routes/auth.js` | Login, register, profile, guest links, password reset |
| `server/routes/paste.js` | Paste CRUD, rate limiting |
| `server/routes/share.js` | File upload/download, rate limiting |
| `server/routes/admin.js` | Admin dashboard API (all tabs) |
| `server/routes/homepage.js` | Homepage dashboard API (shortcuts, weather) |
| `public/js/crypto.js` | AES-256-GCM + PBKDF2 (zero dependencies) |
| `public/js/file-crypto.js` | File encryption module |
| `public/js/homepage.js` | Homepage dashboard orchestrator |
| `public/js/homepage-shortcuts.js` | Shortcut CRUD, drag reorder, favourites |
| `public/js/homepage-weather.js` | Weather widget with live time updates |
| `public/js/admin.js` | Admin dashboard (tabbed UI) |

### Database Schema

11 tables in SQLite:
- `pastes`, `shares`, `share_files` — encrypted content storage
- `users`, `sessions`, `invites`, `password_resets` — authentication
- `guest_links` — one-time guest access tokens
- `settings` — key-value config (SMTP, weather locations, security settings)
- `homepage_shortcuts` — user and team shortcuts with icons
- `user_favourite_shortcuts` — per-user favourite shortcuts (junction table)

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

**Port already in use**
Change `PORT` in your `.env` file to a different port (e.g., `PORT=8080`).

**WebSocket not connecting (chat)**
If running behind a reverse proxy, ensure it passes through `Upgrade` and `Connection` headers for WebSocket support.

**Weather not showing on homepage**
Ensure admin has configured at least one weather location (Admin > Settings > Weather). The widget requires the Open-Meteo API to be reachable from the server.

---

## License

RedSecTools — RedSec Offensive Security
