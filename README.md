# RedSecTools

A multi-tool security platform by [RedSec Offensive Security](https://github.com/0xP1ckl3d). All encryption and decryption happens entirely in the browser — the server never sees plaintext content.

<img width="1313" height="497" alt="image" src="https://github.com/user-attachments/assets/0178c769-e42d-43f1-b4da-73fdc31fca65" />

## Features

| Tool | Description |
|---|---|
| **RedSecPaste** | Encrypted pastebin with optional password protection, burn-after-reading, and syntax highlighting |
| **RedSecShare** | Encrypted file sharing up to 250MB per file, with optional password protection |
| **RedSecChat** | End-to-end encrypted real-time messaging |

**Key security properties:**
- AES-256-GCM encryption via the Web Crypto API (zero server-side crypto)
- Server stores only opaque ciphertext — it cannot read your pastes, files, or messages
- Optional password protection adds a second layer (PBKDF2, 600K iterations)
- Invite-only user registration, bcrypt password hashing, server-side sessions
- Strict CSP, Helmet security headers, rate limiting on all endpoints

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

Log in with the admin password from your `.env` file. From here you can:
- View and delete pastes and shared files
- Manage users (view, suspend, delete)
- Create registration invite links (sent via email or displayed as URL)
- Configure SMTP settings for email delivery
- Create guest links for one-time paste/file creation without registration

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

End-to-end encrypted real-time messaging with other registered users. Messages are encrypted client-side and auto-expire after 7 days.

---

## Data and Backups

### npm Installs

All data is stored in the `data/` directory:
- `data/pastes.db` — SQLite database (users, pastes, shares, invites, sessions)
- `data/files/` — Encrypted uploaded files
- `data/avatars/` — User avatar images

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

---

## License

RedSecTools — RedSec Offensive Security
