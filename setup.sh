#!/usr/bin/env bash
#
# RedSecTools First-Run Setup
# Generates .env with random ADMIN_PASSWORD and COOKIE_SECRET
#
# Usage: ./setup.sh
# Works on: Linux, macOS, Git Bash (Windows)
#

set -e

ENV_FILE=".env"

# Don't overwrite existing configuration
if [ -f "$ENV_FILE" ]; then
    echo "=> .env already exists. Skipping generation."
    echo "   To regenerate, delete .env and run this script again."
    exit 0
fi

echo ""
echo "=== RedSecTools Setup ==="
echo ""

# --- Port ---
echo "What port should the server listen on?"
read -rp "Port [3000]: " PORT_INPUT
PORT="${PORT_INPUT:-3000}"

# --- Host / Bind address ---
echo ""
echo "Bind address — controls which network interface the server listens on:"
echo "  1) 0.0.0.0   — All interfaces (Docker, Tailscale, LAN access)"
echo "  2) 127.0.0.1 — Localhost only (Cloudflare Tunnel, reverse proxy)"
echo ""
read -rp "Choose [1]: " HOSTChoice
case "$HOSTChoice" in
    2) HOST="127.0.0.1" ;;
    *) HOST="0.0.0.0" ;;
esac

echo ""
echo "=> Generating configuration..."

# Generate random admin password (24 chars, base64)
ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '=/+' | head -c 24)

# Generate random cookie secret (32 bytes = 64 hex chars)
COOKIE_SECRET=$(openssl rand -hex 32)

cat > "$ENV_FILE" << EOF
# Server configuration
PORT=${PORT}
HOST=${HOST}
NODE_ENV=production

# Admin dashboard password
ADMIN_PASSWORD=${ADMIN_PASSWORD}

# Secret for signing cookies (auto-generated)
COOKIE_SECRET=${COOKIE_SECRET}

# Database path (default: ./data/pastes.db)
# DB_PATH=./data/pastes.db

# SMTP is configured via the Admin > Settings UI (stored in database).
# No SMTP env vars are needed — configure it after logging into /admin.
EOF

echo ""
echo "============================================"
echo "  RedSecTools is configured!"
echo "============================================"
echo ""
echo "  Admin password: ${ADMIN_PASSWORD}"
echo ""
echo "  Listening:      ${HOST}:${PORT}"
echo ""
echo "  Write this down — you'll need it to log in"
echo "  at http://localhost:${PORT}/admin"
echo ""
echo "  To change settings: edit .env and restart"
echo "============================================"
echo ""
